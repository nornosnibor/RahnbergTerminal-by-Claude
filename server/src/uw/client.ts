import { cacheGet, cacheStore, staleGet } from "../cache.js";
import { getSetting, setSetting } from "../db.js";

const SETTING_KEY = "uw_api_key";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const baseUrl = () => (process.env.UW_BASE_URL ?? "https://api.unusualwhales.com").replace(/\/$/, "");

export function isValidKey(key: string): boolean {
  return UUID_RE.test(key.trim());
}

/** The key saved from the UI wins over the environment so it can be changed without a restart. */
export function getKey(): { key: string | null; source: "settings" | "env" | null } {
  const saved = getSetting(SETTING_KEY);
  if (saved) return { key: saved, source: "settings" };
  const env = process.env.UW_API_KEY ?? process.env.UNUSUAL_WHALES_API_KEY;
  if (env?.trim()) return { key: env.trim(), source: "env" };
  return { key: null, source: null };
}

export function saveKey(key: string | null): void {
  setSetting(SETTING_KEY, key ? key.trim() : null);
  restricted.clear();
}

export function maskKey(key: string | null): string | null {
  return key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null;
}

export class UwError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    public planRestricted = false
  ) {
    super(message);
  }
}

// UW signals "not in your plan" with 403 *or* 422 and a message like "requires the Advanced API
// tier", "premium endpoint", "enterprise only", "Missing access…".
const PLAN_RE = /requires the .*tier|add-on|premium endpoint|enterprise only|missing access|upgrade/i;
export function isPlanRestriction(status: number, msg: string): boolean {
  return (status === 403 || status === 422) && PLAN_RE.test(msg);
}

/** Endpoint templates the current key has been refused for. Cleared when the key changes. */
export const restricted = new Set<string>();

// ---- rate limiting -----------------------------------------------------------
// UW enforces a per-minute request budget per token and reports what's left in
// `x-uw-req-per-minute-remaining` / `-reset`. Requests are queued here (bounded concurrency,
// an optional local cap via UW_MAX_RPM, and a pause when UW says the budget is nearly spent)
// so dashboard bursts don't turn into 429s.

const MAX_CONCURRENT = Number(process.env.UW_MAX_CONCURRENT ?? 6);
const maxPerMinute = () => Number(process.env.UW_MAX_RPM ?? 1000);
const upstream = { remaining: null as number | null, resetAt: 0 };
const sent: number[] = [];
let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] > 60_000) sent.shift();
    const upstreamWait = upstream.remaining !== null && upstream.remaining <= MAX_CONCURRENT && upstream.resetAt > now ? upstream.resetAt - now : 0;
    if (upstreamWait > 0) {
      if (upstreamWait > 20_000) throw new UwError(429, "Unusual Whales per-minute limit reached — waiting for it to reset. Slow down auto-refresh.");
      await new Promise((r) => setTimeout(r, upstreamWait + 5));
      upstream.remaining = null;
      continue;
    }
    if (active < MAX_CONCURRENT && sent.length < maxPerMinute()) {
      active++;
      sent.push(now);
      return;
    }
    const wait = sent.length >= maxPerMinute() ? 60_000 - (now - sent[0]) + 5 : 0;
    if (wait > 20_000) throw new UwError(429, "Local UW request budget exhausted for this minute — slow down auto-refresh or raise UW_MAX_RPM.");
    await new Promise<void>((resolve) => {
      if (wait > 0) setTimeout(resolve, wait);
      else waiting.push(resolve);
    });
  }
}

function release(): void {
  active--;
  waiting.shift()?.();
}

// ---- usage telemetry (surfaced in the UI) ------------------------------------

export const usage = {
  requests: 0,
  errors: 0,
  cacheHits: 0,
  lastStatus: null as number | null,
  lastError: null as string | null,
  lastLatencyMs: null as number | null,
  limits: {} as Record<string, string>,
};

// ---- requests ----------------------------------------------------------------

/** Reference-ish data barely changes intraday; live flow/GEX needs to stay fresh. */
export function ttlFor(path: string): number {
  if (/(financials|balance-sheets|income-statements|cash-flows|fundamental-breakdown|profile|dividends|splits|transcripts|earnings-estimates|seasonality|institution|politician|politics|congress\/politicians|ownership|\/info$|listings|ticker-exchanges|display_factors|\/dsl$|grammar|filters$|optionable-tickers|private-markets)/.test(path))
    return 5 * 60_000;
  if (/(earnings|economic-calendar|fda-calendar|calendar\/ipo|insider|short|ftds|etfs\/)/.test(path)) return 60_000;
  return Number(process.env.UW_CACHE_TTL_MS ?? 10_000);
}

const inflight = new Map<string, Promise<unknown>>();

export type UwRequest = { method?: string; path: string; template?: string; query?: string; body?: unknown; fresh?: boolean };

export async function uwFetch<T = unknown>({ method = "GET", path, template, query = "", body, fresh }: UwRequest): Promise<T> {
  const { key } = getKey();
  if (!key) throw new UwError(503, "Unusual Whales API key not configured. Add it in WHALES → Settings or set UW_API_KEY.");
  const qs = query.replace(/^\?/, "");
  const url = `${baseUrl()}${path}${qs ? `?${qs}` : ""}`;
  const isGet = method.toUpperCase() === "GET";
  // Scoped to the key so switching accounts/plans never serves another key's responses.
  const cacheKey = `uw:${key.slice(-12)}:${url}`;

  if (isGet && !fresh) {
    const hit = cacheGet<T>(cacheKey);
    if (hit !== undefined) {
      usage.cacheHits++;
      return hit;
    }
    const pending = inflight.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const run = (async () => {
    await acquire();
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          "UW-CLIENT-API-ID": "100001",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(Number(process.env.UW_TIMEOUT_MS ?? 20_000)),
      });
      usage.requests++;
      usage.lastStatus = res.status;
      usage.lastLatencyMs = Date.now() - started;
      res.headers.forEach((v, k) => {
        if (k.startsWith("x-uw-") || k.startsWith("x-ratelimit")) usage.limits[k] = v;
      });
      const remaining = Number(res.headers.get("x-uw-req-per-minute-remaining"));
      const reset = Number(res.headers.get("x-uw-req-per-minute-reset"));
      if (Number.isFinite(remaining) && res.headers.has("x-uw-req-per-minute-remaining")) {
        upstream.remaining = remaining;
        upstream.resetAt = Date.now() + (Number.isFinite(reset) && reset > 0 ? (reset > 1000 ? reset : reset * 1000) : 60_000);
      }
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text.slice(0, 2000) };
      }
      if (!res.ok) {
        const j = (json && typeof json === "object" ? json : {}) as { message?: unknown; error?: unknown; msg?: unknown };
        const msg = String(j.message ?? j.msg ?? j.error ?? "") || `HTTP ${res.status}`;
        const plan = isPlanRestriction(res.status, msg);
        if (plan && template) restricted.add(`${method.toUpperCase()} ${template}`);
        throw new UwError(plan ? 403 : res.status, msg, json, plan);
      }
      if (isGet) cacheStore(cacheKey, json, ttlFor(path));
      return json as T;
    } catch (err) {
      usage.errors++;
      const e = err instanceof UwError ? err : new UwError(502, err instanceof Error ? err.message : String(err));
      usage.lastError = `${e.status}: ${e.message}`;
      // Network blips and rate limits fall back to the last good payload; auth errors never do.
      if (isGet && (e.status === 429 || e.status >= 500)) {
        const stale = staleGet<T>(cacheKey);
        if (stale !== undefined) return stale;
      }
      throw e;
    } finally {
      release();
    }
  })();

  if (isGet) {
    inflight.set(cacheKey, run);
    run.finally(() => inflight.delete(cacheKey)).catch(() => {});
  }
  return run;
}

/** Test hook: reset limiter + telemetry between test cases. */
export function _resetUwState(): void {
  sent.length = 0;
  active = 0;
  upstream.remaining = null;
  restricted.clear();
  waiting.length = 0;
  inflight.clear();
  Object.assign(usage, { requests: 0, errors: 0, cacheHits: 0, lastStatus: null, lastError: null, lastLatencyMs: null, limits: {} });
}

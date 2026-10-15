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
}

export function maskKey(key: string | null): string | null {
  return key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null;
}

export class UwError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
  }
}

// ---- rate limiting -----------------------------------------------------------
// UW enforces a per-minute request budget per token. Dashboards fire many requests at once,
// so requests are queued here (bounded concurrency + sliding one-minute window) instead of
// letting bursts turn into 429s.

const MAX_CONCURRENT = Number(process.env.UW_MAX_CONCURRENT ?? 4);
const maxPerMinute = () => Number(process.env.UW_MAX_RPM ?? 100);
const sent: number[] = [];
let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] > 60_000) sent.shift();
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

export type UwRequest = { method?: string; path: string; query?: string; body?: unknown; fresh?: boolean };

export async function uwFetch<T = unknown>({ method = "GET", path, query = "", body, fresh }: UwRequest): Promise<T> {
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
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text.slice(0, 2000) };
      }
      if (!res.ok) {
        const j = (json && typeof json === "object" ? json : {}) as { message?: unknown; error?: unknown };
        const msg = String(j.message ?? j.error ?? "") || `HTTP ${res.status}`;
        throw new UwError(res.status, msg, json);
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
  waiting.length = 0;
  inflight.clear();
  Object.assign(usage, { requests: 0, errors: 0, cacheHits: 0, lastStatus: null, lastError: null, lastLatencyMs: null, limits: {} });
}

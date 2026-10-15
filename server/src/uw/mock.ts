// A stand-in for api.unusualwhales.com, driven by the OpenAPI samples in samples.json.
// Used by the test suite and by `npm run dev:mock`, so the whole WHALES page can be
// exercised without a real API key. Responses are deterministic per URL and are
// expanded into realistic-looking series (strike ladders, intraday ticks, ticker lists).

import express from "express";
import samplesJson from "./samples.json" with { type: "json" };
import { matchEndpoint, type UwEndpoint } from "./catalog.js";

const samples = samplesJson as Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKERS = ["SPY", "QQQ", "NVDA", "TSLA", "AAPL", "AMD", "META", "AMZN", "MSFT", "IWM", "PLTR", "SMCI", "COIN", "MSTR", "GOOGL", "NFLX", "BA", "XOM", "JPM", "SOFI"];
const SPOT: Record<string, number> = { SPY: 585, QQQ: 505, NVDA: 182, TSLA: 248, AAPL: 231, AMD: 162, META: 612, AMZN: 201, MSFT: 438, IWM: 224 };

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const PRICE_KEYS = /^(price|underlying_price|stock_price|close|open|high|low|prev_close|strike|last_price|avg_price|nbbo_ask|nbbo_bid|bid|ask|max_pain|call_wall|put_wall|gamma_flip|gamma_magnet|week_52_high|week_52_low|target)$/;
const TIME_KEYS = /^(time|timestamp|tape_time|executed_at|created_at|start_time|end_time|market_time|last_tape_time|trf_executed_at|last_fill)$/;
const SIGNED_KEYS = /(^net_|_net_|net_premium|nope|cum_dir|_dir$|charm|vanna|delta|gex|gamma_per|change)/;

const isNumStr = (v: unknown): v is string => typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v);

function numberLike(orig: string | number, value: number): string | number {
  if (typeof orig === "number") return Number.isInteger(orig) ? Math.round(value) : Number(value.toFixed(4));
  const decimals = orig.includes(".") ? Math.min(orig.split(".")[1].length, 4) : 0;
  return value.toFixed(decimals);
}

function rowCount(path: string): number {
  if (/strike|price-levels|stock-price-levels|stock-volume-price-levels/.test(path)) return 41;
  if (/market-tide|net-prem-ticks|spot-exposures$|nope|greek-flow|ohlc|intraday|sector-tide|etf-tide|candles/.test(path)) return 78;
  if (/expiry|term-structure|max-pain/.test(path)) return 10;
  if (/flow-alerts|darkpool|lit-flow|option-trades|screener|unusual|recent|transactions|trades|movers|top/.test(path)) return 60;
  return 25;
}

function expandRows(rows: Record<string, unknown>[], path: string, ticker: string | undefined, rand: () => number) {
  // Some spec examples omit fields the schema defines (e.g. `strike` on spot-exposures/strike).
  const template = /exposure.*strike|oi-per-strike|flow-per-strike/.test(path) && !("strike" in rows[0]) ? { strike: "100", ...rows[0] } : rows[0];
  const levelLadder = /price-levels/.test(path); // here `price` IS the ladder, not spot
  const n = rowCount(path);
  const spot = SPOT[ticker ?? "SPY"] ?? 100 + Math.round(rand() * 300);
  const byStrike = /strike|price-levels/.test(path);
  const intraday = rowCount(path) === 78;
  const marketWide = !ticker && "ticker" in template;
  const start = Date.UTC(2026, 9, 14, 13, 30);
  const step = spot > 300 ? 5 : spot > 100 ? 2.5 : 1;
  let walk = 0;

  return Array.from({ length: n }, (_, i) => {
    const row: Record<string, unknown> = {};
    const strike = Math.round((spot + (i - Math.floor(n / 2)) * step) / step) * step;
    const dist = (strike - spot) / (spot * 0.03);
    const bell = Math.exp(-dist * dist);
    walk += (rand() - 0.47) * 1;
    for (const [k, v] of Object.entries(template)) {
      let out: unknown = v;
      if (k === "ticker" || k === "symbol" || k === "ticker_symbol") out = marketWide ? TICKERS[i % TICKERS.length] : ticker ?? v;
      else if (k === "type" && (v === "call" || v === "put")) out = rand() > 0.45 ? "call" : "put";
      else if (TIME_KEYS.test(k) && typeof v === "string") out = new Date(start + (intraday ? i * 5 : i * 3) * 60_000).toISOString();
      else if (k === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out = intraday || byStrike ? "2026-10-14" : new Date(Date.UTC(2026, 9, 14) - i * 86_400_000).toISOString().slice(0, 10);
      else if (k === "expiry" && typeof v === "string") out = new Date(Date.UTC(2026, 9, 16) + i * 7 * 86_400_000).toISOString().slice(0, 10);
      else if (typeof v === "number" || isNumStr(v)) {
        const base = Number(v);
        let val: number;
        if (k === "strike") val = byStrike ? strike : spot * (0.9 + rand() * 0.2);
        else if (PRICE_KEYS.test(k)) val = levelLadder && k === "price" ? strike : k === "price" && byStrike ? spot : spot * (0.985 + rand() * 0.03);
        else if (byStrike && /gamma|gex|delta|vanna|charm|oi|volume|premium/.test(k)) {
          const mag = Math.max(Math.abs(base), 1e6) * (0.2 + bell * 2.5) * (0.6 + rand() * 0.8);
          val = k.startsWith("put") && /gamma|gex|charm/.test(k) ? -mag : mag;
        } else if (k === "nope" || k === "nope_fill") val = (rand() - 0.45) * 40;
        else if (intraday && SIGNED_KEYS.test(k)) val = Math.max(Math.abs(base), 1e5) * walk * (k.includes("put") ? -0.7 : 1);
        else if (SIGNED_KEYS.test(k)) val = Math.abs(base || 1) * (rand() * 2 - 0.9) * 1.5;
        else val = Math.abs(base) * (0.3 + rand() * 1.4) || rand() * 100;
        out = numberLike(v as string | number, val);
      }
      row[k] = out;
    }
    return row;
  });
}

/** Mirror UW's 422s for missing required params and out-of-range limits, so UI bugs surface in tests. */
export function validateQuery(ep: UwEndpoint, query: URLSearchParams): string | null {
  for (const p of ep.params) {
    if (p.in !== "query") continue;
    if (p.required && !query.has(p.name)) return `Missing required query parameter: ${p.name}`;
    const raw = query.get(p.name);
    if (raw === null) continue;
    if (p.enum && !p.array && !p.enum.includes(raw)) return `Invalid value for ${p.name}: ${raw}`;
    if (p.name === "limit") {
      const max = p.max ?? Number(p.description?.match(/Max:?\s*(\d+)/i)?.[1] ?? NaN);
      if (Number(raw) > max) return `limit must be <= ${max}`;
    }
  }
  return null;
}

export function mockResponse(method: string, path: string, query: URLSearchParams): unknown {
  const match = matchEndpoint(method, path);
  if (!match) return undefined;
  const invalid = validateQuery(match.endpoint, query);
  if (invalid) throw new Error(invalid);
  const sample = structuredClone(samples[`${method} ${match.endpoint.path}`] ?? { data: [] }) as any;
  const ticker = match.pathParams.ticker?.toUpperCase() ?? query.get("ticker_symbol")?.split(",")[0]?.toUpperCase();
  const rand = rng(`${path}?${query}`);
  const wrapped = sample && typeof sample === "object" && !Array.isArray(sample) && "data" in sample;
  const data = wrapped ? sample.data : sample;
  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === "object" && !Array.isArray(data[0])) {
    let rows = expandRows(data, match.endpoint.path, match.pathParams.ticker?.toUpperCase(), rand);
    const limit = Number(query.get("limit"));
    if (limit > 0) rows = rows.slice(0, limit);
    return wrapped ? { ...sample, data: rows } : rows;
  }
  // Objects holding several lists (movers → most_active/top_gainers/…): expand each list.
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && v[0] && typeof v[0] === "object" && !Array.isArray(v[0])) {
        data[k] = expandRows(v, `${match.endpoint.path}/${k}`, match.pathParams.ticker?.toUpperCase(), rand).slice(0, 25);
      }
    }
  }
  if (data && typeof data === "object" && !Array.isArray(data) && ticker) {
    for (const k of ["ticker", "symbol"]) if (k in data) data[k] = ticker;
    const spot = SPOT[ticker] ?? 150;
    for (const [k, v] of Object.entries(data)) {
      if (PRICE_KEYS.test(k) && (typeof v === "number" || isNumStr(v))) data[k] = numberLike(v as string | number, spot * (0.97 + rand() * 0.06));
    }
  }
  return sample ?? { data: [] };
}

export function createMockUw() {
  const app = express();
  app.use(express.json());
  let minuteCount = 0;
  setInterval(() => (minuteCount = 0), 60_000).unref();

  app.use((req, res) => {
    const token = (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!UUID_RE.test(token)) {
      return res.status(401).json({ code: "authentication_required", message: "The API token provided is not in the expected format." });
    }
    if (token.startsWith("deadbeef")) return res.status(403).json({ message: "This endpoint requires the Advanced API tier or higher." });
    // Basic-plan key: Advanced-only endpoints fail the way UW really does it (422 + `msg`).
    if (token.startsWith("cccccccc") && /^\/api\/(companies|market\/movers|futures)/.test(req.path)) {
      return res.status(422).json({ path: req.path, msg: "Missing access. This endpoint is available with the API Advanced subscription." });
    }
    if (token.startsWith("1a1a1a1a")) return res.status(429).json({ message: "Too many requests" });
    minuteCount++;
    res.set("x-uw-daily-req-count", String(1000 + minuteCount));
    res.set("x-uw-token-req-limit", "20000");
    res.set("x-uw-minute-req-counter", String(minuteCount));
    // Real keys report a large per-minute budget; the 2b2b… test key simulates an exhausted one.
    const exhausted = token.startsWith("2b2b2b2b");
    res.set("x-uw-req-per-minute-remaining", exhausted ? "0" : String(1_000_000 - minuteCount));
    res.set("x-uw-req-per-minute-reset", exhausted ? "1500" : "60000");
    const qs = new URLSearchParams(req.originalUrl.split("?")[1] ?? "");
    let body: unknown;
    try {
      body = mockResponse(req.method, req.path, qs);
    } catch (err) {
      return res.status(422).json({ message: err instanceof Error ? err.message : String(err) });
    }
    if (body === undefined) return res.status(404).json({ message: `No route for ${req.method} ${req.path}` });
    res.json(body);
  });
  return app;
}

// `tsx src/uw/mock.ts` — run standalone on UW_MOCK_PORT (default 4100).
if (process.argv[1] && /uw[\\/]mock\.(ts|js)$/.test(process.argv[1])) {
  const port = Number(process.env.UW_MOCK_PORT ?? 4100);
  createMockUw().listen(port, () => console.log(`Mock Unusual Whales API on http://localhost:${port}`));
}

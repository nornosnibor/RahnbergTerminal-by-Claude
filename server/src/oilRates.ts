// Oil & Treasury yield trends for the main page: last value plus today's
// session, the past week and the past month for each instrument.
//
// CNBC is primary (live quotes + intraday history). TradingView backs up the
// live quotes and FRED backs up the month of daily yields; if CNBC's chart
// feeds are down the charts it can't replace are simply omitted.

import { cached } from "./cache.js";
import { tracked } from "./providers/registry.js";
import * as cnbc from "./providers/cnbc.js";
import * as tradingview from "./providers/tradingview.js";
import * as fred from "./providers/fred.js";
import type { Point } from "./providers/cnbc.js";

export type Kind = "price" | "yield" | "spread";

// `fred` backs up the month of daily closes. Oil has none: FRED's Brent/WTI
// series are spot prices published a week late, not the futures shown here.
type Instrument = { id: string; label: string; kind: Kind; cnbc: string; tv: string; fred: string | null };

export const INSTRUMENTS: Instrument[] = [
  { id: "brent", label: "Brent Crude", kind: "price", cnbc: "@LCO.1", tv: "ICEEUR:BRN1!", fred: null },
  { id: "wti", label: "WTI Crude", kind: "price", cnbc: "@CL.1", tv: "NYMEX:CL1!", fred: null },
  { id: "us2y", label: "US 2Y Yield", kind: "yield", cnbc: "US2Y", tv: "TVC:US02Y", fred: "DGS2" },
  { id: "us10y", label: "US 10Y Yield", kind: "yield", cnbc: "US10Y", tv: "TVC:US10Y", fred: "DGS10" },
  { id: "us30y", label: "US 30Y Yield", kind: "yield", cnbc: "US30Y", tv: "TVC:US30Y", fred: "DGS30" },
];

/** A window of history and the value its change is measured from. */
export type Trend = { points: Point[]; base: number; change: number };

export type OilRatesRow = {
  id: string;
  label: string;
  kind: Kind;
  contract: string | null;
  last: number | null;
  time: number | null;
  source: string;
  day: Trend | null;
  week: Trend | null;
  month: Trend | null;
};

export type OilRatesResponse = { rows: OilRatesRow[]; asOf: number };

const MIN = 60_000;
const DAY = 86_400_000;
const MAX_POINTS = 160;

/** Offset (ms) of New York wall-clock time from UTC at instant t. */
function nyOffset(t: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(t / 1000) * 1000;
}

/**
 * Start of the trading session containing t: the most recent 6pm New York
 * time, when oil futures and Treasuries reopen for the next day's session.
 */
export function sessionStart(t: number): number {
  const off = nyOffset(t);
  const wall = new Date(t + off);
  let start = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), 18);
  if (start > t + off) start -= DAY;
  return start - off;
}

/** Evenly thin a series to at most `max` points, always keeping the last one. */
export function downsample(points: Point[], max = MAX_POINTS): Point[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: Point[] = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.round(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/** Append the live quote when it is newer than the last bar. */
export function withLive(points: Point[], live: Point | null): Point[] {
  if (!live) return points;
  const last = points[points.length - 1];
  return !last || live.t > last.t ? [...points, live] : points;
}

function trend(points: Point[], base: number | null): Trend | null {
  if (points.length === 0) return null;
  const b = base ?? points[0].v;
  return { points: downsample(points), base: b, change: points[points.length - 1].v - b };
}

/** Today's session, measured from the previous close when known. */
export function dayTrend(intraday: Point[], previousClose: number | null, live: Point | null): Trend | null {
  const pts = withLive(intraday, live);
  if (pts.length === 0) return null;
  const start = sessionStart(pts[pts.length - 1].t);
  return trend(
    pts.filter((p) => p.t >= start),
    previousClose
  );
}

/** The trailing `spanMs` ending at the newest point, measured from its first point. */
export function windowTrend(points: Point[], spanMs: number, live: Point | null): Trend | null {
  const pts = withLive(points, live);
  if (pts.length === 0) return null;
  const from = pts[pts.length - 1].t - spanMs;
  return trend(
    pts.filter((p) => p.t >= from),
    null
  );
}

/** long − short on matching time buckets (both series keep their last value per bucket). */
export function spreadSeries(long: Point[], short: Point[], bucketMs: number): Point[] {
  const bucket = (pts: Point[]) => {
    const m = new Map<number, number>();
    for (const p of pts) m.set(Math.floor(p.t / bucketMs), p.v);
    return m;
  };
  const a = bucket(long);
  const b = bucket(short);
  const out: Point[] = [];
  for (const [k, v] of a) {
    const s = b.get(k);
    if (s !== undefined) out.push({ t: k * bucketMs, v: Math.round((v - s) * 10_000) / 10_000 });
  }
  return out.sort((x, y) => x.t - y.t);
}

// ---- loading ----

type LiveQuote = { last: number; previousClose: number | null; time: number | null; contract: string | null; source: string };

async function liveQuotes(): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  try {
    const qs = await cached("oilrates:cnbc:quotes", 10_000, () =>
      tracked("cnbc", () => cnbc.quotes(INSTRUMENTS.map((i) => i.cnbc)))
    );
    for (const q of qs) {
      if (q.last === null) continue;
      out.set(q.symbol, { last: q.last, previousClose: q.previousClose, time: q.time, contract: q.contract, source: "cnbc" });
    }
  } catch {
    // fall through to TradingView for anything missing
  }
  const missing = INSTRUMENTS.filter((i) => !out.has(i.cnbc));
  if (missing.length > 0) {
    try {
      const tv = await cached("oilrates:tv:quotes", 10_000, () =>
        tracked("tradingview", () => tradingview.quoteTickers(INSTRUMENTS.map((i) => i.tv)))
      );
      for (const inst of missing) {
        const q = tv.get(inst.tv);
        if (!q) continue;
        out.set(inst.cnbc, {
          last: q.last,
          previousClose: q.change !== null ? q.last - q.change : null,
          time: Date.now(), // TradingView's scanner is live; it just doesn't timestamp rows
          contract: null,
          source: "tradingview",
        });
      }
    } catch {
      // no live quote; rows fall back to their newest bar
    }
  }
  return out;
}

async function cnbcBars(symbol: string, period: "1D" | "5D" | "1M", ttl: number): Promise<Point[] | null> {
  try {
    return await cached(`oilrates:cnbc:${period}:${symbol}`, ttl, () => tracked("cnbc", () => cnbc.bars(symbol, period)));
  } catch {
    return null;
  }
}

async function fredDaily(seriesId: string): Promise<Point[] | null> {
  try {
    const pts = await cached(`fred:${seriesId}:45`, 30 * MIN, () => tracked("fred", () => fred.series(seriesId, 45)));
    return pts.map((p) => ({ t: Date.parse(p.date + "T21:00:00Z"), v: p.value }));
  } catch {
    return null;
  }
}

type Raw = { inst: Instrument; quote: LiveQuote | null; d1: Point[] | null; d5: Point[] | null; daily: Point[] | null; dailySource: string };

async function loadRaw(inst: Instrument, quote: LiveQuote | null): Promise<Raw> {
  // CNBC's generic front-month chart (e.g. "@CL.1") can lag the quote by a
  // contract around expiry, so chart the exact contract the quote is on.
  const symbol = quote?.contract ?? inst.cnbc;
  const [d1, d5, daily] = await Promise.all([
    cnbcBars(symbol, "1D", MIN),
    cnbcBars(symbol, "5D", 5 * MIN),
    cnbcBars(symbol, "1M", 30 * MIN),
  ]);
  if (daily) return { inst, quote, d1, d5, daily, dailySource: "cnbc" };
  return { inst, quote, d1, d5, daily: inst.fred ? await fredDaily(inst.fred) : null, dailySource: "fred" };
}

/**
 * The newest known value: the live quote or the latest intraday bar, whichever
 * is more recent (CNBC's quote feed can trail its chart feed by minutes). A
 * quote without a timestamp only wins when there are no bars at all.
 */
export function newestPoint(quote: { last: number; time: number | null } | null, bars: Array<Point[] | null>): Point | null {
  const timed = quote && quote.time !== null ? { t: quote.time, v: quote.last } : null;
  const lastBar = bars.find((b) => b && b.length > 0)?.at(-1) ?? null;
  if (timed && lastBar) return timed.t >= lastBar.t ? timed : lastBar;
  return timed ?? lastBar ?? (quote ? { t: Date.now(), v: quote.last } : null);
}

function rawNewest(raw: Raw): Point | null {
  return newestPoint(raw.quote, [raw.d1, raw.d5, raw.daily]);
}

function buildRow(raw: Raw): OilRatesRow {
  const live = rawNewest(raw);
  return {
    id: raw.inst.id,
    label: raw.inst.label,
    kind: raw.inst.kind,
    contract: raw.quote?.contract ?? null,
    last: live?.v ?? null,
    time: live?.t ?? null,
    source: raw.quote?.source ?? (raw.d1 ? "cnbc" : raw.dailySource),
    day: raw.d1 ? dayTrend(raw.d1, raw.quote?.previousClose ?? null, live) : null,
    week: raw.d5 ? windowTrend(raw.d5, 7 * DAY, live) : null,
    month: raw.daily ? windowTrend(raw.daily, 31 * DAY, live) : null,
  };
}

/** 10Y − 2Y, the most-watched recession / curve-steepening signal. */
function buildSpread(r2: Raw, r10: Raw): OilRatesRow | null {
  const join = (a: Point[] | null, b: Point[] | null, bucket: number) => (a && b ? spreadSeries(a, b, bucket) : null);
  const l2 = rawNewest(r2);
  const l10 = rawNewest(r10);
  const live = l2 && l10 ? { t: Math.max(l2.t, l10.t), v: Math.round((l10.v - l2.v) * 10_000) / 10_000 } : null;
  const prev =
    r2.quote?.previousClose != null && r10.quote?.previousClose != null
      ? r10.quote.previousClose - r2.quote.previousClose
      : null;
  const d1 = join(r10.d1, r2.d1, 5 * MIN);
  const d5 = join(r10.d5, r2.d5, 5 * MIN);
  const daily = join(r10.daily, r2.daily, DAY);
  const newest = live ?? d1?.at(-1) ?? daily?.at(-1) ?? null;
  if (!newest) return null;
  return {
    id: "2s10s",
    label: "2s10s Spread",
    kind: "spread",
    contract: null,
    last: newest.v,
    time: newest.t,
    source: r10.quote?.source ?? "cnbc",
    day: d1 && d1.length > 0 ? dayTrend(d1, prev, live) : null,
    week: d5 && d5.length > 0 ? windowTrend(d5, 7 * DAY, live) : null,
    month: daily && daily.length > 0 ? windowTrend(daily, 31 * DAY, live) : null,
  };
}

export async function oilRates(): Promise<OilRatesResponse> {
  const quotes = await liveQuotes();
  const raws = await Promise.all(INSTRUMENTS.map((i) => loadRaw(i, quotes.get(i.cnbc) ?? null)));
  const rows = raws.map(buildRow).filter((r) => r.last !== null);
  if (rows.length === 0) throw new Error("no oil or yield data from any provider");

  const r2 = raws.find((r) => r.inst.id === "us2y");
  const r10 = raws.find((r) => r.inst.id === "us10y");
  const spread = r2 && r10 ? buildSpread(r2, r10) : null;
  if (spread) rows.push(spread);

  return { rows, asOf: Date.now() };
}

// CNBC's public quote and chart feeds — the ones cnbc.com's own quote pages
// use. No API key. Unlike the stock-focused providers, they cover futures
// (Brent, WTI) and Treasury yields with intraday history.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "application/json" };

export type CnbcQuote = {
  symbol: string;
  name: string | null;
  contract: string | null; // e.g. "LCOZ6" for the front-month Brent future
  last: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  time: number | null; // epoch ms
};

export type Point = { t: number; v: number };

/** CNBC formats numbers as display strings: "110.38", "+1.59", "5.123%", "9,351". */
export function num(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(/[,%+]/g, "").trim());
  return String(raw).trim() !== "" && isFinite(n) ? n : null;
}

export async function quotes(symbols: string[]): Promise<CnbcQuote[]> {
  const url =
    "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=" +
    encodeURIComponent(symbols.join("|")) +
    "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1";
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`cnbc quote ${res.status}`);
  const json = await res.json();
  const rows: any[] = json?.FormattedQuoteResult?.FormattedQuote ?? [];
  const out = rows
    .filter((q) => q && q.code === 0 && num(q.last) !== null)
    .map((q) => {
      // Some quotes (e.g. WTI after the close) carry only a date — not a usable timestamp.
      const time = String(q.last_time ?? "").includes("T") ? Date.parse(q.last_time) : NaN;
      return {
        symbol: String(q.symbol),
        name: q.name ?? null,
        contract: q.altSymbol && !String(q.altSymbol).includes("=") ? String(q.altSymbol) : null,
        last: num(q.last),
        previousClose: num(q.previous_day_closing),
        open: num(q.open),
        high: num(q.high),
        low: num(q.low),
        time: isFinite(time) ? time : null,
      };
    });
  if (out.length === 0) throw new Error("cnbc: no quotes returned");
  return out;
}

/**
 * Closing prices for a chart period. CNBC's periods are wider than their
 * names: "1D" is ~2 days of 1-minute bars, "5D" ~9 days of 5-minute bars,
 * and "1M" a year of daily bars.
 */
export async function bars(symbol: string, period: "1D" | "5D" | "1M"): Promise<Point[]> {
  const url = `https://ts-api.cnbc.com/harmony/app/charts/${period}.json?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`cnbc chart ${res.status}`);
  const json = await res.json();
  const raw: any[] = json?.barData?.priceBars ?? [];
  const points: Point[] = [];
  for (const b of raw) {
    const t = Number(b.tradeTimeinMills);
    const v = num(b.close);
    if (isFinite(t) && v !== null) points.push({ t, v });
  }
  if (points.length === 0) throw new Error(`cnbc: no ${period} bars for ${symbol}`);
  return points.sort((a, b) => a.t - b.t);
}

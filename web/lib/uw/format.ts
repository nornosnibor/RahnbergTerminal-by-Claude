// Formatting + table helpers for Unusual Whales payloads. UW returns most decimals as
// strings ("12345.00") and fractions as decimals (0.05 = 5%), so everything here coerces
// first and picks a display style from the column name.

export type Row = Record<string, unknown>;

/** Flatten any UW payload shape (`{data:[…]}`, `{data:{…}}`, bare array/object) into rows. */
export function toRows(json: unknown): Row[] {
  const body = json && typeof json === "object" && !Array.isArray(json) && "data" in json ? (json as { data: unknown }).data : json;
  if (Array.isArray(body)) {
    return body.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Row)
        : Array.isArray(item)
          ? Object.fromEntries(item.map((v, i) => [`col${i}`, v]))
          : { value: item }
    );
  }
  if (body && typeof body === "object") {
    // `{data: {dividends: [...], ticker}}` → the rows of its single nested list.
    const lists = Object.values(body).filter((v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x)));
    if (lists.length === 1) return lists[0] as Row[];
    return [body as Row];
  }
  if (body === null || body === undefined) return [];
  return [{ value: body }];
}

/** Every list-of-objects inside a payload (e.g. financials → balance_sheets, cash_flows…), for sub-table pickers. */
export function nestedTables(json: unknown): Array<{ key: string; rows: Row[] }> {
  const body = json && typeof json === "object" && !Array.isArray(json) && "data" in json ? (json as { data: unknown }).data : json;
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.entries(body)
    .filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x)))
    .map(([key, v]) => ({ key, rows: v as Row[] }));
}

/** Lift one level of nested objects into `parent.child` columns so they're sortable/filterable. */
export function flattenRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Row)) out[`${k}.${k2}`] = v2;
    } else out[k] = v;
  }
  return out;
}

export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v.trim())) return Number(v);
  return null;
}

export type ColKind = "money" | "big" | "pct" | "price" | "int" | "dec" | "date" | "time" | "text" | "bool" | "ticker" | "side";

const MONEY = /(premium|prem$|_prem_|notional|marketcap|market_cap|revenue|income|cash|assets|liabilities|debt|equity|value$|amount|_usd$|net_impact|dollar|ebitda|profit|sales|_cost)/;
const PCT = /(_perc$|_perc_|perc_|_pct|pct_|percent|_ratio$|ratio_|iv_rank|_rank$|yield|implied_volatility|^iv$|^iv_|_iv$|iv30|volatility|^change$|_change$|growth|margin|bull|bear|skew|probability|weight)/;
const PRICE = /(^price$|_price$|^strike$|^close$|^open$|^high$|^low$|^bid$|^ask$|nbbo|_wall$|gamma_flip|gamma_magnet|max_pain|^target$|week_52|prev_close|^last$|^mark$|^avg_price$)/;
const BIG = /(volume|_oi$|^oi$|open_interest|size|shares|outstanding|float|gamma|gex|delta|vanna|charm|vega|theta|count|trades|_vol$|^vol_|units)/;
const TIME = /(_at$|^time$|timestamp|tape_time|market_time|^start_time$|^end_time$|last_fill)/;
const DATE = /(date|expiry|expiration|^day$|period)/;

export function columnKind(key: string, sample?: unknown): ColKind {
  const k = key.toLowerCase().split(".").pop()!;
  if (typeof sample === "boolean") return "bool";
  if (k === "ticker" || k === "symbol" || k === "underlying_symbol" || k === "ticker_symbol") return "ticker";
  if (k === "type" || k === "option_type" || k === "side" || k === "put_call" || k === "sentiment") return "side";
  if (TIME.test(k)) return "time";
  if (DATE.test(k) && typeof sample === "string" && /^\d{4}-\d{2}-\d{2}/.test(sample)) return "date";
  if (num(sample) === null && sample !== null && sample !== undefined) return "text";
  if (k === "dte" || k === "days_to_cover" || /^(rank|year|month)$/.test(k)) return "int";
  if (PRICE.test(k)) return "price";
  if (MONEY.test(k)) return "money";
  if (PCT.test(k)) return "pct";
  if (BIG.test(k)) return "big";
  return "dec";
}

export function fmtBigNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** UW mixes 0.05-style fractions with already-scaled percentages; >2 in magnitude is assumed scaled. */
export function fmtPct(n: number): string {
  const v = Math.abs(n) <= 2 ? n * 100 : n;
  return `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)}%`;
}

export function fmtTime(v: unknown): string {
  const d = new Date(typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : String(v));
  if (isNaN(d.getTime())) return String(v);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("en-US", { hour12: false, timeZone: "America/New_York" })
    : d.toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
}

/** HH:MM in New York time — for chart axes. */
export function fmtClock(v: unknown): string {
  const d = new Date(typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : String(v));
  if (isNaN(d.getTime())) return String(v ?? "");
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
}

export function fmtCell(key: string, v: unknown, kind: ColKind = columnKind(key, v)): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length <= 4 && v.every((x) => typeof x !== "object") ? v.join(", ") : `[${v.length}]`;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  if (typeof v === "boolean") return v ? "✓" : "·";
  const n = num(v);
  switch (kind) {
    case "money":
      return n === null ? String(v) : `${n < 0 ? "-" : ""}$${fmtBigNum(Math.abs(n))}`;
    case "big":
      return n === null ? String(v) : fmtBigNum(n);
    case "pct":
      return n === null ? String(v) : fmtPct(n);
    case "price":
      return n === null ? String(v) : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 });
    case "int":
      return n === null ? String(v) : Math.round(n).toLocaleString("en-US");
    case "dec":
      return n === null ? String(v) : Math.abs(n) >= 1e4 ? fmtBigNum(n) : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
    case "time":
      return fmtTime(v);
    case "date":
      return String(v).slice(0, 10);
    default:
      return String(v);
  }
}

const SIGNED = /(net_|_net|change|^chg|perc_change|nope|cum_dir|_dir$|delta|gex|gamma|return|diff|sentiment|growth|flow|impact|surprise)/;

/** CSS class for a cell: green/red for signed metrics, call/put coloring, bullish/bearish words. */
export function cellClass(key: string, v: unknown, kind: ColKind = columnKind(key, v)): string {
  const k = key.toLowerCase();
  if (kind === "side" || kind === "text") {
    const s = String(v ?? "").toLowerCase();
    if (/^(call|calls|c|bull|bullish|buy|purchase|ask|long|positive)$/.test(s)) return "up";
    if (/^(put|puts|p|bear|bearish|sell|sale|bid|short|negative)$/.test(s)) return "down";
    return kind === "side" ? "dim" : "";
  }
  if (kind === "ticker") return "amber font-bold";
  const n = num(v);
  if (n === null || n === 0) return "";
  if (SIGNED.test(k)) return n > 0 ? "up" : "down";
  if (/^call_|_call_|bullish/.test(k)) return "text-[#5fd38d]";
  if (/^put_|_put_|bearish/.test(k)) return "text-[#ff7a7a]";
  return "";
}

/** `call_volume_ask_side` → `Call Vol Ask Side` (short enough to fit dense headers). */
export function humanize(key: string): string {
  return key
    .replace(/\./g, " › ")
    .replace(/_/g, " ")
    .replace(/\bvolume\b/gi, "vol")
    .replace(/\bpremium\b/gi, "prem")
    .replace(/\bpercentage\b|\bperc\b/gi, "%")
    .replace(/\bopen interest\b/gi, "OI")
    .replace(/\bimplied volatility\b/gi, "IV")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function toCsv(rows: Row[], cols: string[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function downloadCsv(name: string, rows: Row[], cols: string[]): void {
  const blob = new Blob([toCsv(rows, cols)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^a-z0-9-_]+/gi, "_")}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

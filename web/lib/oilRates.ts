// Types and formatting for the Oil & Rates widget (server: /api/oil-rates).

export type Kind = "price" | "yield" | "spread";
export type Point = { t: number; v: number };
export type Trend = { points: Point[]; base: number; change: number };
export type WindowKey = "day" | "week" | "month";

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

const signed = (n: number, digits: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(digits);

/** Current level: "$110.53", "5.121%", or the spread in basis points "+33bp". */
export function fmtLevel(kind: Kind, v: number | null): string {
  if (v === null || !isFinite(v)) return "—";
  if (kind === "price") return "$" + v.toFixed(2);
  if (kind === "yield") return v.toFixed(3) + "%";
  return signed(v * 100, 1) + "bp";
}

/** Change over a window: dollars and percent for oil, basis points for yields and spreads. */
export function fmtChange(kind: Kind, change: number, base: number): string {
  if (!isFinite(change)) return "—";
  if (kind === "price") {
    const pct = base !== 0 ? (change / base) * 100 : 0;
    return `${signed(change, 2)} (${signed(pct, 2)}%)`;
  }
  return signed(change * 100, 1) + "bp";
}

/**
 * Up/down/flat for colouring. Moves that round to zero at display precision
 * (under 0.05bp for rates, under half a cent for oil) count as flat.
 */
export function direction(kind: Kind, change: number): "up" | "down" | "flat" {
  const eps = kind === "price" ? 0.005 : 0.0005;
  if (change > eps) return "up";
  if (change < -eps) return "down";
  return "flat";
}

/** Y-axis bounds that always include the base line, padded so the line never touches the edge. */
export function yDomain(trend: Trend): [number, number] {
  let lo = trend.base;
  let hi = trend.base;
  for (const p of trend.points) {
    if (p.v < lo) lo = p.v;
    if (p.v > hi) hi = p.v;
  }
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.001 || 0.01;
  return [lo - pad, hi + pad];
}

/** Tooltip timestamp, scaled to the window: "3:45 PM", "Mon 3:45 PM", "Oct 14". */
export function fmtTime(t: number, window: WindowKey): string {
  const d = new Date(t);
  if (window === "month") return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return window === "day" ? time : d.toLocaleDateString("en-US", { weekday: "short" }) + " " + time;
}

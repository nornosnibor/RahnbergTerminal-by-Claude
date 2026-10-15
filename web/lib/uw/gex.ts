import { num, type Row } from "./format";

export type GexMode = "oi" | "vol" | "dir";
export type Greek = "gamma" | "delta" | "vanna" | "charm";

export type StrikeBar = { strike: number; call: number; put: number; net: number };

/**
 * Per-strike exposure from `/spot-exposures/strike` (fields like `call_gamma_oi`) or
 * `/greek-exposure/strike` (fields like `call_gex`). Puts are reported negative by UW for
 * gamma; we keep the sign as given and net = call + put.
 * "dir" (directionalized) = ask-side minus bid-side exposure, i.e. what dealers took on today.
 */
export function strikeExposure(rows: Row[], greek: Greek = "gamma", mode: GexMode = "oi"): StrikeBar[] {
  const pick = (r: Row, side: "call" | "put"): number => {
    if (mode === "dir") {
      const ask = num(r[`${side}_${greek}_ask`]);
      const bid = num(r[`${side}_${greek}_bid`]);
      if (ask !== null || bid !== null) return (ask ?? 0) - (bid ?? 0);
    }
    const direct = num(r[`${side}_${greek}_${mode === "dir" ? "vol" : mode}`]);
    if (direct !== null) return direct;
    const alt = greek === "gamma" ? num(r[`${side}_gex`]) : num(r[`${side}_${greek}`]);
    return alt ?? 0;
  };
  const byStrike = new Map<number, StrikeBar>();
  for (const r of rows) {
    const strike = num(r.strike);
    if (strike === null) continue;
    const bar = byStrike.get(strike) ?? { strike, call: 0, put: 0, net: 0 };
    bar.call += pick(r, "call");
    bar.put += pick(r, "put");
    bar.net = bar.call + bar.put;
    byStrike.set(strike, bar);
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

export type Levels = { callWall: number | null; putWall: number | null; flip: number | null; magnet: number | null };

/** Same definitions UW documents for /gex-levels, computed client-side as a fallback/cross-check. */
export function computeLevels(bars: StrikeBar[], spot: number | null): Levels {
  if (!bars.length) return { callWall: null, putWall: null, flip: null, magnet: null };
  const s = spot ?? bars[Math.floor(bars.length / 2)].strike;
  const above = bars.filter((b) => b.strike >= s && b.net > 0);
  const below = bars.filter((b) => b.strike <= s && b.net > 0);
  const maxBy = (arr: StrikeBar[], f: (b: StrikeBar) => number) => (arr.length ? arr.reduce((m, b) => (f(b) > f(m) ? b : m)) : null);
  let flip: number | null = null;
  let bestDist = Infinity;
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1];
    const b = bars[i];
    if ((a.net <= 0 && b.net > 0) || (a.net >= 0 && b.net < 0)) {
      const x = a.strike + ((b.strike - a.strike) * Math.abs(a.net)) / (Math.abs(a.net) + Math.abs(b.net) || 1);
      if (Math.abs(x - s) < bestDist) {
        bestDist = Math.abs(x - s);
        flip = Number(x.toFixed(2));
      }
    }
  }
  return {
    callWall: maxBy(above, (b) => b.net)?.strike ?? null,
    putWall: maxBy(below, (b) => b.net)?.strike ?? null,
    flip,
    magnet: maxBy(bars, (b) => Math.abs(b.net))?.strike ?? null,
  };
}

/** Keep the ladder readable: only strikes within ±pct of spot. */
export function windowAround(bars: StrikeBar[], spot: number | null, pct: number): StrikeBar[] {
  if (!spot || pct <= 0) return bars;
  return bars.filter((b) => Math.abs(b.strike - spot) / spot <= pct);
}

/** Running net premium from tick rows (`net_call_premium`, `net_put_premium`). */
export function cumulativeFlow(rows: Row[]): Array<{ t: string; calls: number; puts: number; net: number }> {
  let c = 0;
  let p = 0;
  return rows
    .map((r) => {
      c += num(r.net_call_premium) ?? 0;
      p += num(r.net_put_premium) ?? 0;
      return { t: String(r.tape_time ?? r.timestamp ?? r.time ?? r.date ?? ""), calls: c, puts: p, net: c - p };
    })
    .filter((x) => x.t);
}

export function pctFrom(level: number | null, spot: number | null): number | null {
  return level === null || !spot ? null : ((level - spot) / spot) * 100;
}

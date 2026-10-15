import { describe, expect, it } from "vitest";
import { computeLevels, cumulativeFlow, pctFrom, strikeExposure, windowAround } from "../gex";

// A ladder where puts dominate below 100 and calls above — the flip sits between 99 and 101.
const spotRows = [
  { strike: "97", call_gamma_oi: "10", put_gamma_oi: "-80", call_gamma_ask: "5", call_gamma_bid: "1", put_gamma_ask: "-2", put_gamma_bid: "-1" },
  { strike: "99", call_gamma_oi: "20", put_gamma_oi: "-40", call_gamma_ask: "6", call_gamma_bid: "2", put_gamma_ask: "-3", put_gamma_bid: "-1" },
  { strike: "101", call_gamma_oi: "60", put_gamma_oi: "-20", call_gamma_ask: "9", call_gamma_bid: "1", put_gamma_ask: "-1", put_gamma_bid: "0" },
  { strike: "103", call_gamma_oi: "90", put_gamma_oi: "-10", call_gamma_ask: "4", call_gamma_bid: "1", put_gamma_ask: "0", put_gamma_bid: "0" },
  { strike: "95", call_gamma_oi: "5", put_gamma_oi: "10", call_gamma_ask: "0", call_gamma_bid: "0", put_gamma_ask: "0", put_gamma_bid: "0" },
];

describe("strikeExposure", () => {
  it("nets call + put exposure per strike, sorted", () => {
    const bars = strikeExposure(spotRows, "gamma", "oi");
    expect(bars.map((b) => b.strike)).toEqual([95, 97, 99, 101, 103]);
    expect(bars.find((b) => b.strike === 101)).toEqual({ strike: 101, call: 60, put: -20, net: 40 });
  });
  it("directionalized mode = ask minus bid", () => {
    const b = strikeExposure(spotRows, "gamma", "dir").find((x) => x.strike === 101)!;
    expect(b.call).toBe(8);
    expect(b.put).toBe(-1);
  });
  it("falls back to greek-exposure field names (call_gex)", () => {
    const bars = strikeExposure([{ strike: 10, call_gex: "5", put_gex: "-2" }], "gamma", "oi");
    expect(bars[0].net).toBe(3);
  });
});

describe("computeLevels", () => {
  const bars = strikeExposure(spotRows, "gamma", "oi");
  it("finds walls, flip and magnet relative to spot", () => {
    const l = computeLevels(bars, 100);
    expect(l.callWall).toBe(103);
    expect(l.putWall).toBe(95);
    expect(l.flip).toBeGreaterThan(99);
    expect(l.flip).toBeLessThan(101);
    expect(l.magnet).toBe(103);
  });
  it("handles empty input", () => {
    expect(computeLevels([], 100)).toEqual({ callWall: null, putWall: null, flip: null, magnet: null });
  });
  it("windows strikes around spot", () => {
    expect(windowAround(bars, 100, 0.02).map((b) => b.strike)).toEqual([99, 101]);
    expect(windowAround(bars, null, 0.02)).toHaveLength(5);
  });
});

describe("flow helpers", () => {
  it("accumulates net premium ticks", () => {
    const f = cumulativeFlow([
      { tape_time: "t1", net_call_premium: "100", net_put_premium: "50" },
      { tape_time: "t2", net_call_premium: "-20", net_put_premium: "30" },
    ]);
    expect(f.at(-1)).toEqual({ t: "t2", calls: 80, puts: 80, net: 0 });
  });
  it("pctFrom", () => {
    expect(pctFrom(110, 100)).toBeCloseTo(10);
    expect(pctFrom(null, 100)).toBeNull();
  });
});

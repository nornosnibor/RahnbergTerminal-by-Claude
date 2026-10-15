import { describe, expect, it } from "vitest";
import { cellClass, columnKind, fmtCell, humanize, nestedTables, num, toCsv, toRows } from "../format";

describe("num", () => {
  it("coerces UW numeric strings", () => {
    expect(num("12345.00")).toBe(12345);
    expect(num("-0.05")).toBe(-0.05);
    expect(num(".5")).toBe(0.5);
    expect(num("1e6")).toBe(1e6);
    expect(num("AAPL")).toBeNull();
    expect(num("2026-10-14")).toBeNull();
    expect(num("")).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(NaN)).toBeNull();
  });
});

describe("columnKind + fmtCell", () => {
  it("formats premiums as money with suffixes", () => {
    expect(columnKind("total_premium", "186705")).toBe("money");
    expect(fmtCell("total_premium", "186705")).toBe("$186.7K");
    expect(fmtCell("net_call_premium", "-2500000")).toBe("-$2.50M");
  });
  it("formats fractions as percentages", () => {
    expect(columnKind("implied_move_perc", "0.066")).toBe("pct");
    expect(fmtCell("implied_move_perc", "0.066")).toBe("6.60%");
    expect(fmtCell("iv_rank", "45")).toBe("45.0%");
  });
  it("formats prices and strikes", () => {
    expect(columnKind("strike", "375")).toBe("price");
    expect(fmtCell("underlying_price", "372.99")).toBe("372.99");
    expect(fmtCell("call_wall", "600")).toBe("600.00");
  });
  it("formats volumes and greeks compactly", () => {
    expect(fmtCell("volume", 2442)).toBe("2,442");
    expect(fmtCell("open_interest", 7913000)).toBe("7.91M");
    expect(fmtCell("call_gamma_oi", "-178109539132.43")).toBe("-178.11B");
  });
  it("handles tickers, sides, dates, booleans, blanks and arrays", () => {
    expect(columnKind("ticker", "MSFT")).toBe("ticker");
    expect(columnKind("type", "call")).toBe("side");
    expect(columnKind("expiry", "2026-10-16")).toBe("date");
    expect(fmtCell("expiry", "2026-10-16")).toBe("2026-10-16");
    expect(fmtCell("has_sweep", true)).toBe("✓");
    expect(fmtCell("anything", null)).toBe("—");
    expect(fmtCell("tickers", ["SPY", "QQQ"])).toBe("SPY, QQQ");
  });
});

describe("cellClass", () => {
  it("colors calls/puts and signed metrics", () => {
    expect(cellClass("type", "call")).toBe("up");
    expect(cellClass("type", "put")).toBe("down");
    expect(cellClass("net_premium", "-5")).toBe("down");
    expect(cellClass("net_premium", "5")).toBe("up");
    expect(cellClass("volume", "5")).toBe("");
    expect(cellClass("ticker", "SPY")).toContain("amber");
  });
});

describe("rows", () => {
  it("normalizes payloads and unwraps single nested lists", () => {
    expect(toRows({ data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(toRows({ data: { dividends: [{ x: 1 }], ticker: "A" } })).toEqual([{ x: 1 }]);
    expect(toRows({ data: { a: 1 } })).toEqual([{ a: 1 }]);
  });
  it("finds every nested table for the explorer", () => {
    const t = nestedTables({ data: { most_active: [{ t: "A" }], top_gainers: [{ t: "B" }], last_updated: "x" } });
    expect(t.map((x) => x.key)).toEqual(["most_active", "top_gainers"]);
  });
  it("exports CSV with escaping", () => {
    expect(toCsv([{ a: 'he said "hi"', b: 1 }, { a: "x,y", b: null }], ["a", "b"])).toBe('a,b\n"he said ""hi""",1\n"x,y",');
  });
  it("humanizes column names", () => {
    expect(humanize("call_volume_ask_side")).toBe("Call Vol Ask Side");
    expect(humanize("total_premium")).toBe("Total Prem");
  });
});

import { describe, expect, it } from "vitest";
import { applyTable, columnsOf, parseFilter, parseNum } from "../table";

const rows = [
  { ticker: "SPY", type: "call", total_premium: "1500000", dte: 0 },
  { ticker: "QQQ", type: "put", total_premium: "250000", dte: 3 },
  { ticker: "NVDA", type: "call", total_premium: "75000", dte: 30 },
  { ticker: "TSLA", type: "put", total_premium: null, dte: 7 },
];

describe("parseNum", () => {
  it("understands k/m/b suffixes", () => {
    expect(parseNum("1m")).toBe(1e6);
    expect(parseNum("2.5k")).toBe(2500);
    expect(parseNum("-3B")).toBe(-3e9);
    expect(parseNum("abc")).toBeNull();
  });
});

describe("parseFilter", () => {
  it("supports comparisons", () => {
    expect(parseFilter(">1m")!("1500000")).toBe(true);
    expect(parseFilter(">1m")!("250000")).toBe(false);
    expect(parseFilter("<=3")!(3)).toBe(true);
    expect(parseFilter(">0")!(null)).toBe(false);
  });
  it("supports ranges, equality, negation, substring and alternatives", () => {
    expect(parseFilter("1..7")!(3)).toBe(true);
    expect(parseFilter("1..7")!(30)).toBe(false);
    expect(parseFilter("=call")!("call")).toBe(true);
    expect(parseFilter("=call")!("calls")).toBe(false);
    expect(parseFilter("!put")!("call")).toBe(true);
    expect(parseFilter("sp")!("SPY")).toBe(true);
    expect(parseFilter("spy|qqq")!("QQQ")).toBe(true);
    expect(parseFilter("")).toBeNull();
  });
});

describe("applyTable", () => {
  it("filters, searches and sorts with blanks last", () => {
    expect(applyTable(rows, { filters: { type: "=call" } }).map((r) => r.ticker)).toEqual(["SPY", "NVDA"]);
    expect(applyTable(rows, { search: "nv" }).map((r) => r.ticker)).toEqual(["NVDA"]);
    expect(applyTable(rows, { sort: { key: "total_premium", dir: "desc" } }).map((r) => r.ticker)).toEqual(["SPY", "QQQ", "NVDA", "TSLA"]);
    expect(applyTable(rows, { sort: { key: "total_premium", dir: "asc" } }).map((r) => r.ticker)).toEqual(["NVDA", "QQQ", "SPY", "TSLA"]);
    expect(applyTable(rows, { filters: { total_premium: ">100k", dte: "<5" } }).map((r) => r.ticker)).toEqual(["SPY", "QQQ"]);
  });
  it("collects columns with preferred order first", () => {
    expect(columnsOf(rows, ["dte", "missing", "ticker"])).toEqual(["dte", "ticker", "type", "total_premium"]);
  });
});

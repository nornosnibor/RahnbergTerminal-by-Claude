import { describe, expect, it } from "vitest";
import { buildPath, catalog, matchEndpoint, toRows } from "./catalog.js";

describe("uw catalog", () => {
  it("covers the full Unusual Whales API", () => {
    expect(catalog.endpoints.length).toBeGreaterThanOrEqual(230);
    const ids = new Set(catalog.endpoints.map((e) => `${e.method} ${e.path}`));
    expect(ids.size).toBe(catalog.endpoints.length);
    for (const p of ["/api/stock/{ticker}/gex-levels", "/api/option-trades/flow-alerts", "/api/screener/stocks", "/api/market/market-tide", "/api/darkpool/recent"]) {
      expect(ids.has(`GET ${p}`)).toBe(true);
    }
  });

  it("matches concrete paths and extracts params", () => {
    const m = matchEndpoint("GET", "/api/stock/AAPL/spot-exposures/strike")!;
    expect(m.endpoint.path).toBe("/api/stock/{ticker}/spot-exposures/strike");
    expect(m.pathParams).toEqual({ ticker: "AAPL" });
    expect(m.upstreamPath).toBe("/api/stock/AAPL/spot-exposures/strike");
  });

  it("prefers literal segments over placeholders", () => {
    expect(matchEndpoint("GET", "/api/insider/transactions")!.endpoint.path).toBe("/api/insider/transactions");
    expect(matchEndpoint("GET", "/api/insider/TSLA")!.endpoint.path).toBe("/api/insider/{ticker}");
    expect(matchEndpoint("GET", "/api/flex-options/market")!.endpoint.path).toBe("/api/flex-options/market");
  });

  it("decodes and re-encodes params with spaces", () => {
    const m = matchEndpoint("GET", "/api/institution/VANGUARD%20GROUP%20INC/holdings")!;
    expect(m.pathParams.name).toBe("VANGUARD GROUP INC");
    expect(m.upstreamPath).toBe("/api/institution/VANGUARD%20GROUP%20INC/holdings");
  });

  it("rejects traversal and unknown routes", () => {
    expect(() => matchEndpoint("GET", "/api/stock/..%2F..%2Fadmin/info")).toThrow(/Invalid path parameter/);
    expect(() => matchEndpoint("GET", "/api/stock/%2E%2E/info")).toThrow(/Invalid path parameter/);
    expect(matchEndpoint("GET", "/api/not/a/real/endpoint")).toBeNull();
    expect(matchEndpoint("DELETE", "/api/stock/AAPL/info")).toBeNull();
  });

  it("matches write endpoints only with their method", () => {
    expect(matchEndpoint("POST", "/api/watchlists/stocks")!.endpoint.method).toBe("POST");
    expect(matchEndpoint("PUT", "/api/watchlists/stocks/42")!.pathParams.id).toBe("42");
  });

  it("buildPath requires every placeholder", () => {
    expect(buildPath("/api/stock/{ticker}/greek-flow/{expiry}", { ticker: "SPY", expiry: "2026-10-16" })).toBe("/api/stock/SPY/greek-flow/2026-10-16");
    expect(() => buildPath("/api/stock/{ticker}/info", {})).toThrow(/Missing path parameter/);
  });

  it("toRows normalizes every payload shape", () => {
    expect(toRows({ data: [{ a: 1 }, { a: 2 }] })).toEqual([{ a: 1 }, { a: 2 }]);
    expect(toRows({ data: { a: 1 } })).toEqual([{ a: 1 }]);
    expect(toRows([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(toRows({ a: 1 })).toEqual([{ a: 1 }]);
    expect(toRows({ data: [[1, 2]] })).toEqual([{ col0: 1, col1: 2 }]);
    expect(toRows({ data: ["SPY", "QQQ"] })).toEqual([{ value: "SPY" }, { value: "QQQ" }]);
    expect(toRows({ data: null })).toEqual([]);
  });
});

describe("toRows nested lists", () => {
  it("unwraps a single nested list of rows", () => {
    expect(toRows({ data: { dividends: [{ amount: 1 }, { amount: 2 }], ticker: "AAPL" } })).toEqual([{ amount: 1 }, { amount: 2 }]);
  });
  it("keeps objects with several lists intact", () => {
    const body = { data: { a: [{ x: 1 }], b: [{ y: 2 }] } };
    expect(toRows(body)).toEqual([body.data]);
  });
});

import { describe, expect, it } from "vitest";
import { buildUwUrl } from "../api";
import { CONTRACT_PRESETS, FLOW_PRESETS, SCAN_TARGETS, SCREENER_PRESETS } from "../presets";
import catalog from "../../../../server/src/uw/catalog.json";

describe("buildUwUrl", () => {
  it("fills path params and builds the query string", () => {
    expect(buildUwUrl("/api/stock/{ticker}/gex-levels", { ticker: "SPY", date: "2026-10-14" })).toBe("/api/uw/proxy/api/stock/SPY/gex-levels?date=2026-10-14");
  });
  it("repeats array params and drops blanks", () => {
    expect(buildUwUrl("/api/screener/stocks", { "issue_types[]": ["ETF", "ADR"], min_marketcap: "", is_s_p_500: true, x: undefined })).toBe(
      "/api/uw/proxy/api/screener/stocks?issue_types%5B%5D=ETF&issue_types%5B%5D=ADR&is_s_p_500=true"
    );
  });
  it("encodes path params with spaces", () => {
    expect(buildUwUrl("/api/institution/{name}/holdings", { name: "VANGUARD GROUP INC" })).toBe("/api/uw/proxy/api/institution/VANGUARD%20GROUP%20INC/holdings");
  });
  it("throws when a path param is missing", () => {
    expect(() => buildUwUrl("/api/stock/{ticker}/info", {})).toThrow(/Missing ticker/);
  });
});

// Presets must only use parameters the real API accepts — catches typos before they 422.
describe("presets match the API catalog", () => {
  const paramsOf = (path: string) => new Set(catalog.endpoints.find((e) => e.path === path && e.method === "GET")!.params.map((p) => p.name));
  const check = (path: string, presets: Array<{ id: string; params: Record<string, unknown> }>) => {
    const allowed = paramsOf(path);
    for (const p of presets) for (const k of Object.keys(p.params)) expect(allowed.has(k), `${p.id}: ${k} not a param of ${path}`).toBe(true);
  };
  it("flow presets", () => check("/api/option-trades/flow-alerts", FLOW_PRESETS));
  it("screener presets", () => check("/api/screener/stocks", SCREENER_PRESETS));
  it("contract presets", () => check("/api/screener/option-contracts", CONTRACT_PRESETS));
  it("scan targets exist and take a ticker", () => {
    for (const t of SCAN_TARGETS) expect(catalog.endpoints.some((e) => e.path === t.path && e.path.includes("{ticker}")), t.path).toBe(true);
  });
});

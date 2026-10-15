import { describe, expect, it } from "vitest";
import { latestRow, sortByTime } from "../format";
import { valuation } from "../value";

const income = [
  { fiscal_date_ending: "2026-06-30", report_type: "quarterly", net_income: "30", ebitda: "40" },
  { fiscal_date_ending: "2026-03-31", report_type: "quarterly", net_income: "30", ebitda: "40" },
  { fiscal_date_ending: "2025-12-31", report_type: "quarterly", net_income: "40", ebitda: "50" },
  { fiscal_date_ending: "2025-09-30", report_type: "quarterly", net_income: "20", ebitda: "30" },
  { fiscal_date_ending: "2025-06-30", report_type: "quarterly", net_income: "999", ebitda: "999" },
  { fiscal_date_ending: "2025-09-30", report_type: "annual", net_income: "5000", ebitda: "5000" },
];

describe("valuation (basic plan, no /companies/profile)", () => {
  const v = valuation({
    spot: 100,
    info: { full_name: "APPLE", sector: "Technology", outstanding: "10", marketcap: "1000", beta: "0.6", short_description: "Phones." },
    screener: { week_52_high: "120", week_52_low: "80", dividend_yield: "0.004", eps_growth_4q: "0.2", industry_type: "Consumer Electronics" },
    income,
    analysts: [
      { timestamp: "2026-10-12T00:00:00Z", target: "120" },
      { timestamp: "2026-10-01T00:00:00Z", target: "110" },
      { timestamp: "2025-01-01T00:00:00Z", target: "50" },
    ],
    now: Date.parse("2026-10-15T00:00:00Z"),
  });
  it("derives TTM EPS and P/E from the last 4 quarters", () => {
    expect(v.eps).toBe(12); // (30+30+40+20)/10
    expect(v.pe).toBeCloseTo(100 / 12);
    expect(v.ebitda).toBe(160);
    expect(v.peg).toBeCloseTo(100 / 12 / 20);
  });
  it("averages only recent analyst targets", () => {
    expect(v.analystTarget).toBe(115);
    expect(v.analystCount).toBe(2);
  });
  it("fills the rest from info + screener", () => {
    expect(v).toMatchObject({ name: "APPLE", sector: "Technology", industry: "Consumer Electronics", marketCap: 1000, beta: 0.6, week52High: 120, week52Low: 80, dividendYield: 0.004, derived: true });
  });
  it("returns nulls instead of guessing when data is missing", () => {
    const e = valuation({ spot: 100, income: income.slice(0, 2) });
    expect(e.eps).toBeNull();
    expect(e.pe).toBeNull();
    expect(e.analystTarget).toBeNull();
  });
  it("prefers /companies/profile when available", () => {
    const p = valuation({ spot: 100, profile: { name: "Apple Inc", pe_ratio: "30", eps: "6.1", analyst_target_price: "300" }, income });
    expect(p).toMatchObject({ name: "Apple Inc", pe: 30, eps: 6.1, analystTarget: 300, derived: false });
  });
});

describe("time ordering", () => {
  it("latestRow handles newest-first series (NOPE, short interest)", () => {
    expect(latestRow([{ timestamp: "2026-10-15T19:59:00Z", v: 2 }, { timestamp: "2026-10-15T13:30:00Z", v: 1 }])!.v).toBe(2);
    expect(latestRow([{ market_date: "2026-09-30", v: 2 }, { market_date: "2021-06-15", v: 1 }])!.v).toBe(2);
  });
  it("sortByTime returns oldest first", () => {
    expect(sortByTime([{ date: "2026-10-15" }, { date: "2026-10-09" }]).map((r) => r.date)).toEqual(["2026-10-09", "2026-10-15"]);
  });
});

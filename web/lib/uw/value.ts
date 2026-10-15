import { num, type Row } from "./format";

export type Valuation = {
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  eps: number | null;
  pe: number | null;
  peg: number | null;
  ebitda: number | null;
  dividendYield: number | null; // fraction, 0.003 = 0.3%
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  analystTarget: number | null;
  analystCount: number;
  description: string | null;
  derived: boolean; // true when built from basic-plan endpoints instead of /companies/profile
};

const sumLast4Quarters = (rows: Row[], key: string): number | null => {
  const q = rows
    .filter((r) => String(r.report_type ?? "quarterly").toLowerCase() === "quarterly" && num(r[key]) !== null)
    .sort((a, b) => String(b.fiscal_date_ending).localeCompare(String(a.fiscal_date_ending)))
    .slice(0, 4);
  return q.length === 4 ? q.reduce((s, r) => s + num(r[key])!, 0) : null;
};

/**
 * Company valuation stats. Uses `/companies/profile` when the plan includes it (Advanced tier),
 * otherwise derives them: TTM EPS = last 4 quarters' net income / shares outstanding,
 * P/E = spot / EPS, analyst target = mean of ratings in the last 90 days.
 */
export function valuation(input: { spot: number | null; profile?: Row; info?: Row; screener?: Row; income?: Row[]; analysts?: Row[]; now?: number }): Valuation {
  const { spot, profile: p, info, screener: sc, income = [], analysts = [] } = input;
  const now = input.now ?? Date.now();
  const shares = num(info?.outstanding) ?? num(p?.shares_outstanding);
  const ni = sumLast4Quarters(income, "net_income");
  const eps = num(p?.eps) ?? (ni !== null && shares ? ni / shares : null);
  const pe = num(p?.pe_ratio) ?? (eps && eps > 0 && spot ? spot / eps : null);
  const growth = num(sc?.eps_growth_4q); // fraction
  const peg = num(p?.peg_ratio) ?? (pe && growth && growth > 0 ? pe / (growth * 100) : null);
  const recent = analysts.filter((a) => num(a.target) !== null && now - Date.parse(String(a.timestamp)) <= 90 * 86_400_000);
  const target = num(p?.analyst_target_price) ?? (recent.length ? recent.reduce((s, a) => s + num(a.target)!, 0) / recent.length : null);
  return {
    name: (p?.name ?? info?.full_name ?? null) as string | null,
    sector: (p?.sector ?? info?.sector ?? sc?.sector ?? null) as string | null,
    industry: (p?.industry ?? sc?.industry_type ?? null) as string | null,
    marketCap: num(p?.market_cap) ?? num(info?.marketcap) ?? num(sc?.marketcap),
    eps,
    pe,
    peg,
    ebitda: num(p?.ebitda) ?? sumLast4Quarters(income, "ebitda"),
    dividendYield: num(p?.dividend_yield) ?? num(sc?.dividend_yield),
    beta: num(p?.beta) ?? num(info?.beta),
    week52High: num(p?.week_52_high) ?? num(sc?.week_52_high),
    week52Low: num(p?.week_52_low) ?? num(sc?.week_52_low),
    analystTarget: target,
    analystCount: p?.analyst_target_price ? 0 : recent.length,
    description: (p?.description ?? info?.short_description ?? null) as string | null,
    derived: !p,
  };
}

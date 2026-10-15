"use client";

import { useMemo, useState } from "react";
import { useUw, UwHttpError } from "../../../lib/uw/api";
import { fmtBigNum, latestRow, num, toRows, type Row } from "../../../lib/uw/format";
import { valuation } from "../../../lib/uw/value";
import { useTerminal } from "../../../store/terminal";
import { COLORS, SimpleBars } from "../charts";
import DataTable from "../DataTable";
import { EndpointTable, ErrorNote, ExplorerLink, Panel, Segmented, Stat } from "../ui";
import { useSpot } from "./Cockpit";

type Statement = "income-statements" | "balance-sheets" | "cash-flows";

/** Fraction → percent, keeping missing values missing (a gap in the chart, not a fake 0). */
const x100 = (v: number | null) => (v === null ? null : v * 100);
const STATEMENT_COLS: Record<Statement, string[]> = {
  "income-statements": ["fiscal_date_ending", "report_type", "total_revenue", "gross_profit", "operating_income", "ebitda", "net_income", "research_and_development", "operating_expenses"],
  "balance-sheets": ["fiscal_date_ending", "report_type", "total_assets", "total_liabilities", "total_shareholder_equity", "cash_and_cash_equivalents", "long_term_debt", "short_term_debt", "total_current_assets", "total_current_liabilities", "retained_earnings"],
  "cash-flows": ["fiscal_date_ending", "report_type", "operating_cashflow", "capital_expenditures", "free_cash_flow", "dividend_payout", "payments_for_repurchase_of_common_stock", "stock_based_compensation", "change_in_cash_and_cash_equivalents"],
};

/** Quarterly revenue / net income bars, oldest → newest (annual rows would dwarf the quarters). */
function trend(rows: Row[]) {
  return rows
    .filter((r) => String(r.report_type ?? "quarterly").toLowerCase() === "quarterly")
    .map((r) => ({
      period: String(r.fiscal_date_ending ?? r.date ?? "").slice(0, 7),
      revenue: num(r.total_revenue) ?? 0,
      net_income: num(r.net_income) ?? 0,
    }))
    .filter((r) => r.period)
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-16);
}

function Financials({ ticker }: { ticker: string }) {
  const [kind, setKind] = useState<Statement>("income-statements");
  const path = `/api/stock/{ticker}/${kind}`;
  const q = useUw(path, { ticker });
  const rows = useMemo(
    () =>
      toRows(q.data).map((r) =>
        kind === "cash-flows" && num(r.operating_cashflow) !== null
          ? { ...r, free_cash_flow: num(r.operating_cashflow)! - Math.abs(num(r.capital_expenditures) ?? 0) }
          : r
      ),
    [q.data, kind]
  );
  const income = useUw("/api/stock/{ticker}/income-statements", { ticker });
  const bars = useMemo(() => trend(toRows(income.data)), [income.data]);
  return (
    <>
      <Panel className="col-span-12 xl:col-span-5 h-[340px]" title={`Revenue & net income · ${ticker}`} right={<ExplorerLink path="/api/stock/{ticker}/income-statements" params={{ ticker }} />}>
        <ErrorNote error={income.error} />
        <SimpleBars data={bars} x="period" bars={[{ key: "revenue", name: "Revenue", color: "#40c4ff" }, { key: "net_income", name: "Net income", color: COLORS.UP }]} />
      </Panel>
      <Panel
        className="col-span-12 xl:col-span-7 h-[340px]"
        title={`Financial statements · ${ticker}`}
        right={
          <>
            <Segmented value={kind} onChange={setKind} options={[{ value: "income-statements", label: "income" }, { value: "balance-sheets", label: "balance" }, { value: "cash-flows", label: "cash flow" }]} />
            <ExplorerLink path={path} params={{ ticker }} />
          </>
        }
      >
        <ErrorNote error={q.error} />
        <DataTable key={kind} rows={rows} columns={STATEMENT_COLS[kind]} name={`${ticker}-${kind}`} initialSort={{ key: "fiscal_date_ending", dir: "desc" }} />
      </Panel>
    </>
  );
}

function Seasonality({ ticker }: { ticker: string }) {
  const q = useUw("/api/seasonality/{ticker}/monthly", { ticker });
  const data = useMemo(
    () => toRows(q.data).map((r) => ({ month: String(r.month), avg: x100(num(r.avg_change)), positive: x100(num(r.positive_months_perc)) })),
    [q.data]
  );
  return (
    <Panel className="col-span-12 xl:col-span-4 h-[280px]" title={`Seasonality — avg monthly return % · ${ticker}`} right={<ExplorerLink path="/api/seasonality/{ticker}/monthly" params={{ ticker }} />}>
      <ErrorNote error={q.error} />
      <SimpleBars data={data} x="month" bars={[{ key: "avg", name: "Avg %", color: COLORS.AMBER }]} signed />
    </Panel>
  );
}

export default function Value() {
  const ticker = useTerminal((s) => s.activeSymbol).replace(/^\^/, "");
  const { spot } = useSpot(ticker);
  // /companies/profile needs the Advanced tier; without it the same stats are derived from
  // info + screener + income statements + analyst ratings (see lib/uw/value.ts).
  const profileQ = useUw("/api/companies/{ticker}/profile", { ticker });
  const restricted = profileQ.error instanceof UwHttpError && profileQ.error.planRestricted;
  const info = toRows(useUw("/api/stock/{ticker}/info", { ticker }).data)[0];
  const screener = toRows(useUw("/api/screener/stocks", { ticker }).data)[0];
  const income = toRows(useUw("/api/stock/{ticker}/income-statements", { ticker }).data);
  const analysts = toRows(useUw("/api/screener/analysts", { ticker, limit: 100 }).data);
  const sh = latestRow(toRows(useUw("/api/shorts/{ticker}/interest-float/v2", { ticker }).data));
  const val = valuation({ spot, profile: restricted ? undefined : toRows(profileQ.data)[0], info, screener, income, analysts });
  const target = val.analystTarget;
  const upside = target && spot ? ((target - spot) / spot) * 100 : null;
  const lo = val.week52Low;
  const hi = val.week52High;
  const rangePos = lo !== null && hi !== null && spot !== null && hi > lo ? ((spot - lo) / (hi - lo)) * 100 : null;
  const f = (n: number | null, d = 2) => (n === null ? "—" : n.toFixed(d));
  const pct = (n: number | null) => (n === null ? "—" : `${(n < 1 ? n * 100 : n).toFixed(2)}%`);

  return (
    <div className="grid gap-1 p-1 grid-cols-12 auto-rows-min">
      <div className="col-span-12 flex flex-wrap gap-1">
        <Stat label={val.name ?? ticker} value={spot ?? "—"} sub={[val.sector, val.industry].filter(Boolean).join(" · ") || undefined} />
        <Stat label="Market cap" value={val.marketCap ? fmtBigNum(val.marketCap) : "—"} />
        <Stat label="P/E (ttm)" value={f(val.pe, 1)} sub={`PEG ${f(val.peg)}`} />
        <Stat label="EPS (ttm)" value={f(val.eps)} />
        <Stat label="Div yield" value={pct(val.dividendYield)} />
        <Stat
          label="Analyst target"
          value={target === null ? "—" : f(target)}
          sub={upside === null ? undefined : `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}% vs spot${val.analystCount ? ` · ${val.analystCount} ratings/90d` : ""}`}
          cls={upside === null ? "" : upside >= 0 ? "up" : "down"}
        />
        <Stat label="52w range" value={rangePos === null ? "—" : `${rangePos.toFixed(0)}%`} sub={lo !== null ? `${f(lo)} – ${f(hi)}` : undefined} cls={rangePos === null ? "" : rangePos < 25 ? "up" : rangePos > 85 ? "down" : ""} />
        <Stat label="Beta" value={f(val.beta)} />
        <Stat label="EBITDA (ttm)" value={val.ebitda ? fmtBigNum(val.ebitda) : "—"} />
        <Stat label="Short % float" value={num(sh?.si_float) !== null ? `${(num(sh?.si_float)! * (num(sh?.si_float)! < 1 ? 100 : 1)).toFixed(1)}%` : "—"} sub={num(sh?.days_to_cover) !== null ? `${num(sh?.days_to_cover)!.toFixed(1)} days to cover` : undefined} />
      </div>
      {val.description ? <div className="col-span-12 text-[11px] dim px-1 line-clamp-2" title={val.description}>{val.description}</div> : null}
      {val.derived && <div className="col-span-12 text-[10px] dim px-1">P/E, EPS and EBITDA are computed from the last four quarterly reports; analyst target is the 90-day average of rating changes.</div>}

      <Financials ticker={ticker} />

      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[300px]"
        title={`Earnings history & surprises · ${ticker}`}
        path="/api/stock/{ticker}/earnings"
        params={{ ticker }}
        sort={{ key: "report_date", dir: "desc" }}
        columns={["report_date", "report_time", "estimated_eps", "reported_eps", "surprise", "surprise_percentage", "fiscal_date_ending"]}
      />
      <EndpointTable className="col-span-12 xl:col-span-6 h-[300px]" title={`Forward earnings estimates · ${ticker}`} path="/api/companies/{ticker}/earnings-estimates" params={{ ticker }} />

      <EndpointTable
        className="col-span-12 xl:col-span-8 h-[300px]"
        title={`Analyst ratings · ${ticker}`}
        path="/api/screener/analysts"
        params={{ ticker, limit: 100 }}
        columns={["timestamp", "action", "recommendation", "target", "firm", "analyst_name"]}
      />
      <Seasonality ticker={ticker} />

      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[320px]"
        title={`Institutional ownership · ${ticker}`}
        path="/api/institution/{ticker}/ownership"
        params={{ ticker }}
        sort={{ key: "value", dir: "desc" }}
        columns={["name", "units", "units_change", "value", "avg_price", "filing_date", "report_date", "first_buy"]}
      />
      <EndpointTable className="col-span-12 xl:col-span-6 h-[320px]" title={`Insiders · ${ticker}`} path="/api/insider/{ticker}" params={{ ticker }} />

      <EndpointTable className="col-span-12 xl:col-span-4 h-[280px]" title={`Insider buys & sells · ${ticker}`} path="/api/stock/{ticker}/insider-buy-sells" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[280px]" title={`Dividends · ${ticker}`} path="/api/companies/{ticker}/dividends" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[280px]" title={`Short volume & ratio · ${ticker}`} path="/api/shorts/{ticker}/volume-and-ratio" params={{ ticker }} />
    </div>
  );
}

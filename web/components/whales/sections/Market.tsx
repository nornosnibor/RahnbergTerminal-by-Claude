"use client";

import { useMemo, useState } from "react";
import { useUw, UwHttpError } from "../../../lib/uw/api";
import { num, sortByTime, toRows, type Row } from "../../../lib/uw/format";
import { useTerminal } from "../../../store/terminal";
import { COLORS, FlowLines, SignedBars } from "../charts";
import DataTable from "../DataTable";
import { EndpointTable, ErrorNote, ExplorerLink, Freshness, Panel, Segmented } from "../ui";

const SECTORS = ["Technology", "Healthcare", "Financial Services", "Consumer Cyclical", "Communication Services", "Industrials", "Energy", "Consumer Defensive", "Basic Materials", "Real Estate", "Utilities"];

const tideSeries = (rows: Row[]) =>
  sortByTime(rows).map((r) => ({
    t: String(r.timestamp ?? r.date ?? ""),
    calls: num(r.net_call_premium) ?? 0,
    puts: num(r.net_put_premium) ?? 0,
    spread: (num(r.net_call_premium) ?? 0) - (num(r.net_put_premium) ?? 0),
  }));

function Tide({ path, params }: { path: string; params: Record<string, string | boolean> }) {
  const q = useUw(path, params, { live: true });
  const data = useMemo(() => tideSeries(toRows(q.data)), [q.data]);
  return (
    <>
      <ErrorNote error={q.error} />
      <div className="h-full">
        <FlowLines
          data={data}
          lines={[
            { key: "calls", name: "Net call premium", color: COLORS.UP },
            { key: "puts", name: "Net put premium", color: COLORS.DOWN },
            { key: "spread", name: "Calls − puts", color: COLORS.AMBER },
          ]}
        />
      </div>
    </>
  );
}

/**
 * Top movers. `/api/market/movers` needs the Advanced tier; on other plans the same three lists
 * are built from the stock screener (liquid names > $2B, ranked by today's % change / volume).
 */
function Movers() {
  const [tab, setTab] = useState<"most_active" | "top_gainers" | "top_losers">("most_active");
  const q = useUw("/api/market/movers", {}, { live: true });
  const restricted = q.error instanceof UwHttpError && q.error.planRestricted;
  const fallback = useUw("/api/screener/stocks", { min_marketcap: 2_000_000_000, limit: 500 }, { live: true, enabled: restricted });
  const rows = useMemo((): Row[] => {
    if (!restricted) {
      const body = (q.data as { data?: Record<string, unknown> } | undefined)?.data ?? (q.data as Record<string, unknown> | undefined);
      return (Array.isArray(body?.[tab]) ? body?.[tab] : []) as Row[];
    }
    const list = toRows(fallback.data)
      .map((r) => {
        const close = num(r.close);
        const prev = num(r.prev_close);
        return { ticker: r.ticker, close: r.close, change_perc: close !== null && prev ? (close - prev) / prev : null, stock_volume: r.stock_volume, relative_volume: r.relative_volume, marketcap: r.marketcap, sector: r.sector };
      })
      .filter((r) => r.change_perc !== null);
    const by = (k: "change_perc" | "stock_volume", dir: 1 | -1) => [...list].sort((a, b) => dir * ((num(b[k]) ?? 0) - (num(a[k]) ?? 0)));
    return (tab === "top_gainers" ? by("change_perc", 1) : tab === "top_losers" ? by("change_perc", -1) : by("stock_volume", 1)).slice(0, 25);
  }, [restricted, q.data, fallback.data, tab]);
  const src = restricted ? fallback : q;
  return (
    <Panel
      className="col-span-12 xl:col-span-4 h-[360px]"
      title={restricted ? "Top movers (from screener)" : "Top movers"}
      right={
        <>
          <Segmented value={tab} onChange={setTab} options={[{ value: "most_active", label: "active" }, { value: "top_gainers", label: "gainers" }, { value: "top_losers", label: "losers" }]} />
          <Freshness fetching={src.isFetching} updatedAt={src.dataUpdatedAt} />
          <ExplorerLink path={restricted ? "/api/screener/stocks" : "/api/market/movers"} />
        </>
      }
    >
      <ErrorNote error={restricted ? fallback.error : q.error} />
      <DataTable key={tab} rows={rows} bare />
    </Panel>
  );
}

export default function Market() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [otmOnly, setOtmOnly] = useState(false);
  const [sector, setSector] = useState(SECTORS[0]);
  const [etf, setEtf] = useState("SPY");
  const impact = useUw("/api/market/top-net-impact", { limit: 30 }, { live: true });
  const impactBars = useMemo(
    () =>
      toRows(impact.data)
        .map((r) => ({ label: String(r.ticker ?? ""), value: num(r.net_premium) ?? 0 }))
        .sort((a, b) => b.value - a.value),
    [impact.data]
  );

  return (
    <div className="grid gap-1 p-1 grid-cols-12 auto-rows-min">
      <Panel
        className="col-span-12 xl:col-span-8 h-[360px]"
        title="Market tide — market-wide net options premium"
        right={
          <>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={otmOnly} onChange={(e) => setOtmOnly(e.target.checked)} /> OTM only
            </label>
            <ExplorerLink path="/api/market/market-tide" params={{ interval_5m: true, otm_only: otmOnly }} />
          </>
        }
      >
        <Tide path="/api/market/market-tide" params={{ interval_5m: true, ...(otmOnly ? { otm_only: true } : {}) }} />
      </Panel>
      <Panel
        className="col-span-12 xl:col-span-4 h-[360px]"
        title="Top net premium impact"
        right={
          <>
            <Freshness fetching={impact.isFetching} updatedAt={impact.dataUpdatedAt} />
            <ExplorerLink path="/api/market/top-net-impact" />
          </>
        }
      >
        <ErrorNote error={impact.error} />
        <SignedBars data={impactBars} onPick={setActiveSymbol} />
      </Panel>

      <Panel
        className="col-span-12 xl:col-span-6 h-[300px]"
        title="Sector tide"
        right={
          <>
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="!py-0">
              {SECTORS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <ExplorerLink path="/api/market/{sector}/sector-tide" params={{ sector }} />
          </>
        }
      >
        <Tide path="/api/market/{sector}/sector-tide" params={{ sector }} />
      </Panel>
      <Panel
        className="col-span-12 xl:col-span-6 h-[300px]"
        title="ETF tide"
        right={
          <>
            <select value={etf} onChange={(e) => setEtf(e.target.value)} className="!py-0">
              {["SPY", "QQQ", "IWM", "DIA", "XLF", "XLK", "XLE", "SMH", "TLT"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <ExplorerLink path="/api/market/{ticker}/etf-tide" params={{ ticker: etf }} />
          </>
        }
      >
        <Tide path="/api/market/{ticker}/etf-tide" params={{ ticker: etf }} />
      </Panel>

      <EndpointTable
        className="col-span-12 xl:col-span-8 h-[360px]"
        title="Sector ETFs — flow & premium"
        path="/api/market/sector-etfs"
        live
        columns={["ticker", "full_name", "close", "prev_close", "volume", "call_premium", "put_premium", "bullish_premium", "bearish_premium", "call_volume", "put_volume"]}
      />
      <Movers />

      <EndpointTable className="col-span-12 xl:col-span-6 h-[320px]" title="Economic calendar" path="/api/market/economic-calendar" columns={["time", "event", "type", "forecast", "prev", "reported_period"]} />
      <EndpointTable className="col-span-12 xl:col-span-6 h-[320px]" title="Total options volume (market)" path="/api/market/total-options-volume" params={{ limit: 30 }} />

      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[320px]"
        title="Earnings — premarket"
        path="/api/earnings/premarket"
        columns={["symbol", "full_name", "report_date", "expected_move_perc", "street_mean_est", "actual_eps", "reaction", "marketcap", "sector"]}
      />
      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[320px]"
        title="Earnings — after hours"
        path="/api/earnings/afterhours"
        columns={["symbol", "full_name", "report_date", "expected_move_perc", "street_mean_est", "actual_eps", "reaction", "marketcap", "sector"]}
      />

      <EndpointTable className="col-span-12 xl:col-span-7 h-[360px]" title="Headlines" path="/api/news/headlines" params={{ limit: 100 }} live columns={["created_at", "headline", "tickers", "sentiment", "is_major", "source"]} />
      <EndpointTable className="col-span-12 xl:col-span-5 h-[360px]" title="FDA calendar" path="/api/market/fda-calendar" />

      <EndpointTable className="col-span-12 xl:col-span-6 h-[300px]" title="Net flow by expiry" path="/api/net-flow/expiry" live />
      <EndpointTable className="col-span-12 xl:col-span-6 h-[300px]" title="Market-wide insider buys & sells" path="/api/market/insider-buy-sells" />
    </div>
  );
}

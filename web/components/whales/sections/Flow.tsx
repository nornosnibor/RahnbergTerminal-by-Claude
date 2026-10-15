"use client";

import { useMemo, useState } from "react";
import { useUw, type Params } from "../../../lib/uw/api";
import { fmtBigNum, num, toRows, type Row } from "../../../lib/uw/format";
import { CONTRACT_PRESETS, FLOW_PRESETS } from "../../../lib/uw/presets";
import { useTerminal } from "../../../store/terminal";
import { SignedBars } from "../charts";
import DataTable from "../DataTable";
import { EndpointTable, ErrorNote, ExplorerLink, Freshness, Panel, RefreshButton, Segmented, Stat } from "../ui";

type Tab = "alerts" | "unusual" | "hottest" | "multileg" | "oi";

const FLOW_COLS = ["created_at", "ticker", "type", "strike", "expiry", "total_premium", "total_size", "price", "underlying_price", "volume", "open_interest", "volume_oi_ratio", "total_ask_side_prem", "total_bid_side_prem", "has_sweep", "has_floor", "all_opening_trades", "alert_rule", "iv"];

const clean = (p: Params): Params => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "" && v !== undefined && v !== null && v !== false));

/** Summary of a set of flow alerts: totals, call/put split, and top tickers by net premium. */
function summarize(rows: Row[]) {
  let calls = 0;
  let puts = 0;
  const byTicker = new Map<string, number>();
  for (const r of rows) {
    const prem = num(r.total_premium) ?? 0;
    const isCall = String(r.type).toLowerCase() === "call";
    if (isCall) calls += prem;
    else puts += prem;
    const t = String(r.ticker ?? "");
    byTicker.set(t, (byTicker.get(t) ?? 0) + (isCall ? prem : -prem));
  }
  const top = [...byTicker.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 15)
    .map(([label, value]) => ({ label, value }));
  return { calls, puts, top, count: rows.length };
}

function FlowAlerts() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [preset, setPreset] = useState("unusual");
  const [f, setF] = useState({ tickers: "", side: "", minPrem: "", maxDte: "", minDte: "", ask: false, sweep: false, opening: false, otm: false, volOi: false, sizeOi: false, limit: "200" });
  const base = FLOW_PRESETS.find((p) => p.id === preset)?.params ?? {};
  const params = clean({
    ...base,
    ticker_symbol: f.tickers.replace(/\s+/g, "").toUpperCase(),
    // The side toggle overrides the preset only when set; otherwise keep e.g. "bullish calls".
    is_call: f.side ? f.side === "call" || undefined : base.is_call,
    is_put: f.side ? f.side === "put" || undefined : base.is_put,
    min_premium: f.minPrem ? Number(f.minPrem) : base.min_premium,
    max_dte: f.maxDte !== "" ? Number(f.maxDte) : base.max_dte,
    min_dte: f.minDte !== "" ? Number(f.minDte) : base.min_dte,
    is_ask_side: f.ask || base.is_ask_side,
    is_sweep: f.sweep || base.is_sweep,
    all_opening: f.opening || base.all_opening,
    is_otm: f.otm || base.is_otm,
    vol_greater_oi: f.volOi || base.vol_greater_oi,
    size_greater_oi: f.sizeOi || base.size_greater_oi,
    limit: Number(f.limit),
  });
  const q = useUw("/api/option-trades/flow-alerts", params, { live: true });
  const rows = useMemo(() => toRows(q.data), [q.data]);
  const s = useMemo(() => summarize(rows), [rows]);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  return (
    <div className="grid gap-1 grid-cols-12">
      <div className="col-span-12 flex flex-wrap gap-1">
        {FLOW_PRESETS.map((p) => (
          <button key={p.id} title={p.hint} className={`term-btn ${preset === p.id ? "active" : ""}`} onClick={() => setPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="col-span-12 flex flex-wrap gap-2 items-center text-[11px] bg-[var(--panel)] border border-[var(--border)] p-1">
        <input className="w-40" placeholder="tickers e.g. SPY,QQQ or -TSLA" value={f.tickers} onChange={(e) => set("tickers", e.target.value)} />
        <Segmented value={f.side || "both"} onChange={(v) => set("side", v === "both" ? "" : v)} options={[{ value: "both", label: "C+P" }, { value: "call", label: "calls" }, { value: "put", label: "puts" }]} />
        <input className="w-24" placeholder="min prem $" value={f.minPrem} onChange={(e) => set("minPrem", e.target.value.replace(/[^\d]/g, ""))} />
        <input className="w-16" placeholder="min DTE" value={f.minDte} onChange={(e) => set("minDte", e.target.value.replace(/[^\d]/g, ""))} />
        <input className="w-16" placeholder="max DTE" value={f.maxDte} onChange={(e) => set("maxDte", e.target.value.replace(/[^\d]/g, ""))} />
        {(
          [
            ["ask", "ask side"],
            ["sweep", "sweeps"],
            ["opening", "opening"],
            ["otm", "OTM"],
            ["volOi", "vol>OI"],
            ["sizeOi", "size>OI"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> {label}
          </label>
        ))}
        <select value={f.limit} onChange={(e) => set("limit", e.target.value)}>
          {["50", "100", "200"].map((n) => (
            <option key={n} value={n}>{n} rows</option>
          ))}
        </select>
        <span className="ml-auto flex gap-2 items-center">
          <Freshness fetching={q.isFetching} updatedAt={q.dataUpdatedAt} />
          <RefreshButton path="/api/option-trades/flow-alerts" params={params} />
          <ExplorerLink path="/api/option-trades/flow-alerts" params={params} />
        </span>
      </div>
      <div className="col-span-12 xl:col-span-3 flex flex-col gap-1">
        <div className="grid grid-cols-2 gap-1">
          <Stat label="Alerts" value={s.count} />
          <Stat label="Call / put prem" value={s.calls + s.puts ? `${((s.calls / (s.calls + s.puts)) * 100).toFixed(0)}%` : "—"} sub="call share" cls={s.calls >= s.puts ? "up" : "down"} />
          <Stat label="Call premium" value={`$${fmtBigNum(s.calls)}`} cls="up" />
          <Stat label="Put premium" value={`$${fmtBigNum(s.puts)}`} cls="down" />
        </div>
        <Panel title="Net premium by ticker (calls − puts)" className="h-[420px]">
          <SignedBars data={s.top} onPick={setActiveSymbol} />
        </Panel>
      </div>
      <Panel className="col-span-12 xl:col-span-9 h-[560px]" title="Flow alerts">
        <ErrorNote error={q.error} />
        {q.data !== undefined && (
          <DataTable
            rows={rows}
            columns={FLOW_COLS}
            name="flow-alerts"
            rowClass={(r) => (num(r.total_premium) ?? 0) >= 1_000_000 ? "bg-[#1f1a10]" : ""}
            onRowClick={(r) => r.ticker && setActiveSymbol(String(r.ticker))}
          />
        )}
      </Panel>
    </div>
  );
}

function Hottest() {
  const [preset, setPreset] = useState(CONTRACT_PRESETS[0].id);
  const [tickers, setTickers] = useState("");
  const params = clean({ ...CONTRACT_PRESETS.find((p) => p.id === preset)!.params, ticker_symbol: tickers.replace(/\s+/g, "").toUpperCase(), limit: 250 });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1 items-center">
        {CONTRACT_PRESETS.map((p) => (
          <button key={p.id} title={p.hint} className={`term-btn ${preset === p.id ? "active" : ""}`} onClick={() => setPreset(p.id)}>
            {p.label}
          </button>
        ))}
        <input className="w-44 ml-2" placeholder="limit to tickers…" value={tickers} onChange={(e) => setTickers(e.target.value)} />
      </div>
      <EndpointTable
        className="h-[640px]"
        title="Hottest option contracts"
        path="/api/screener/option-contracts"
        params={params}
        live
        columns={["option_symbol", "option_type", "strike", "expiry", "volume", "open_interest", "premium", "avg_price", "close", "stock_price", "ask_side_volume", "bid_side_volume", "sweep_volume", "floor_volume", "sector", "next_earnings_date"]}
      />
    </div>
  );
}

export default function Flow() {
  const [tab, setTab] = useState<Tab>("alerts");
  return (
    <div className="p-1 flex flex-col gap-1">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "alerts", label: "Flow alerts" },
          { value: "unusual", label: "Unusual options activity" },
          { value: "hottest", label: "Hottest chains" },
          { value: "multileg", label: "Multi-leg trades" },
          { value: "oi", label: "OI change leaders" },
        ]}
      />
      {tab === "alerts" && <FlowAlerts />}
      {tab === "unusual" && <EndpointTable className="h-[680px]" title="Unusual options activity" path="/api/option-activity/unusual" params={{ limit: 200 }} live />}
      {tab === "hottest" && <Hottest />}
      {tab === "multileg" && <EndpointTable className="h-[680px]" title="Multi-leg option trades" path="/api/option-trades/multi-leg" params={{ limit: 200 }} live />}
      {tab === "oi" && (
        <EndpointTable
          className="h-[680px]"
          title="Biggest open-interest changes (market)"
          path="/api/market/oi-change"
          params={{ limit: 200 }}
          columns={["underlying_symbol", "option_symbol", "oi_change", "oi_diff_plain", "curr_oi", "last_oi", "volume", "prev_total_premium", "avg_price", "percentage_of_total", "trades"]}
        />
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useUwCatalog, uwJson, type Params } from "../../../lib/uw/api";
import { type Row } from "../../../lib/uw/format";
import { SCAN_TARGETS, SCREENER_PRESETS } from "../../../lib/uw/presets";
import { useTerminal } from "../../../store/terminal";
import { useWhales } from "../../../store/whales";
import DataTable from "../DataTable";
import ParamForm from "../ParamForm";
import { EndpointTable, ErrorNote, Panel, Segmented } from "../ui";

type Tab = "stocks" | "multi" | "shorts" | "analysts" | "pulse" | "saved";

const SCREENER_COLS = [
  "ticker", "close", "intraday_change", "marketcap", "sector", "iv_rank", "iv30d", "implied_move_perc",
  "call_volume", "put_volume", "put_call_ratio", "net_call_premium", "net_put_premium", "bullish_premium", "bearish_premium",
  "relative_volume", "gex_ratio", "next_earnings_date", "one_month_perc", "ytd_perc", "dividend_yield",
];

function StockScreener() {
  const { data: catalog } = useUwCatalog();
  const ep = catalog?.endpoints.find((e) => e.path === "/api/screener/stocks" && e.method === "GET");
  const saveScan = useWhales((s) => s.saveScan);
  const [preset, setPreset] = useState<string | null>("active-opts");
  const [custom, setCustom] = useState<Params>({});
  const [showAll, setShowAll] = useState(false);
  const [applied, setApplied] = useState<Params>({ limit: 200, ...SCREENER_PRESETS[0].params });

  const choosePreset = (id: string) => {
    const p = SCREENER_PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setCustom({ ...p.params });
    setApplied({ limit: 200, ...p.params });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {SCREENER_PRESETS.map((p) => (
          <button key={p.id} title={p.hint} className={`term-btn ${preset === p.id ? "active" : ""}`} onClick={() => choosePreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <Panel
        title="Screener filters"
        right={
          <>
            <button className="term-btn" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "hide" : "show"} all {ep?.params.length ?? ""} filters
            </button>
            <button
              className="term-btn"
              onClick={() => {
                const name = prompt("Name this scan", SCREENER_PRESETS.find((p) => p.id === preset)?.label ?? "My scan");
                if (name) saveScan({ name, path: "/api/screener/stocks", params: { limit: 200, ...custom } });
              }}
            >
              ☆ save scan
            </button>
            <button
              className="term-btn active"
              onClick={() => {
                setPreset(null);
                setApplied({ limit: 200, ...custom });
              }}
            >
              ▶ run
            </button>
          </>
        }
        bodyClass="p-1"
      >
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-0.5">
            <span className="dim text-[10px]">
              Query language (UW DSL) — e.g. <span className="amber">where iv_rank &gt; 60 and put_call_ratio &lt; 0.5</span>
            </span>
            <textarea
              className="bg-[var(--panel-2)] border border-[var(--border)] p-1 text-[11px] font-mono h-12 outline-none focus:border-[var(--amber)]"
              value={String(custom.query ?? "")}
              onChange={(e) => setCustom((c) => ({ ...c, query: e.target.value || undefined }))}
            />
          </label>
          {ep && (
            <ParamForm
              endpoint={showAll ? ep : { ...ep, params: ep.params.filter((p) => QUICK.includes(p.name)) }}
              values={custom}
              onChange={setCustom}
              columns={6}
            />
          )}
        </div>
      </Panel>
      <EndpointTable className="h-[600px]" title="Stock screener results" path="/api/screener/stocks" params={applied} live columns={SCREENER_COLS} />
    </div>
  );
}

const QUICK = [
  "ticker", "sectors[]", "issue_types[]", "min_marketcap", "max_marketcap", "min_underlying_price", "max_underlying_price",
  "min_change", "max_change", "min_iv_rank", "max_iv_rank", "min_volume", "min_premium", "min_net_call_premium",
  "min_net_put_premium", "min_put_call_ratio", "max_put_call_ratio", "min_oi", "is_s_p_500", "has_dividends",
  "min_implied_move_perc", "order", "order_direction", "date",
];

function MultiScan() {
  const scanTickers = useWhales((s) => s.scanTickers);
  const setScanTickers = useWhales((s) => s.setScanTickers);
  const watchlist = useTerminal((s) => s.watchlist);
  const [text, setText] = useState(scanTickers.join(", "));
  const [target, setTarget] = useState(SCAN_TARGETS[0].path);
  const t = SCAN_TARGETS.find((x) => x.path === target)!;
  const scan = useMutation({
    mutationFn: (tickers: string[]) =>
      uwJson<{ rows: Row[]; errors: Array<{ ticker: string; error: string }> }>("/api/uw/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target, tickers, params: t.params ?? {} }),
      }),
  });
  const run = () => {
    const list = text.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    setScanTickers(list);
    scan.mutate(list);
  };
  return (
    <div className="flex flex-col gap-1">
      <Panel title="Watchlist multi-scan — run one endpoint across many tickers" bodyClass="p-1">
        <div className="flex gap-2 items-start flex-wrap">
          <textarea
            className="bg-[var(--panel-2)] border border-[var(--border)] p-1 text-[11px] w-96 h-16 outline-none focus:border-[var(--amber)]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="SPY, QQQ, NVDA…"
          />
          <div className="flex flex-col gap-1">
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {SCAN_TARGETS.map((x) => (
                <option key={x.path} value={x.path}>{x.label}</option>
              ))}
            </select>
            <div className="flex gap-1">
              <button className="term-btn" onClick={() => setText(watchlist.join(", "))}>use terminal watchlist</button>
              <button className="term-btn active" onClick={run} disabled={scan.isPending}>
                {scan.isPending ? "scanning…" : "▶ scan"}
              </button>
            </div>
          </div>
          <div className="dim text-[10px] max-w-md">
            One request per ticker (≤ 60), queued under your rate limit. Click any ticker in the results to load it into the Cockpit.
          </div>
        </div>
      </Panel>
      <ErrorNote error={scan.error} />
      {scan.data?.errors.length ? (
        <div className="text-[10px] down px-1">
          {scan.data.errors.map((e) => `${e.ticker}: ${e.error}`).join(" · ")}
        </div>
      ) : null}
      {scan.data && (
        <Panel className="h-[560px]" title={`${t.label} — ${scan.data.rows.length} tickers`}>
          <DataTable rows={scan.data.rows} columns={t.cols.length ? t.cols : undefined} name={`scan-${t.label}`} />
        </Panel>
      )}
    </div>
  );
}

function Saved() {
  const saved = useWhales((s) => s.savedScans);
  const del = useWhales((s) => s.deleteScan);
  const [run, setRun] = useState<string | null>(null);
  const active = useMemo(() => saved.find((s) => s.id === run), [saved, run]);
  if (!saved.length) return <div className="p-3 dim">No saved scans yet — build one in the Stock screener and press “☆ save scan”.</div>;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {saved.map((s) => (
          <span key={s.id} className="inline-flex">
            <button className={`term-btn ${run === s.id ? "active" : ""}`} onClick={() => setRun(s.id)} title={JSON.stringify(s.params)}>
              ▶ {s.name}
            </button>
            <button className="term-btn dim hover:!text-[var(--down)]" onClick={() => del(s.id)}>✕</button>
          </span>
        ))}
      </div>
      {active && <EndpointTable className="h-[620px]" title={active.name} path={active.path} params={active.params} live columns={active.path === "/api/screener/stocks" ? SCREENER_COLS : undefined} />}
    </div>
  );
}

export default function Scanners() {
  const [tab, setTab] = useState<Tab>("stocks");
  return (
    <div className="p-1 flex flex-col gap-1">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "stocks", label: "Stock screener" },
          { value: "multi", label: "Watchlist multi-scan" },
          { value: "shorts", label: "Short squeeze screener" },
          { value: "analysts", label: "Analyst ratings" },
          { value: "pulse", label: "Options pulse" },
          { value: "saved", label: "Saved scans" },
        ]}
      />
      {tab === "stocks" && <StockScreener />}
      {tab === "multi" && <MultiScan />}
      {tab === "shorts" && (
        <EndpointTable
          className="h-[680px]"
          title="Short screener"
          path="/api/short_screener"
          sort={{ key: "si_float", dir: "desc" }}
          columns={["symbol", "si_float", "days_to_cover", "short_interest", "fee_rate", "short_shares_available", "total_float", "rebate_rate", "market_date"]}
        />
      )}
      {tab === "analysts" && (
        <EndpointTable
          className="h-[680px]"
          title="Analyst rating changes"
          path="/api/screener/analysts"
          params={{ limit: 500 }}
          columns={["timestamp", "ticker", "action", "recommendation", "target", "firm", "analyst_name", "sector"]}
        />
      )}
      {tab === "pulse" && (
        <div className="grid grid-cols-12 gap-1">
          <EndpointTable className="col-span-12 xl:col-span-8 h-[640px]" title="Options pulse — top tickers" path="/api/options-pulse/top" live />
          <div className="col-span-12 xl:col-span-4 flex flex-col gap-1">
            <EndpointTable className="h-[316px]" title="Options pulse — market total" path="/api/options-pulse/total" live />
            <EndpointTable className="h-[320px]" title="Options pulse — by sector" path="/api/options-pulse/sectors" live />
          </div>
        </div>
      )}
      {tab === "saved" && <Saved />}
    </div>
  );
}

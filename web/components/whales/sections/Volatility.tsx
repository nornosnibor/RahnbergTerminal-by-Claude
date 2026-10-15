"use client";

import { useMemo, useState } from "react";
import { useUw } from "../../../lib/uw/api";
import { num, toRows } from "../../../lib/uw/format";
import { useTerminal } from "../../../store/terminal";
import { COLORS, SimpleLine } from "../charts";
import { EndpointTable, ErrorNote, ExplorerLink, Panel, Segmented, Stat } from "../ui";

const pct = (v: number | null) => (v === null ? "—" : `${(Math.abs(v) <= 3 ? v * 100 : v).toFixed(1)}%`);

function RiskReversal({ ticker }: { ticker: string }) {
  const expiries = useUw("/api/stock/{ticker}/max-pain", { ticker });
  const list = useMemo(() => toRows(expiries.data).map((r) => String(r.expiry)).filter(Boolean), [expiries.data]);
  const [picked, setPicked] = useState("");
  const [delta, setDelta] = useState("0.25");
  const expiry = list.includes(picked) ? picked : list[Math.min(2, list.length - 1)] ?? "";
  const q = useUw("/api/stock/{ticker}/historical-risk-reversal-skew", { ticker, expiry, delta }, { enabled: Boolean(expiry) });
  const data = useMemo(() => toRows(q.data).map((r) => ({ date: String(r.date ?? ""), rr: num(r.risk_reversal) ?? 0 })), [q.data]);
  return (
    <Panel
      className="col-span-12 xl:col-span-6 h-[280px]"
      title={`Risk-reversal skew (${delta}Δ) · ${ticker}`}
      right={
        <>
          <select value={delta} onChange={(e) => setDelta(e.target.value)} className="!py-0">
            {["0.10", "0.25", "0.40"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select value={expiry} onChange={(e) => setPicked(e.target.value)} className="!py-0">
            {list.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <ExplorerLink path="/api/stock/{ticker}/historical-risk-reversal-skew" params={{ ticker, expiry, delta }} />
        </>
      }
    >
      <ErrorNote error={q.error} />
      <SimpleLine data={data} x="date" lines={[{ key: "rr", name: "25Δ call IV − put IV", color: COLORS.AMBER }]} />
    </Panel>
  );
}

export default function Volatility() {
  const ticker = useTerminal((s) => s.activeSymbol).replace(/^\^/, "");
  const [dir, setDir] = useState<"short_vol" | "long_vol">("short_vol");
  const [sent, setSent] = useState<"bullish" | "bearish" | "neutral">("bullish");
  const stats = toRows(useUw("/api/stock/{ticker}/volatility/stats", { ticker }).data)[0];
  const iv = num(stats?.iv);
  const rv = num(stats?.rv);

  const term = useUw("/api/stock/{ticker}/volatility/term-structure", { ticker });
  const termData = useMemo(
    () => toRows(term.data).map((r) => ({ dte: String(r.dte ?? r.expiry), iv: (num(r.volatility) ?? 0) * 100, move: (num(r.implied_move_perc) ?? 0) * 100 })),
    [term.data]
  );
  const realized = useUw("/api/stock/{ticker}/volatility/realized", { ticker });
  const rvData = useMemo(
    () => toRows(realized.data).map((r) => ({ date: String(r.date ?? ""), iv: (num(r.implied_volatility) ?? 0) * 100, rv: (num(r.realized_volatility) ?? 0) * 100 })),
    [realized.data]
  );
  const ivr = useUw("/api/stock/{ticker}/iv-rank", { ticker });
  const ivrData = useMemo(() => toRows(ivr.data).map((r) => ({ date: String(r.date ?? ""), rank: num(r.iv_rank_1y) ?? 0 })), [ivr.data]);

  return (
    <div className="grid gap-1 p-1 grid-cols-12 auto-rows-min">
      <div className="col-span-12 flex flex-wrap gap-1">
        <Stat label={`${ticker} implied vol`} value={pct(iv)} sub={`range ${pct(num(stats?.iv_low))} – ${pct(num(stats?.iv_high))}`} />
        <Stat label="Realized vol" value={pct(rv)} sub={`range ${pct(num(stats?.rv_low))} – ${pct(num(stats?.rv_high))}`} />
        <Stat label="IV − RV" value={iv !== null && rv !== null ? pct(iv - rv) : "—"} sub={iv !== null && rv !== null ? (iv > rv ? "options rich → favor selling" : "options cheap → favor buying") : undefined} cls={iv !== null && rv !== null ? (iv > rv ? "down" : "up") : ""} />
        <Stat label="IV rank" value={num(stats?.iv_rank) !== null ? pct(num(stats?.iv_rank)) : "—"} />
      </div>

      <Panel className="col-span-12 xl:col-span-6 h-[280px]" title={`IV term structure · ${ticker}`} right={<ExplorerLink path="/api/stock/{ticker}/volatility/term-structure" params={{ ticker }} />}>
        <ErrorNote error={term.error} />
        <SimpleLine data={termData} x="dte" lines={[{ key: "iv", name: "IV %", color: COLORS.AMBER }, { key: "move", name: "Implied move %", color: "#40c4ff" }]} />
      </Panel>
      <Panel className="col-span-12 xl:col-span-6 h-[280px]" title={`Implied vs realized · ${ticker}`} right={<ExplorerLink path="/api/stock/{ticker}/volatility/realized" params={{ ticker }} />}>
        <ErrorNote error={realized.error} />
        <SimpleLine data={rvData} x="date" lines={[{ key: "iv", name: "Implied %", color: COLORS.AMBER }, { key: "rv", name: "Realized %", color: "#40c4ff" }]} />
      </Panel>
      <Panel className="col-span-12 xl:col-span-6 h-[280px]" title={`IV rank history · ${ticker}`} right={<ExplorerLink path="/api/stock/{ticker}/iv-rank" params={{ ticker }} />}>
        <ErrorNote error={ivr.error} />
        <SimpleLine data={ivrData} x="date" lines={[{ key: "rank", name: "IV rank 1y", color: COLORS.AMBER }]} />
      </Panel>
      <RiskReversal ticker={ticker} />

      <EndpointTable className="col-span-12 xl:col-span-4 h-[260px]" title={`Interpolated IV · ${ticker}`} path="/api/stock/{ticker}/interpolated-iv" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[260px]" title={`Variance risk premium · ${ticker}`} path="/api/stock/{ticker}/volatility/variance-risk-premium" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[260px]" title={`Volatility context · ${ticker}`} path="/api/stock/{ticker}/volatility/context" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[240px]" title={`Anomaly score · ${ticker}`} path="/api/stock/{ticker}/volatility/anomaly" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[240px]" title={`Volatility character · ${ticker}`} path="/api/stock/{ticker}/volatility/character" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[240px]" title={`Positioning sentiment · ${ticker}`} path="/api/stock/{ticker}/volatility/option-sentiment" params={{ ticker }} />

      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[380px]"
        title="Top volatility anomalies (market)"
        path="/api/volatility/anomaly/top"
        params={{ direction: dir, limit: 100 }}
        extra={<Segmented value={dir} onChange={setDir} options={[{ value: "short_vol", label: "short vol" }, { value: "long_vol", label: "long vol" }]} />}
      />
      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[380px]"
        title="Top options-positioning sentiment (market)"
        path="/api/volatility/option-sentiment/top"
        params={{ direction: sent, limit: 100 }}
        extra={<Segmented value={sent} onChange={setSent} options={[{ value: "bullish", label: "bull" }, { value: "bearish", label: "bear" }, { value: "neutral", label: "neutral" }]} />}
      />
      <EndpointTable className="col-span-12 xl:col-span-6 h-[320px]" title="Top volatility character (mean-reversion half-life)" path="/api/volatility/character/top" params={{ limit: 100 }} />
      <EndpointTable className="col-span-12 xl:col-span-6 h-[320px]" title="VIX term structure" path="/api/volatility/vix-term-structure" live />
    </div>
  );
}

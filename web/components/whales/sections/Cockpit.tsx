"use client";

import { useMemo, useState } from "react";
import { useUw } from "../../../lib/uw/api";
import { fmtBigNum, latestRow, num, toRows, type Row } from "../../../lib/uw/format";
import { computeLevels, cumulativeFlow, pctFrom, strikeExposure, windowAround, type GexMode, type Greek } from "../../../lib/uw/gex";
import { useTerminal } from "../../../store/terminal";
import { COLORS, FlowLines, GexLadder } from "../charts";
import { EndpointTable, ErrorNote, ExplorerLink, Freshness, Panel, Segmented, Stat } from "../ui";

const first = (d: unknown): Row | undefined => toRows(d)[0];
const last = (d: unknown): Row | undefined => latestRow(toRows(d)); // by timestamp — some series are newest-first
const pctTxt = (p: number | null) => (p === null ? "" : `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`);

export function useSpot(ticker: string) {
  const state = useUw("/api/stock/{ticker}/stock-state", { ticker }, { live: true });
  const s = first(state.data);
  const spot = num(s?.close);
  const prev = num(s?.prev_close);
  return { state, spot, prev, row: s };
}

export function GexLadderPanel({ ticker, spot, title = "Gamma exposure by strike", className = "" }: { ticker: string; spot: number | null; title?: string; className?: string }) {
  const [mode, setMode] = useState<GexMode>("oi");
  const [greek, setGreek] = useState<Greek>("gamma");
  const [range, setRange] = useState("0.05");
  const [show, setShow] = useState<"net" | "split">("net");
  const q = useUw("/api/stock/{ticker}/spot-exposures/strike", { ticker, limit: 500 }, { live: true });
  const levelsQ = useUw("/api/stock/{ticker}/gex-levels", { ticker }, { live: true });
  const rows = useMemo(() => toRows(q.data), [q.data]);
  const ladderSpot = spot ?? num(rows[0]?.price);
  const bars = useMemo(() => strikeExposure(rows, greek, mode), [rows, greek, mode]);
  const computed = useMemo(() => computeLevels(bars, ladderSpot), [bars, ladderSpot]);
  const uwLevels = first(levelsQ.data);
  // Prefer UW's published levels for gamma; derive them locally for other greeks/modes.
  const levels =
    greek === "gamma" && uwLevels
      ? { callWall: num(uwLevels.call_wall), putWall: num(uwLevels.put_wall), flip: num(uwLevels.gamma_flip), magnet: num(uwLevels.gamma_magnet) }
      : computed;
  const view = windowAround(bars, ladderSpot, Number(range));

  return (
    <Panel
      className={className}
      title={`${title} · ${ticker}`}
      right={
        <>
          <Segmented value={greek} onChange={setGreek} options={[{ value: "gamma", label: "Γ" }, { value: "delta", label: "Δ" }, { value: "vanna", label: "vanna" }, { value: "charm", label: "charm" }]} />
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "oi", label: "OI", title: "Open-interest based (positioning coming into today)" },
              { value: "vol", label: "Vol", title: "Today's volume" },
              { value: "dir", label: "Dir", title: "Directionalized: ask-side minus bid-side (what dealers took on today)" },
            ]}
          />
          <Segmented value={show} onChange={setShow} options={[{ value: "net", label: "net" }, { value: "split", label: "c/p" }]} />
          <select value={range} onChange={(e) => setRange(e.target.value)} className="!py-0">
            <option value="0.02">±2%</option>
            <option value="0.05">±5%</option>
            <option value="0.1">±10%</option>
            <option value="0.25">±25%</option>
            <option value="0">all</option>
          </select>
          <Freshness fetching={q.isFetching} updatedAt={q.dataUpdatedAt} />
          <ExplorerLink path="/api/stock/{ticker}/spot-exposures/strike" params={{ ticker }} />
        </>
      }
      bodyClass="flex flex-col"
    >
      <ErrorNote error={q.error} />
      <div className="flex gap-3 px-2 py-1 text-[10px] shrink-0 flex-wrap">
        <span>spot <b>{ladderSpot ?? "—"}</b></span>
        <span className="up">call wall {levels.callWall ?? "—"} <span className="dim">{pctTxt(pctFrom(levels.callWall, ladderSpot))}</span></span>
        <span className="down">put wall {levels.putWall ?? "—"} <span className="dim">{pctTxt(pctFrom(levels.putWall, ladderSpot))}</span></span>
        <span className="amber">flip {levels.flip ?? "—"} <span className="dim">{pctTxt(pctFrom(levels.flip, ladderSpot))}</span></span>
        <span className="text-[#b388ff]">magnet {levels.magnet ?? "—"}</span>
        <span className="dim ml-auto">
          net {greek} {fmtBigNum(bars.reduce((s, b) => s + b.net, 0))} · {ladderSpot && levels.flip ? (ladderSpot > levels.flip ? "above flip → dealers long γ (mean-revert)" : "below flip → dealers short γ (trend/expand)") : ""}
        </span>
      </div>
      <div className="flex-1 min-h-0">{q.isLoading ? <div className="p-2 dim">Loading…</div> : <GexLadder bars={view} spot={ladderSpot} levels={levels} show={show} />}</div>
    </Panel>
  );
}

export function NetPremiumPanel({ ticker, className = "" }: { ticker: string; className?: string }) {
  const q = useUw("/api/stock/{ticker}/net-prem-ticks", { ticker }, { live: true });
  const data = useMemo(() => cumulativeFlow(toRows(q.data)), [q.data]);
  const lastPt = data.at(-1);
  return (
    <Panel
      className={className}
      title={`Net premium flow (cumulative) · ${ticker}`}
      right={
        <>
          {lastPt && (
            <span>
              <span className="up">C {fmtBigNum(lastPt.calls)}</span> · <span className="down">P {fmtBigNum(lastPt.puts)}</span> ·{" "}
              <span className={lastPt.net >= 0 ? "up" : "down"}>net {fmtBigNum(lastPt.net)}</span>
            </span>
          )}
          <Freshness fetching={q.isFetching} updatedAt={q.dataUpdatedAt} />
          <ExplorerLink path="/api/stock/{ticker}/net-prem-ticks" params={{ ticker }} />
        </>
      }
    >
      <ErrorNote error={q.error} />
      <div className="h-full min-h-40">
        <FlowLines
          data={data}
          lines={[
            { key: "calls", name: "Net call prem", color: COLORS.UP },
            { key: "puts", name: "Net put prem", color: COLORS.DOWN },
            { key: "net", name: "Calls − puts", color: COLORS.AMBER },
          ]}
        />
      </div>
    </Panel>
  );
}

export default function Cockpit() {
  const ticker = useTerminal((s) => s.activeSymbol).replace(/^\^/, "");
  const { spot, prev, row: st } = useSpot(ticker);
  const info = first(useUw("/api/stock/{ticker}/info", { ticker }).data);
  const iv = last(useUw("/api/stock/{ticker}/iv-rank", { ticker }).data);
  const nope = last(useUw("/api/stock/{ticker}/nope", { ticker }, { live: true }).data);
  const maxPain = first(useUw("/api/stock/{ticker}/max-pain", { ticker }).data);
  const chg = spot !== null && prev ? ((spot - prev) / prev) * 100 : null;
  const ivRank = num(iv?.iv_rank_1y);
  const nopeV = num(nope?.nope);
  const mp = num(maxPain?.max_pain);

  return (
    <div className="grid gap-1 p-1 grid-cols-12 auto-rows-min">
      <div className="col-span-12 flex gap-1 flex-wrap">
        <Stat label={info?.full_name ? String(info.full_name) : ticker} value={spot ?? "—"} sub={chg === null ? undefined : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%  prev ${prev}`} cls={chg === null ? "" : chg >= 0 ? "up" : "down"} />
        <Stat label="Day range" value={st ? `${st.low ?? "—"} – ${st.high ?? "—"}` : "—"} sub={st ? `open ${st.open ?? "—"}` : undefined} />
        <Stat label="Volume" value={num(st?.total_volume) !== null ? fmtBigNum(num(st?.total_volume)!) : "—"} sub={num(info?.avg30_volume) ? `30d avg ${fmtBigNum(num(info?.avg30_volume)!)}` : undefined} />
        <Stat label="IV rank 1y" value={ivRank === null ? "—" : ivRank.toFixed(0)} sub={num(iv?.volatility) !== null ? `IV ${(num(iv?.volatility)! * 100).toFixed(1)}%` : undefined} cls={ivRank === null ? "" : ivRank > 70 ? "down" : ivRank < 20 ? "up" : "amber"} />
        <Stat label="NOPE" value={nopeV === null ? "—" : nopeV.toFixed(2)} sub="net options pricing effect" cls={nopeV === null ? "" : nopeV >= 0 ? "up" : "down"} />
        <Stat label="Max pain" value={mp ?? "—"} sub={maxPain?.expiry ? `${maxPain.expiry} ${pctTxt(pctFrom(mp, spot))}` : undefined} />
        <Stat label="Market cap" value={num(info?.marketcap) ? fmtBigNum(num(info?.marketcap)!) : "—"} sub={info?.sector ? String(info.sector) : undefined} />
        <Stat label="Next earnings" value={info?.next_earnings_date ? String(info.next_earnings_date) : "—"} sub={info?.announce_time ? String(info.announce_time) : undefined} />
      </div>

      <GexLadderPanel ticker={ticker} spot={spot} className="col-span-12 xl:col-span-5 h-[560px]" />
      <div className="col-span-12 xl:col-span-7 grid gap-1 grid-rows-2 h-[560px]">
        <NetPremiumPanel ticker={ticker} />
        <EndpointTable
          title={`Flow alerts · ${ticker}`}
          path="/api/stock/{ticker}/flow-alerts"
          params={{ ticker, limit: 100 }}
          live
          columns={["created_at", "type", "strike", "expiry", "total_premium", "total_size", "price", "underlying_price", "volume_oi_ratio", "has_sweep", "alert_rule"]}
        />
      </div>

      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[380px]"
        title={`Most active contracts · ${ticker}`}
        path="/api/stock/{ticker}/option-contracts"
        params={{ ticker, limit: 250 }}
        live
        sort={{ key: "volume", dir: "desc" }}
        columns={["option_symbol", "volume", "open_interest", "total_premium", "last_price", "nbbo_bid", "nbbo_ask", "implied_volatility", "delta", "ask_volume", "bid_volume", "sweep_volume"]}
      />
      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[380px]"
        title={`Dark pool prints · ${ticker}`}
        path="/api/darkpool/{ticker}"
        params={{ ticker, limit: 200 }}
        live
        columns={["executed_at", "price", "size", "premium", "nbbo_bid", "nbbo_ask", "market_center", "ext_hour_sold_codes"]}
      />
      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[320px]"
        title={`Flow by expiry · ${ticker}`}
        path="/api/stock/{ticker}/flow-per-expiry"
        params={{ ticker }}
        live
      />
      <EndpointTable
        className="col-span-12 xl:col-span-6 h-[320px]"
        title={`Dark pool price levels · ${ticker}`}
        path="/api/darkpool/{ticker}/price-levels"
        params={{ ticker }}
        sort={{ key: "dark_pool_volume", dir: "desc" }}
      />
    </div>
  );
}

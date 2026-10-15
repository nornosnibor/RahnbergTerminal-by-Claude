"use client";

import { useMemo, useState } from "react";
import { useUw } from "../../../lib/uw/api";
import { num, sortByTime, toRows } from "../../../lib/uw/format";
import { computeLevels, strikeExposure, windowAround, type Greek } from "../../../lib/uw/gex";
import { useTerminal } from "../../../store/terminal";
import { COLORS, FlowLines, GexLadder, SimpleBars } from "../charts";
import { EndpointTable, ErrorNote, ExplorerLink, Freshness, Panel, Segmented } from "../ui";
import { GexLadderPanel, useSpot } from "./Cockpit";

const GREEKS: Array<{ value: Greek; label: string }> = [
  { value: "gamma", label: "Γ gamma" },
  { value: "delta", label: "Δ delta" },
  { value: "vanna", label: "vanna" },
  { value: "charm", label: "charm" },
];

function ByExpiryLadder({ ticker, spot }: { ticker: string; spot: number | null }) {
  const expiries = useUw("/api/stock/{ticker}/greek-exposure/expiry", { ticker });
  const list = useMemo(() => toRows(expiries.data).map((r) => String(r.expiry)).filter(Boolean), [expiries.data]);
  const [picked, setPicked] = useState("");
  const expiry = picked && list.includes(picked) ? picked : list[0] ?? "";
  const [greek, setGreek] = useState<Greek>("gamma");
  const q = useUw("/api/stock/{ticker}/greek-exposure/strike-expiry", { ticker, expiry }, { live: true, enabled: Boolean(expiry) });
  const bars = useMemo(() => strikeExposure(toRows(q.data), greek, "oi"), [q.data, greek]);
  const levels = computeLevels(bars, spot);
  return (
    <Panel
      className="col-span-12 xl:col-span-6 h-[620px]"
      title={`Exposure by strike for one expiry · ${ticker}`}
      right={
        <>
          <Segmented value={greek} onChange={setGreek} options={GREEKS} />
          <select value={expiry} onChange={(e) => setPicked(e.target.value)} className="!py-0">
            {list.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
          <Freshness fetching={q.isFetching} updatedAt={q.dataUpdatedAt} />
          <ExplorerLink path="/api/stock/{ticker}/greek-exposure/strike-expiry" params={{ ticker, expiry }} />
        </>
      }
    >
      <ErrorNote error={q.error ?? expiries.error} />
      <GexLadder bars={windowAround(bars, spot, 0.1)} spot={spot} levels={levels} />
    </Panel>
  );
}

export default function Gex() {
  const ticker = useTerminal((s) => s.activeSymbol).replace(/^\^/, "");
  const { spot } = useSpot(ticker);
  const [greek, setGreek] = useState<Greek>("gamma");
  const [spotMode, setSpotMode] = useState<"oi" | "vol" | "dir">("oi");
  // One greek at a time: charm runs orders of magnitude larger than gamma and would flatten it.
  const [spotGreek, setSpotGreek] = useState<"gamma" | "vanna" | "charm">("gamma");

  const byExpiry = useUw("/api/stock/{ticker}/greek-exposure/expiry", { ticker });
  const expiryData = useMemo(
    () =>
      toRows(byExpiry.data).map((r) => {
        const key = greek === "gamma" ? "gex" : greek;
        const call = num(r[`call_${key}`]) ?? 0;
        const put = num(r[`put_${key}`]) ?? 0;
        return { expiry: String(r.expiry ?? "").slice(5), call, put, net: call + put };
      }),
    [byExpiry.data, greek]
  );

  const spotEx = useUw("/api/stock/{ticker}/spot-exposures", { ticker }, { live: true });
  const spotSeries = useMemo(
    () =>
      sortByTime(toRows(spotEx.data)).map((r) => ({
        t: String(r.time ?? ""),
        value: num(r[`${spotGreek}_per_one_percent_move_${spotMode}`]) ?? 0,
      })),
    [spotEx.data, spotMode, spotGreek]
  );

  const hist = useUw("/api/stock/{ticker}/greek-exposure", { ticker });
  const histSeries = useMemo(
    () =>
      sortByTime(toRows(hist.data)).map((r) => ({
        date: String(r.date ?? ""),
        net: (num(r[`call_${greek}`]) ?? 0) + (num(r[`put_${greek}`]) ?? 0),
      })),
    [hist.data, greek]
  );

  const greekFlow = useUw("/api/stock/{ticker}/greek-flow", { ticker }, { live: true });
  const flowSeries = useMemo(
    () =>
      sortByTime(toRows(greekFlow.data)).map((r) => ({
        t: String(r.timestamp ?? ""),
        dir_delta: num(r.dir_delta_flow) ?? 0,
        otm_dir_delta: num(r.otm_dir_delta_flow) ?? 0,
        dir_vega: num(r.dir_vega_flow) ?? 0,
      })),
    [greekFlow.data]
  );

  return (
    <div className="grid gap-1 p-1 grid-cols-12 auto-rows-min">
      <GexLadderPanel ticker={ticker} spot={spot} title="Spot GEX by strike (all expiries)" className="col-span-12 xl:col-span-6 h-[620px]" />
      <ByExpiryLadder ticker={ticker} spot={spot} />

      <Panel
        className="col-span-12 xl:col-span-6 h-[300px]"
        title={`Exposure by expiry · ${ticker}`}
        right={
          <>
            <Segmented value={greek} onChange={setGreek} options={GREEKS} />
            <ExplorerLink path="/api/stock/{ticker}/greek-exposure/expiry" params={{ ticker }} />
          </>
        }
      >
        <ErrorNote error={byExpiry.error} />
        <SimpleBars data={expiryData} x="expiry" bars={[{ key: "call", name: "Calls", color: COLORS.UP }, { key: "put", name: "Puts", color: COLORS.DOWN }]} />
      </Panel>

      <Panel
        className="col-span-12 xl:col-span-6 h-[300px]"
        title={`Exposure per 1% move, intraday · ${ticker}`}
        right={
          <>
            <Segmented value={spotGreek} onChange={setSpotGreek} options={[{ value: "gamma", label: "Γ" }, { value: "vanna", label: "vanna" }, { value: "charm", label: "charm" }]} />
            <Segmented value={spotMode} onChange={setSpotMode} options={[{ value: "oi", label: "OI" }, { value: "vol", label: "Vol" }, { value: "dir", label: "Dir" }]} />
            <Freshness fetching={spotEx.isFetching} updatedAt={spotEx.dataUpdatedAt} />
            <ExplorerLink path="/api/stock/{ticker}/spot-exposures" params={{ ticker }} />
          </>
        }
      >
        <ErrorNote error={spotEx.error} />
        <FlowLines
          data={spotSeries}
          lines={[{ key: "value", name: `${spotGreek} $ per 1% move`, color: spotGreek === "gamma" ? COLORS.AMBER : spotGreek === "vanna" ? "#40c4ff" : "#b388ff" }]}
        />
      </Panel>

      <Panel
        className="col-span-12 xl:col-span-6 h-[280px]"
        title={`Net ${greek} exposure history · ${ticker}`}
        right={<ExplorerLink path="/api/stock/{ticker}/greek-exposure" params={{ ticker }} />}
      >
        <ErrorNote error={hist.error} />
        <SimpleBars data={histSeries} x="date" bars={[{ key: "net", name: `Net ${greek}`, color: COLORS.AMBER }]} signed />
      </Panel>

      <Panel
        className="col-span-12 xl:col-span-6 h-[280px]"
        title={`Greek flow (directional delta / vega) · ${ticker}`}
        right={
          <>
            <Freshness fetching={greekFlow.isFetching} updatedAt={greekFlow.dataUpdatedAt} />
            <ExplorerLink path="/api/stock/{ticker}/greek-flow" params={{ ticker }} />
          </>
        }
      >
        <ErrorNote error={greekFlow.error} />
        <FlowLines
          data={flowSeries}
          lines={[
            { key: "dir_delta", name: "Dir Δ flow", color: COLORS.UP },
            { key: "otm_dir_delta", name: "OTM dir Δ", color: "#40c4ff" },
            { key: "dir_vega", name: "Dir vega flow", color: COLORS.AMBER },
          ]}
        />
      </Panel>

      <OiPerStrike ticker={ticker} spot={spot} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[320px]" title={`Max pain by expiry · ${ticker}`} path="/api/stock/{ticker}/max-pain" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[320px]" title={`Expiry breakdown · ${ticker}`} path="/api/stock/{ticker}/expiry-breakdown" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-4 h-[320px]" title={`Volume & OI per expiry · ${ticker}`} path="/api/stock/{ticker}/option/volume-oi-expiry" params={{ ticker }} />
    </div>
  );
}

function OiPerStrike({ ticker, spot }: { ticker: string; spot: number | null }) {
  const q = useUw("/api/stock/{ticker}/oi-per-strike", { ticker });
  const data = useMemo(() => {
    const rows = toRows(q.data)
      .map((r) => ({ strike: num(r.strike) ?? 0, call_oi: num(r.call_oi) ?? 0, put_oi: num(r.put_oi) ?? 0 }))
      .filter((r) => !spot || Math.abs(r.strike - spot) / spot < 0.15);
    return rows.sort((a, b) => a.strike - b.strike);
  }, [q.data, spot]);
  return (
    <Panel className="col-span-12 h-[260px]" title={`Open interest per strike (±15%) · ${ticker}`} right={<ExplorerLink path="/api/stock/{ticker}/oi-per-strike" params={{ ticker }} />}>
      <ErrorNote error={q.error} />
      <SimpleBars data={data} x="strike" bars={[{ key: "call_oi", name: "Call OI", color: COLORS.UP }, { key: "put_oi", name: "Put OI", color: COLORS.DOWN }]} />
    </Panel>
  );
}


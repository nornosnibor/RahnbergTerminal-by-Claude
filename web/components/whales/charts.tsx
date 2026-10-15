"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtBigNum, fmtClock, fmtTime } from "../../lib/uw/format";
import type { Levels, StrikeBar } from "../../lib/uw/gex";

const UP = "#00c853";
const DOWN = "#ff3d3d";
const AMBER = "#ff9900";
const AXIS = "#808080";
const tooltipStyle = { background: "#111", border: "1px solid #262626", fontSize: 10 };
const big = (v: unknown) => (typeof v === "number" ? fmtBigNum(v) : String(v));

/**
 * Horizontal strike ladder (strikes on the Y axis, high strikes on top) — the layout
 * scalpers read GEX in. Spot and key levels are drawn as reference lines.
 */
export function GexLadder({
  bars,
  spot,
  levels,
  show = "net",
}: {
  bars: StrikeBar[];
  spot: number | null;
  levels?: Partial<Levels>;
  show?: "net" | "split";
}) {
  const data = [...bars].reverse();
  const refs: Array<[number | null | undefined, string, string]> = [
    [spot, "spot", "#ffffff"],
    [levels?.callWall, "call wall", UP],
    [levels?.putWall, "put wall", DOWN],
    [levels?.flip, "flip", AMBER],
    [levels?.magnet, "magnet", "#b388ff"],
  ];
  // Reference lines snap to the nearest strike row because the Y axis is categorical.
  const nearest = (v: number) => data.reduce((m, b) => (Math.abs(b.strike - v) < Math.abs(m.strike - v) ? b : m), data[0])?.strike;
  if (!data.length) return <div className="p-3 dim">No strike data.</div>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 4 }} barCategoryGap={1} stackOffset="sign">
        <CartesianGrid stroke="#1a1a1a" horizontal={false} />
        <XAxis type="number" stroke={AXIS} fontSize={9} tickFormatter={big} />
        <YAxis type="category" dataKey="strike" stroke={AXIS} fontSize={9} width={46} interval="preserveStartEnd" />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: AXIS }} formatter={(v: number, n: string) => [big(v), n]} labelFormatter={(l) => `Strike ${l}`} />
        {show === "net" ? (
          <Bar dataKey="net" name="Net" isAnimationActive={false}>
            {data.map((b) => (
              <Cell key={b.strike} fill={b.net >= 0 ? UP : DOWN} />
            ))}
          </Bar>
        ) : (
          <>
            <Bar dataKey="call" name="Calls" stackId="s" fill={UP} isAnimationActive={false} />
            <Bar dataKey="put" name="Puts" stackId="s" fill={DOWN} isAnimationActive={false} />
          </>
        )}
        <ReferenceLine x={0} stroke="#444" />
        {mergeRefs(refs, nearest).map(({ y, label, color, solid }) => (
          <ReferenceLine
            key={label}
            y={y}
            stroke={color}
            strokeDasharray={solid ? undefined : "4 3"}
            label={{ value: label, position: "insideTopRight", fill: color, fontSize: 9 }}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Levels that snap to the same strike row share one line and one combined label. */
function mergeRefs(refs: Array<[number | null | undefined, string, string]>, snap: (v: number) => number | undefined) {
  const byRow = new Map<number, { y: number; label: string; color: string; solid: boolean }>();
  for (const [v, name, color] of refs) {
    if (!v) continue;
    const y = snap(v);
    if (y === undefined) continue;
    const text = `${name} ${v}`;
    const cur = byRow.get(y);
    if (cur) cur.label += ` · ${text}`;
    else byRow.set(y, { y, label: text, color, solid: name === "spot" });
  }
  return [...byRow.values()];
}

export function FlowLines({
  data,
  lines,
  height = "100%",
}: {
  data: Array<Record<string, number | string>>;
  lines: Array<{ key: string; name: string; color: string }>;
  height?: number | string;
}) {
  if (!data.length) return <div className="p-3 dim">No intraday data yet.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#1a1a1a" />
        <XAxis dataKey="t" stroke={AXIS} fontSize={9} tickFormatter={fmtClock} minTickGap={40} />
        <YAxis stroke={AXIS} fontSize={9} tickFormatter={big} width={48} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: AXIS }} labelFormatter={(t) => fmtTime(t)} formatter={(v: number, n: string) => [big(v), n]} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <ReferenceLine y={0} stroke="#444" />
        {lines.map((l) => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Signed horizontal bars, e.g. top net premium impact by ticker. */
export function SignedBars({ data, onPick }: { data: Array<{ label: string; value: number }>; onPick?: (label: string) => void }) {
  if (!data.length) return <div className="p-3 dim">No data.</div>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={2}>
        <XAxis type="number" stroke={AXIS} fontSize={9} tickFormatter={big} />
        <YAxis type="category" dataKey="label" stroke={AXIS} fontSize={9} width={44} interval={0} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => ["$" + big(v), "Net premium"]} />
        <ReferenceLine x={0} stroke="#444" />
        <Bar dataKey="value" isAnimationActive={false} onClick={(d: { label?: string }) => d.label && onPick?.(d.label)} cursor="pointer">
          {data.map((d) => (
            <Cell key={d.label} fill={d.value >= 0 ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Generic x/y bars (expiry breakdowns, term structure, monthly seasonality). */
export function SimpleBars({
  data,
  x,
  bars,
  signed,
}: {
  data: Array<Record<string, unknown>>;
  x: string;
  bars: Array<{ key: string; name: string; color: string }>;
  signed?: boolean;
}) {
  if (!data.length) return <div className="p-3 dim">No data.</div>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#1a1a1a" vertical={false} />
        <XAxis dataKey={x} stroke={AXIS} fontSize={9} minTickGap={8} />
        <YAxis stroke={AXIS} fontSize={9} tickFormatter={big} width={44} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: AXIS }} formatter={(v: number, n: string) => [big(v), n]} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
        <ReferenceLine y={0} stroke="#444" />
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} isAnimationActive={false}>
            {signed && data.map((d, i) => <Cell key={i} fill={Number(d[b.key]) >= 0 ? UP : DOWN} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleLine({ data, x, lines }: { data: Array<Record<string, unknown>>; x: string; lines: Array<{ key: string; name: string; color: string }> }) {
  if (!data.length) return <div className="p-3 dim">No data.</div>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#1a1a1a" />
        <XAxis dataKey={x} stroke={AXIS} fontSize={9} minTickGap={20} />
        <YAxis stroke={AXIS} fontSize={9} tickFormatter={big} width={44} domain={["auto", "auto"]} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: AXIS }} formatter={(v: number, n: string) => [big(v), n]} />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
        {lines.map((l) => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export const COLORS = { UP, DOWN, AMBER, AXIS };

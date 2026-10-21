"use client";

import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, LineChart, Line, YAxis, Tooltip, ReferenceLine } from "recharts";
import { apiGet } from "../../lib/api";
import {
  direction,
  fmtChange,
  fmtLevel,
  fmtTime,
  yDomain,
  type Kind,
  type OilRatesResponse,
  type OilRatesRow,
  type Trend,
  type WindowKey,
} from "../../lib/oilRates";
import Flash from "../Flash";

const WINDOWS: Array<{ key: WindowKey; label: string; baseLabel: string }> = [
  { key: "day", label: "Today", baseLabel: "prev close" },
  { key: "week", label: "1 Week", baseLabel: "week ago" },
  { key: "month", label: "1 Month", baseLabel: "month ago" },
];

const COLOR = { up: "var(--up)", down: "var(--down)", flat: "var(--text-dim)" };
const GRID = "grid grid-cols-[minmax(110px,1.1fr)_minmax(70px,0.7fr)_repeat(3,minmax(110px,2fr))] gap-x-3";

function Spark({ trend, kind, window }: { trend: Trend | null; kind: Kind; window: (typeof WINDOWS)[number] }) {
  if (!trend || trend.points.length < 2) return <div className="dim text-[10px] h-full flex items-center">no data</div>;
  const dir = direction(kind, trend.change);
  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend.points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <YAxis hide domain={yDomain(trend)} />
            <ReferenceLine y={trend.base} stroke="#4d4d4d" strokeDasharray="2 3" />
            <Tooltip
              cursor={{ stroke: "#555" }}
              contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: 10, padding: "2px 6px" }}
              labelStyle={{ color: "#808080" }}
              labelFormatter={(_, p) => (p?.[0] ? fmtTime(p[0].payload.t, window.key) : "")}
              formatter={(v: number) => [fmtLevel(kind, v), ""]}
              separator=""
            />
            <Line type="linear" dataKey="v" stroke={COLOR[dir]} strokeWidth={1.25} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`text-[10px] leading-tight ${dir === "flat" ? "dim" : dir}`} title={`vs ${window.baseLabel} ${fmtLevel(kind, trend.base)}`}>
        <Flash value={trend.change}>{fmtChange(kind, trend.change, trend.base)}</Flash>
      </div>
    </div>
  );
}

function Row({ row }: { row: OilRatesRow }) {
  return (
    <div className={`${GRID} px-2 py-1 border-b border-[var(--border)] h-[52px] items-stretch`}>
      <div className="flex flex-col justify-center min-w-0">
        <span className="truncate">{row.label}</span>
        <span className="dim text-[9px] truncate">
          {row.kind === "spread" ? "10Y − 2Y" : row.contract ?? (row.kind === "yield" ? "Treasury" : "front month")}
        </span>
      </div>
      <div className="flex flex-col justify-center">
        <Flash value={row.last} className="amber">{fmtLevel(row.kind, row.last)}</Flash>
        {row.time !== null && (
          <span className="dim text-[9px]">{new Date(row.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
        )}
      </div>
      {WINDOWS.map((w) => (
        <Spark key={w.key} trend={row[w.key]} kind={row.kind} window={w} />
      ))}
    </div>
  );
}

export default function OilRatesWidget() {
  const { data, error } = useQuery({
    queryKey: ["oil-rates"],
    queryFn: () => apiGet<OilRatesResponse>("/api/oil-rates"),
    refetchInterval: 15_000,
  });

  if (error && !data) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Loading oil & rates…</div>;

  const sources = [...new Set(data.rows.map((r) => r.source))].join(", ");

  return (
    <div className="flex flex-col h-full">
      <div className={`${GRID} px-2 py-1 dim text-[10px] uppercase border-b border-[var(--border)]`}>
        <span>Instrument</span>
        <span>Last</span>
        {WINDOWS.map((w) => (
          <span key={w.key}>{w.label}</span>
        ))}
      </div>
      {data.rows.map((r) => (
        <Row key={r.id} row={r} />
      ))}
      <div className="px-2 py-1 dim text-[9px]">
        Dashed line = {WINDOWS.map((w) => `${w.label.toLowerCase()}: ${w.baseLabel}`).join(" · ")}. Session starts 6pm ET.
        Source: {sources}; futures quotes may be delayed.
      </div>
    </div>
  );
}

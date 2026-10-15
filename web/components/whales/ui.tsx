"use client";

import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUw, uwGet, UwHttpError, type Params } from "../../lib/uw/api";
import { toRows, type Row } from "../../lib/uw/format";
import type { SortState } from "../../lib/uw/table";
import { useWhales } from "../../store/whales";
import DataTable from "./DataTable";

export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    // Not `.terminal-panel`: its unlayered `height: 100%` would override Tailwind height utilities.
    <section className={`bg-[var(--panel)] border border-[var(--border)] flex flex-col overflow-hidden min-h-0 ${className}`}>
      <div className="panel-title !cursor-default">
        <span className="truncate">{title}</span>
        <span className="flex gap-2 items-center normal-case tracking-normal font-normal text-[10px]">{right}</span>
      </div>
      <div className={`flex-1 min-h-0 overflow-auto ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const setSection = useWhales((s) => s.setSection);
  if (!error) return null;
  const status = error instanceof UwHttpError ? error.status : 0;
  const msg = error instanceof Error ? error.message : String(error);
  if (error instanceof UwHttpError && error.planRestricted) {
    return (
      <div className="p-2 text-[11px] dim" title={msg}>
        🔒 Not included in your Unusual Whales plan.
      </div>
    );
  }
  const hint =
    status === 503 ? (
      <button className="term-btn ml-2" onClick={() => setSection("settings")}>
        add API key →
      </button>
    ) : status === 401 ? (
      " — the key was rejected. Check it in Settings."
    ) : status === 403 ? (
      " — your Unusual Whales plan may not include this endpoint."
    ) : status === 429 ? (
      " — rate limited. Raise the refresh interval or wait a minute."
    ) : status === 422 || status === 400 ? (
      " — check the parameters."
    ) : null;
  return (
    <div className="p-2 text-[11px] down">
      {status ? `${status} · ` : ""}
      {msg}
      <span className="dim">{hint}</span>
    </div>
  );
}

/** Small status line for panel headers: spinner / last update. */
export function Freshness({ fetching, updatedAt }: { fetching: boolean; updatedAt: number }) {
  if (fetching) return <span className="amber">●</span>;
  if (!updatedAt) return null;
  return <span className="dim">{new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}</span>;
}

export function ExplorerLink({ path, params }: { path: string; params?: Params }) {
  const openInExplorer = useWhales((s) => s.openInExplorer);
  return (
    <button className="dim hover:text-[var(--amber)]" title={`Open ${path} in the API explorer`} onClick={() => openInExplorer(path, params)}>
      ⇱
    </button>
  );
}

/** Bypasses the server cache too, so a manual refresh is always a live call. */
export function RefreshButton({ path, params = {} }: { path: string; params?: Params }) {
  const qc = useQueryClient();
  return (
    <button
      className="dim hover:text-[var(--amber)]"
      title="Refresh now (bypasses cache)"
      onClick={() =>
        uwGet(path, params, true)
          .then((d) => qc.setQueryData(["uw", path, params], d))
          .catch(() => qc.invalidateQueries({ queryKey: ["uw", path] }))
      }
    >
      ↻
    </button>
  );
}

/** A panel bound to one UW endpoint, rendered as a sortable/filterable table. */
export function EndpointTable({
  title,
  path,
  params = {},
  columns,
  live,
  sort,
  transform,
  className = "",
  bare,
  extra,
  onRowClick,
  rowClass,
}: {
  title: ReactNode;
  path: string;
  params?: Params;
  columns?: string[];
  live?: boolean;
  sort?: SortState;
  transform?: (rows: Row[]) => Row[];
  className?: string;
  bare?: boolean;
  extra?: ReactNode;
  onRowClick?: (row: Row) => void;
  rowClass?: (row: Row) => string;
}) {
  const q = useUw(path, params, { live });
  const rows = q.data ? (transform ? transform(toRows(q.data)) : toRows(q.data)) : [];
  return (
    <Panel
      title={title}
      className={className}
      right={
        <>
          {extra}
          <Freshness fetching={q.isFetching} updatedAt={q.dataUpdatedAt} />
          <RefreshButton path={path} params={params} />
          <ExplorerLink path={path} params={params} />
        </>
      }
    >
      <ErrorNote error={q.error} />
      {q.isLoading && <div className="p-2 dim">Loading…</div>}
      {q.data !== undefined && (
        <DataTable rows={rows} columns={columns} name={path} initialSort={sort ?? null} bare={bare} onRowClick={onRowClick} rowClass={rowClass} />
      )}
    </Panel>
  );
}

export function Stat({ label, value, sub, cls = "" }: { label: string; value: ReactNode; sub?: ReactNode; cls?: string }) {
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] px-2 py-1 min-w-24">
      <div className="dim text-[9px] uppercase tracking-wider truncate">{label}</div>
      <div className={`text-[15px] font-bold leading-tight ${cls}`}>{value}</div>
      {sub !== undefined && <div className="text-[10px] dim truncate">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <span className="inline-flex">
      {options.map((o) => (
        <button key={o.value} title={o.title} className={`term-btn !px-1.5 ${value === o.value ? "active" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function NeedsTicker({ children }: { children: ReactNode }) {
  return <div className="p-3 dim">{children}</div>;
}

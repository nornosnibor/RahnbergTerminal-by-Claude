"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildUwUrl, uwGet, uwWrite, useUwCatalog, useUwStatus, type Params, type UwEndpoint } from "../../../lib/uw/api";
import { nestedTables, toRows } from "../../../lib/uw/format";
import { useTerminal } from "../../../store/terminal";
import { useWhales } from "../../../store/whales";
import DataTable from "../DataTable";
import ParamForm, { defaultParams, missingRequired } from "../ParamForm";
import { ErrorNote, Panel, Segmented } from "../ui";

const METHOD_CLS: Record<string, string> = { GET: "up", POST: "amber", PUT: "text-[#40c4ff]", DELETE: "down", PATCH: "text-[#40c4ff]" };
const key = (e: UwEndpoint) => `${e.method} ${e.path}`;

function EndpointList({
  endpoints,
  selected,
  onSelect,
  restricted,
}: {
  endpoints: UwEndpoint[];
  selected: string | null;
  onSelect: (e: UwEndpoint) => void;
  restricted: Set<string>;
}) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? endpoints.filter((e) => `${e.path} ${e.summary} ${e.group} ${e.description}`.toLowerCase().includes(t)) : endpoints;
  }, [endpoints, q]);
  const groups = useMemo(() => {
    const m = new Map<string, UwEndpoint[]>();
    for (const e of filtered) m.set(e.group, [...(m.get(e.group) ?? []), e]);
    return [...m.entries()];
  }, [filtered]);
  return (
    <div className="flex flex-col h-full min-h-0">
      <input className="m-1" placeholder={`search ${endpoints.length} endpoints… (gex, flow, darkpool, earnings)`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="flex-1 overflow-auto min-h-0">
        {groups.map(([g, list]) => (
          <div key={g}>
            <button className="w-full text-left px-2 py-0.5 text-[10px] uppercase tracking-wider amber bg-[var(--panel-2)] border-b border-[var(--border)] flex justify-between" onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}>
              <span>{collapsed[g] && !q ? "▸" : "▾"} {g}</span>
              <span className="dim">{list.length}</span>
            </button>
            {(!collapsed[g] || q) &&
              list.map((e) => (
                <button
                  key={key(e)}
                  onClick={() => onSelect(e)}
                  className={`w-full text-left px-2 py-0.5 text-[11px] flex gap-1.5 hover:bg-[#1a1a1a] ${selected === key(e) ? "bg-[#1f1a10] text-[var(--amber)]" : ""}`}
                  title={e.path}
                >
                  <span className={`w-9 shrink-0 text-[9px] ${METHOD_CLS[e.method]}`}>{e.method}</span>
                  <span className={`truncate ${e.deprecated ? "line-through dim" : ""} ${restricted.has(key(e)) ? "dim" : ""}`}>{e.summary}</span>
                  {restricted.has(key(e)) && <span className="ml-auto dim" title="Not included in your Unusual Whales plan">🔒</span>}
                </button>
              ))}
          </div>
        ))}
        {groups.length === 0 && <div className="p-2 dim">No endpoint matches “{q}”.</div>}
      </div>
    </div>
  );
}

function Runner({ ep, initialParams, autoRun }: { ep: UwEndpoint; initialParams: Params; autoRun: number }) {
  const ticker = useTerminal((s) => s.activeSymbol).replace(/^\^/, "");
  const autoRefresh = useWhales((s) => s.autoRefresh);
  const refreshSecs = useWhales((s) => s.refreshSecs);
  const [params, setParams] = useState<Params>(() => ({ ...defaultParams(ep, ticker), ...initialParams }));
  const [submitted, setSubmitted] = useState<Params | null>(autoRun ? { ...defaultParams(ep, ticker), ...initialParams } : null);
  const [live, setLive] = useState(false);
  const [view, setView] = useState<string>("table");
  const [body, setBody] = useState(ep.bodyExample !== undefined ? JSON.stringify(ep.bodyExample, null, 2) : "");
  const [writeResult, setWriteResult] = useState<{ ok: boolean; data: unknown } | null>(null);
  const isGet = ep.method === "GET";

  const q = useQuery({
    queryKey: ["uw-explorer", ep.path, submitted],
    queryFn: () => uwGet(ep.path, submitted!, true),
    enabled: isGet && submitted !== null,
    refetchInterval: live && autoRefresh ? refreshSecs * 1000 : false,
    retry: false,
  });

  let url = "";
  let urlError = "";
  try {
    url = buildUwUrl(ep.path, params).replace("/api/uw/proxy", "");
  } catch (e) {
    urlError = (e as Error).message;
  }
  const missing = missingRequired(ep, params);
  if (!urlError && missing.length) urlError = `Required: ${missing.join(", ")}`;
  const curl = `curl -H "Authorization: Bearer $UW_API_KEY" "https://api.unusualwhales.com${url}"`;
  const rows = useMemo(() => (q.data !== undefined ? toRows(q.data) : []), [q.data]);
  const subTables = useMemo(() => (q.data !== undefined ? nestedTables(q.data) : []), [q.data]);
  const sub = subTables.find((t) => t.key === view);

  const runWrite = async () => {
    if (!confirm(`${ep.method} ${url}\n\nThis changes data in your Unusual Whales account. Continue?`)) return;
    try {
      const parsed = body.trim() ? JSON.parse(body) : undefined;
      setWriteResult({ ok: true, data: await uwWrite(ep.method, ep.path, params, parsed) });
    } catch (e) {
      setWriteResult({ ok: false, data: (e as Error).message });
    }
  };

  return (
    <div className="flex flex-col gap-1 h-full min-h-0">
      <Panel
        title={
          <span>
            <span className={METHOD_CLS[ep.method]}>{ep.method}</span> {ep.path}
          </span>
        }
        right={<span className="dim">{ep.group}</span>}
        className="shrink-0 max-h-[50%]"
        bodyClass="p-2 flex flex-col gap-2"
      >
        <div>
          <div className="text-[13px] font-bold">{ep.summary}{ep.deprecated && <span className="down ml-2 text-[10px]">DEPRECATED</span>}</div>
          {ep.description && <div className="dim text-[11px] mt-0.5 max-h-20 overflow-auto">{ep.description}</div>}
        </div>
        <ParamForm endpoint={ep} values={params} onChange={setParams} columns={4} />
        {!isGet && (
          <label className="flex flex-col gap-0.5">
            <span className="dim text-[10px]">JSON body</span>
            <textarea className="bg-[var(--panel-2)] border border-[var(--border)] p-1 text-[11px] font-mono h-24 outline-none focus:border-[var(--amber)]" value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
        )}
        <div className="flex gap-2 items-center flex-wrap">
          {isGet ? (
            <button className="term-btn active" disabled={Boolean(urlError)} onClick={() => setSubmitted({ ...params })}>
              ▶ run
            </button>
          ) : (
            <button className="term-btn !border-[var(--down)] !text-[var(--down)]" disabled={Boolean(urlError)} onClick={runWrite}>
              ⚠ send {ep.method}
            </button>
          )}
          {isGet && (
            <label className="flex items-center gap-1 cursor-pointer text-[11px]">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> auto-refresh
            </label>
          )}
          <button className="term-btn" onClick={() => navigator.clipboard.writeText(curl)} title={curl}>
            copy curl
          </button>
          <code className="dim text-[10px] truncate flex-1">{urlError ? <span className="down">{urlError}</span> : url}</code>
          {q.isFetching && <span className="amber">●</span>}
        </div>
      </Panel>

      {isGet && (
        <Panel
          className="flex-1 min-h-[300px]"
          title={q.data !== undefined ? `Result · ${rows.length} rows` : "Result"}
          right={
            q.data !== undefined && (
              <Segmented
                value={view}
                onChange={setView}
                options={[{ value: "table", label: "table" }, ...subTables.map((t) => ({ value: t.key, label: `${t.key} (${t.rows.length})` })), { value: "json", label: "json" }]}
              />
            )
          }
        >
          <ErrorNote error={q.error} />
          {submitted === null && <div className="p-3 dim">Set parameters and press ▶ run.</div>}
          {q.data !== undefined &&
            (view === "json" ? (
              <pre className="text-[11px] p-2 whitespace-pre-wrap break-all">{JSON.stringify(q.data, null, 2).slice(0, 400_000)}</pre>
            ) : (
              <DataTable key={view} rows={sub ? sub.rows : rows} name={ep.path} />
            ))}
        </Panel>
      )}
      {!isGet && writeResult && (
        <Panel title={writeResult.ok ? "Response" : "Error"} className="flex-1">
          <pre className={`text-[11px] p-2 whitespace-pre-wrap ${writeResult.ok ? "" : "down"}`}>{typeof writeResult.data === "string" ? writeResult.data : JSON.stringify(writeResult.data, null, 2)}</pre>
        </Panel>
      )}
    </div>
  );
}

export default function Explorer() {
  const { data: catalog, error } = useUwCatalog();
  const { data: status } = useUwStatus();
  const explorer = useWhales((s) => s.explorer);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (explorer.path) setSelected(`${explorer.method} ${explorer.path}`);
  }, [explorer.path, explorer.method, explorer.run]);

  const endpoints = catalog?.endpoints ?? [];
  const ep = endpoints.find((e) => key(e) === selected) ?? endpoints.find((e) => e.path === "/api/stock/{ticker}/gex-levels");
  const fromStore = ep && explorer.path === ep.path && explorer.method === ep.method;

  return (
    <div className="grid grid-cols-[300px_1fr] gap-1 p-1 h-full min-h-0">
      <Panel title={`All endpoints (${endpoints.length})`} bodyClass="!overflow-hidden">
        <ErrorNote error={error} />
        <EndpointList endpoints={endpoints} selected={ep ? key(ep) : null} onSelect={(e) => setSelected(key(e))} restricted={new Set(status?.restricted ?? [])} />
      </Panel>
      <div className="min-h-0 overflow-auto">
        {!status?.configured && <div className="p-2 amber text-[11px]">No API key configured yet — add one in Settings to run requests.</div>}
        {ep && <Runner key={`${key(ep)}:${fromStore ? explorer.run : 0}`} ep={ep} initialParams={fromStore ? explorer.params : {}} autoRun={fromStore ? explorer.run : 0} />}
      </div>
    </div>
  );
}

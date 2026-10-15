"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUwStatus, uwJson } from "../../../lib/uw/api";
import { useWhales } from "../../../store/whales";
import { Panel } from "../ui";

export default function Settings() {
  const qc = useQueryClient();
  const { data: status, refetch } = useUwStatus();
  const autoRefresh = useWhales((s) => s.autoRefresh);
  const setAutoRefresh = useWhales((s) => s.setAutoRefresh);
  const refreshSecs = useWhales((s) => s.refreshSecs);
  const setRefreshSecs = useWhales((s) => s.setRefreshSecs);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      await refetch();
      qc.invalidateQueries({ queryKey: ["uw"] });
    }
  };

  const save = () =>
    act(async () => {
      await uwJson("/api/uw/key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      setKey("");
      const t = await uwJson<{ rows: number }>("/api/uw/key/test", { method: "POST" });
      return `Saved and verified — Unusual Whales answered (${t.rows} market-tide ticks).`;
    });

  const test = () =>
    act(async () => {
      const t = await uwJson<{ rows: number }>("/api/uw/key/test", { method: "POST" });
      return `Key works — ${t.rows} market-tide ticks returned.`;
    });

  const remove = () =>
    act(async () => {
      await uwJson("/api/uw/key", { method: "DELETE" });
      return "Saved key removed (an env var key, if set, is now used).";
    });

  const limits = Object.entries(status?.usage.limits ?? {});

  return (
    <div className="grid gap-1 p-1 grid-cols-12 auto-rows-min max-w-6xl">
      <Panel className="col-span-12 lg:col-span-7" title="Unusual Whales API key" bodyClass="p-2 flex flex-col gap-2 text-[11px]">
        <div>
          Status:{" "}
          {status?.configured ? (
            <span className="up">● configured ({status.key}, from {status.source === "env" ? "UW_API_KEY env var" : "saved setting"})</span>
          ) : (
            <span className="down">○ not configured</span>
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input type="password" autoComplete="off" className="flex-1" placeholder="paste your API token (a UUID like 123e4567-e89b-12d3-a456-426614174000)" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="term-btn active" disabled={busy || !key.trim()}>save & verify</button>
        </form>
        <div className="flex gap-2">
          <button className="term-btn" disabled={busy || !status?.configured} onClick={test}>test connection</button>
          <button className="term-btn" disabled={busy || status?.source !== "settings"} onClick={remove}>remove saved key</button>
        </div>
        {msg && <div className={msg.ok ? "up" : "down"}>{msg.text}</div>}
        <div className="dim leading-relaxed">
          The key is stored only on this machine (in the terminal’s local SQLite database under <code>data/</code>, which is git-ignored) and is never sent to the
          browser — every request goes through the local server, which adds the key. Alternatively set <code>UW_API_KEY=…</code> in a <code>.env</code> file at the repo root.
          Get your token at unusualwhales.com/dashboard/api.
        </div>
      </Panel>

      <Panel className="col-span-12 lg:col-span-5" title="Refresh & rate limits" bodyClass="p-2 flex flex-col gap-2 text-[11px]">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> Auto-refresh live panels
        </label>
        <label className="flex items-center gap-2">
          every
          <select value={refreshSecs} onChange={(e) => setRefreshSecs(Number(e.target.value))}>
            {[10, 15, 30, 60, 120, 300].map((s) => (
              <option key={s} value={s}>{s}s</option>
            ))}
          </select>
          <span className="dim">(server also caches identical requests for ~10s)</span>
        </label>
        <div className="border-t border-[var(--border)] pt-1">
          <div className="dim uppercase text-[10px] mb-1">This session</div>
          <div>requests {status?.usage.requests ?? 0} · cache hits {status?.usage.cacheHits ?? 0} · errors {status?.usage.errors ?? 0} · last latency {status?.usage.lastLatencyMs ?? "—"}ms</div>
          {status?.usage.lastError && <div className="down">last error: {status.usage.lastError}</div>}
        </div>
        <div>
          <div className="dim uppercase text-[10px] mb-1">Limits reported by Unusual Whales</div>
          {limits.length ? (
            limits.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="dim">{k.replace(/^x-uw-/, "")}</span>
                <span>{v}</span>
              </div>
            ))
          ) : (
            <div className="dim">No requests yet.</div>
          )}
        </div>
      </Panel>

      <Panel className="col-span-12" title="How to use the Whales page" bodyClass="p-2 text-[11px] leading-relaxed">
        <ul className="list-disc pl-4 flex flex-col gap-0.5">
          <li><b className="amber">Ticker</b> — type a symbol in the top bar (or ⌘K). Every per-ticker panel follows it; clicking any ticker in any table loads it.</li>
          <li><b className="amber">Cockpit</b> — the scalping view: price, GEX walls/flip/magnet, the strike ladder, net premium flow, live flow alerts, hottest contracts and dark pool prints.</li>
          <li><b className="amber">Tables</b> — click headers to sort; “⧩ filters” adds per-column filters: <code>&gt;1m</code> <code>&lt;0.5</code> <code>10..20</code> <code>=call</code> <code>!put</code> <code>spy|qqq</code>. “cols” picks columns, “⤓ csv” exports.</li>
          <li><b className="amber">⇱</b> on any panel opens that exact request in the <b>API Explorer</b>, where every one of the {status?.endpoints ?? 230} endpoints can be run with any parameters.</li>
          <li><b className="amber">Keys</b> — ⌥W toggles between the Terminal and Whales; ⌘K searches symbols.</li>
        </ul>
      </Panel>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { ParamValue, Params, UwEndpoint, UwParam } from "../../lib/uw/api";

/** Initial values: required params get their example (path params use the active ticker). */
export function defaultParams(ep: UwEndpoint, ticker: string): Params {
  const out: Params = {};
  for (const p of ep.params) {
    if (p.name === "ticker" && p.in === "path") out[p.name] = ticker;
    else if (p.required) out[p.name] = exampleFor(p, ticker);
  }
  return out;
}

export function exampleFor(p: UwParam, ticker: string): ParamValue {
  if (/ticker|symbol/.test(p.name) && p.type === "string" && !p.enum) return ticker;
  if (p.enum?.length) return p.array ? [p.enum[0]] : p.enum[0];
  // Spec examples are years old; dates/expiries default to today instead.
  if (p.type === "date" || /date|expir/.test(p.name)) {
    const today = new Date().toISOString().slice(0, 10);
    return p.array ? [today] : today;
  }
  if (p.example !== undefined) return p.array ? [String(p.example)] : (p.example as ParamValue);
  return "";
}

/** Names of required params that are still empty — the explorer won't send the request until filled. */
export function missingRequired(ep: UwEndpoint, values: Params): string[] {
  return ep.params
    .filter((p) => p.required && p.in !== "header")
    .filter((p) => {
      const v = values[p.name];
      return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    })
    .map((p) => p.name);
}

function Field({ p, value, onChange }: { p: UwParam; value: ParamValue; onChange: (v: ParamValue) => void }) {
  const cls = "w-full";
  if (p.enum && p.array) {
    const arr = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 max-h-24 overflow-auto">
        {p.enum.map((opt) => (
          <label key={opt} className="flex items-center gap-1 cursor-pointer text-[10px]">
            <input type="checkbox" checked={arr.includes(opt)} onChange={(e) => onChange(e.target.checked ? [...arr, opt] : arr.filter((x) => x !== opt))} />
            {opt}
          </label>
        ))}
      </div>
    );
  }
  if (p.enum) {
    return (
      <select className={cls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">{p.required ? "— choose —" : "any"}</option>
        {p.enum.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (p.type === "boolean") {
    return (
      <select className={cls} value={value === true ? "true" : value === false ? "false" : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}>
        <option value="">any</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (p.array) {
    return (
      <input
        className={cls}
        placeholder="comma separated"
        value={Array.isArray(value) ? value.join(",") : String(value ?? "")}
        onChange={(e) => onChange(e.target.value ? e.target.value.split(",").map((s) => s.trim()) : [])}
      />
    );
  }
  return (
    <input
      className={cls}
      type={p.type === "date" || p.format === "date" ? "date" : "text"}
      inputMode={p.type === "integer" || p.type === "number" ? "decimal" : undefined}
      placeholder={p.example !== undefined ? String(p.example) : p.type}
      value={value === undefined || value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function ParamForm({
  endpoint,
  values,
  onChange,
  columns = 3,
}: {
  endpoint: UwEndpoint;
  values: Params;
  onChange: (v: Params) => void;
  columns?: number;
}) {
  const [filter, setFilter] = useState("");
  const params = endpoint.params.filter((p) => p.in !== "header");
  const visible = params.filter((p) => !filter || p.name.includes(filter.toLowerCase()) || p.description?.toLowerCase().includes(filter.toLowerCase()));
  const set = (name: string, v: ParamValue) => {
    const next = { ...values };
    if (v === "" || v === undefined || (Array.isArray(v) && v.length === 0)) delete next[name];
    else next[name] = v;
    onChange(next);
  };
  if (params.length === 0) return <div className="dim text-[11px] p-1">This endpoint takes no parameters.</div>;
  return (
    <div>
      {params.length > 12 && (
        <input className="w-64 mb-1" placeholder={`filter ${params.length} parameters…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      <div className="grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {visible.map((p) => (
          <label key={`${p.in}:${p.name}`} className="flex flex-col gap-0.5 min-w-0" title={p.description}>
            <span className="text-[10px] truncate">
              <span className={p.required ? "amber" : "dim"}>
                {p.name}
                {p.required ? " *" : ""}
              </span>
              <span className="dim"> · {p.in === "path" ? "path" : p.array ? `${p.type}[]` : p.type}</span>
            </span>
            <Field p={p} value={values[p.name]} onChange={(v) => set(p.name, v)} />
          </label>
        ))}
      </div>
    </div>
  );
}

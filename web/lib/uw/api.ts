"use client";

import { useQuery } from "@tanstack/react-query";
import { useWhales } from "../../store/whales";

export type UwParam = {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  type: string;
  array?: boolean;
  enum?: string[];
  format?: string;
  example?: string | number | boolean;
  default?: unknown;
  min?: number;
  max?: number;
  description?: string;
};

export type UwEndpoint = {
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  tag: string;
  group: string;
  summary: string;
  description: string;
  deprecated: boolean;
  params: UwParam[];
  bodyExample?: unknown;
};

export type UwCatalog = { generatedAt: string; version: string | null; endpoints: UwEndpoint[] };

export type UwStatus = {
  configured: boolean;
  source: "settings" | "env" | null;
  key: string | null;
  baseUrl: string;
  endpoints: number;
  usage: {
    requests: number;
    errors: number;
    cacheHits: number;
    lastStatus: number | null;
    lastError: string | null;
    lastLatencyMs: number | null;
    limits: Record<string, string>;
  };
};

export type ParamValue = string | number | boolean | string[] | null | undefined;
export type Params = Record<string, ParamValue>;

export class UwHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Fill `{placeholders}` from params; remaining params become the query string (arrays repeat). */
export function buildUwUrl(path: string, params: Params = {}): string {
  const used = new Set<string>();
  const filled = path.replace(/\{([^}]+)\}/g, (_, n: string) => {
    used.add(n);
    const v = params[n];
    if (v === undefined || v === null || v === "") throw new Error(`Missing ${n}`);
    return encodeURIComponent(String(v));
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (used.has(k) || v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.filter((x) => x !== "").forEach((x) => qs.append(k, String(x)));
    else qs.append(k, String(v));
  }
  const q = qs.toString();
  return `/api/uw/proxy${filled}${q ? `?${q}` : ""}`;
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new UwHttpError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function uwGet<T = unknown>(path: string, params?: Params, fresh = false): Promise<T> {
  let url = buildUwUrl(path, params);
  if (fresh) url += (url.includes("?") ? "&" : "?") + "_fresh=1";
  return parse<T>(await fetch(url));
}

export async function uwWrite<T = unknown>(method: string, path: string, params: Params, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(buildUwUrl(path, params), {
      method,
      headers: { "Content-Type": "application/json", "x-uw-confirm-write": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

export async function uwJson<T>(url: string, init?: RequestInit): Promise<T> {
  return parse<T>(await fetch(url, init));
}

export function useUwStatus() {
  return useQuery({
    queryKey: ["uw-status"],
    queryFn: () => uwJson<UwStatus>("/api/uw/status"),
    refetchInterval: 15_000,
  });
}

export function useUwCatalog() {
  return useQuery({
    queryKey: ["uw-catalog"],
    queryFn: () => uwJson<UwCatalog>("/api/uw/catalog"),
    staleTime: Infinity,
  });
}

/**
 * Query one UW endpoint. `live` panels follow the global auto-refresh interval;
 * nothing is fetched until a key is configured, and missing path params just wait.
 */
export function useUw<T = unknown>(path: string, params: Params = {}, opts: { live?: boolean; enabled?: boolean; refreshMs?: number } = {}) {
  const { data: status } = useUwStatus();
  const autoRefresh = useWhales((s) => s.autoRefresh);
  const refreshSecs = useWhales((s) => s.refreshSecs);
  const missing = [...path.matchAll(/\{([^}]+)\}/g)].some(([, n]) => params[n] === undefined || params[n] === null || params[n] === "");
  const live = opts.live ?? false;
  return useQuery({
    queryKey: ["uw", path, params],
    queryFn: () => uwGet<T>(path, params),
    enabled: Boolean(status?.configured) && !missing && (opts.enabled ?? true),
    refetchInterval: live && autoRefresh ? (opts.refreshMs ?? refreshSecs * 1000) : false,
    retry: (count, err) => !(err instanceof UwHttpError && [400, 401, 403, 404, 422, 428, 503].includes(err.status)) && count < 1,
    // Keep showing the last result while filters refresh — but never another ticker's data.
    placeholderData: (prev, prevQuery) => {
      const prevParams = (prevQuery?.queryKey[2] ?? {}) as Params;
      const samePath = prevQuery?.queryKey[1] === path;
      const sameTarget = [...path.matchAll(/\{([^}]+)\}/g)].every(([, n]) => prevParams[n] === params[n]);
      return samePath && sameTarget ? prev : undefined;
    },
  });
}

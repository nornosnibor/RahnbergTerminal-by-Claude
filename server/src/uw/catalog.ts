import catalogJson from "./catalog.json" with { type: "json" };

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

export const catalog = catalogJson as { generatedAt: string; version: string | null; endpoints: UwEndpoint[] };

type Compiled = { ep: UwEndpoint; re: RegExp; names: string[]; literals: number };

// Literal segments outrank placeholders, so `/api/insider/transactions` beats `/api/insider/{ticker}`.
const compiled: Compiled[] = catalog.endpoints
  .map((ep) => {
    const names: string[] = [];
    const segs = ep.path.split("/").filter(Boolean);
    const pattern = segs
      .map((seg) => {
        const m = seg.match(/^\{(.+)\}$/);
        if (m) {
          names.push(m[1]);
          return "([^/]+)";
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { ep, re: new RegExp(`^/${pattern}/?$`), names, literals: segs.filter((s) => !s.startsWith("{")).length };
  })
  .sort((a, b) => b.literals - a.literals);

export type Match = { endpoint: UwEndpoint; pathParams: Record<string, string>; upstreamPath: string };

/**
 * Resolve a concrete (URL-encoded) path like `/api/stock/AAPL/gex-levels` against the catalog.
 * Returns null when no endpoint with that method exists — the proxy only forwards known endpoints.
 * Throws on path params that try to escape their segment (`..`, encoded slashes).
 */
export function matchEndpoint(method: string, rawPath: string): Match | null {
  for (const c of compiled) {
    if (c.ep.method !== method.toUpperCase()) continue;
    const m = rawPath.match(c.re);
    if (!m) continue;
    const pathParams: Record<string, string> = {};
    c.names.forEach((n, i) => {
      let v: string;
      try {
        v = decodeURIComponent(m[i + 1]);
      } catch {
        throw new Error(`Malformed path parameter "${n}"`);
      }
      if (!v || v === "." || v === ".." || /[/\\?#]/.test(v)) throw new Error(`Invalid path parameter "${n}"`);
      pathParams[n] = v;
    });
    return { endpoint: c.ep, pathParams, upstreamPath: buildPath(c.ep.path, pathParams) };
  }
  return null;
}

export function buildPath(template: string, params: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, n: string) => {
    const v = params[n];
    if (v === undefined || v === "") throw new Error(`Missing path parameter "${n}"`);
    return encodeURIComponent(v);
  });
}

export function findByPath(method: string, template: string): UwEndpoint | undefined {
  return catalog.endpoints.find((e) => e.method === method.toUpperCase() && e.path === template);
}

/** Flatten any UW payload shape (`{data:[…]}`, `{data:{…}}`, bare array/object) into table rows. */
export function toRows(json: unknown): Record<string, unknown>[] {
  const body = json && typeof json === "object" && !Array.isArray(json) && "data" in json ? (json as { data: unknown }).data : json;
  if (Array.isArray(body)) {
    return body.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : Array.isArray(item)
          ? Object.fromEntries(item.map((v, i) => [`col${i}`, v]))
          : { value: item }
    );
  }
  if (body && typeof body === "object") {
    // `{data: {dividends: [...], ticker}}` → the rows of its single nested list.
    const lists = Object.values(body).filter((v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x)));
    if (lists.length === 1) return lists[0] as Record<string, unknown>[];
    return [body as Record<string, unknown>];
  }
  if (body === null || body === undefined) return [];
  return [{ value: body }];
}

const TIME_KEYS = ["timestamp", "time", "tape_time", "executed_at", "created_at", "market_date", "date", "start_time"];

/** The most recent row by its time/date field — UW returns some series newest-first, others oldest-first. */
export function latestRow<T extends Record<string, unknown>>(rows: T[]): T | undefined {
  if (rows.length <= 1) return rows[0];
  const key = TIME_KEYS.find((k) => rows.some((r) => typeof r[k] === "string" && !Number.isNaN(Date.parse(String(r[k])))));
  if (!key) return rows[rows.length - 1];
  return rows.reduce((best, r) => (Date.parse(String(r[key])) > Date.parse(String(best[key])) ? r : best));
}

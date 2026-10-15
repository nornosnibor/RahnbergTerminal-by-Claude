import { num, type Row } from "./format";

// Column filter mini-language used by every UW table:
//   >1000000   <0.5   >=10   <=-2   1..5 (range)   =call   !put   spy (substring)   a|b (any of)
//   1m / 2.5k / 3b suffixes are understood for numbers.

export type Predicate = (v: unknown) => boolean;

export function parseNum(s: string): number | null {
  const m = s.trim().match(/^([-+]?\d*\.?\d+)\s*([kmbt])?$/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[2] ?? "").toLowerCase() as "k"] ?? 1;
  return Number(m[1]) * mult;
}

export function parseFilter(expr: string): Predicate | null {
  const e = expr.trim();
  if (!e) return null;
  if (e.includes("|")) {
    const parts = e.split("|").map(parseFilter).filter(Boolean) as Predicate[];
    return (v) => parts.some((p) => p(v));
  }
  const cmp = e.match(/^(>=|<=|>|<)\s*(.+)$/);
  if (cmp) {
    const target = parseNum(cmp[2]);
    if (target === null) return () => true;
    return (v) => {
      const n = num(v);
      if (n === null) return false;
      switch (cmp[1]) {
        case ">": return n > target;
        case "<": return n < target;
        case ">=": return n >= target;
        default: return n <= target;
      }
    };
  }
  const range = e.match(/^([-+]?[\d.]+[kmbt]?)\s*\.\.\s*([-+]?[\d.]+[kmbt]?)$/i);
  if (range) {
    const lo = parseNum(range[1]);
    const hi = parseNum(range[2]);
    return (v) => {
      const n = num(v);
      return n !== null && lo !== null && hi !== null && n >= lo && n <= hi;
    };
  }
  if (e.startsWith("!")) {
    const inner = parseFilter(e.slice(1));
    return inner ? (v) => !inner(v) : null;
  }
  if (e.startsWith("=")) {
    const t = e.slice(1).trim().toLowerCase();
    return (v) => String(v ?? "").toLowerCase() === t;
  }
  const t = e.toLowerCase();
  return (v) => String(v ?? "").toLowerCase().includes(t);
}

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export function compareValues(a: unknown, b: unknown): number {
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return na - nb;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  return String(a).localeCompare(String(b));
}

export function applyTable(rows: Row[], opts: { search?: string; filters?: Record<string, string>; sort?: SortState }): Row[] {
  let out = rows;
  const q = opts.search?.trim().toLowerCase();
  if (q) out = out.filter((r) => Object.values(r).some((v) => v !== null && typeof v !== "object" && String(v).toLowerCase().includes(q)));
  const preds = Object.entries(opts.filters ?? {})
    .map(([k, e]) => [k, parseFilter(e)] as const)
    .filter((x): x is readonly [string, Predicate] => x[1] !== null);
  if (preds.length) out = out.filter((r) => preds.every(([k, p]) => p(r[k])));
  if (opts.sort) {
    const { key, dir } = opts.sort;
    const sign = dir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const aEmpty = av === null || av === undefined || av === "";
      const bEmpty = bv === null || bv === undefined || bv === "";
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1; // blanks always last
      return sign * compareValues(av, bv);
    });
  }
  return out;
}

/** Union of keys across the first rows, preferring a caller-supplied order. */
export function columnsOf(rows: Row[], preferred: string[] = []): string[] {
  const seen = new Set<string>();
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) seen.add(k);
  const pref = preferred.filter((k) => seen.has(k));
  return [...pref, ...[...seen].filter((k) => !pref.includes(k))];
}

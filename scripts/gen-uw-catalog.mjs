#!/usr/bin/env node
// Regenerates the Unusual Whales endpoint catalog from the official OpenAPI spec.
//
//   node scripts/gen-uw-catalog.mjs [path-or-url-to-openapi.yaml]
//
// Writes:
//   server/src/uw/catalog.json  — every endpoint, its params, tag and docs (served to the UI)
//   server/src/uw/samples.json  — a sample 200 response per endpoint (used by the mock server + tests)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "server", "package.json"));
const YAML = require("yaml");

const src = process.argv[2] ?? "https://api.unusualwhales.com/api/openapi";
const text = src.startsWith("http") ? await (await fetch(src)).text() : readFileSync(src, "utf8");
const spec = YAML.parse(text);
const S = spec.components?.schemas ?? {};

const refName = (ref) => decodeURIComponent(ref.split("/").pop());
function resolve(s, seen = new Set()) {
  while (s && s.$ref) {
    const name = refName(s.$ref);
    if (seen.has(name)) return {};
    seen.add(name);
    s = S[name];
  }
  return s ?? {};
}

// Strip markdown links / collapse whitespace so docs render cleanly as plain text.
const clean = (t = "", max = 600) => {
  const s = String(t)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

const GROUP_LABELS = {
  "Gex/Greeks": "GEX & Greeks", stock: "Stock", "option-contract": "Option Contracts",
  "option-trade": "Option Trades & Flow", screener: "Screeners", market: "Market",
  volatility: "Volatility", darkpool: "Dark Pool", "lit-flow": "Lit Flow", short: "Shorts",
  earnings: "Earnings", insiders: "Insiders", institution: "Institutions", congress: "Congress",
  unusual_trades: "Congress — Unusual", politician_portfolios: "Politician Portfolios",
  politics: "Politics / FEC", potus: "POTUS", etfs: "ETFs", group_flow: "Group Flow",
  "options-pulse": "Options Pulse", seasonality: "Seasonality", news: "News",
  companies: "Companies", intel: "Intel / Calendars", alerts: "Alerts", watchlists: "Watchlists",
  "flex-options": "FLEX Options", Futures: "Futures", crypto: "Crypto",
  digital_currencies: "Digital Currencies", forex: "Forex", commodities: "Commodities",
  economy: "Economy", predictions: "Prediction Markets", private_markets: "Private Markets",
  "stock-directory": "Stock Directory",
};

function paramInfo(p) {
  const s = resolve(p.schema);
  const isArray = s.type === "array" || p.name.endsWith("[]");
  const item = isArray ? resolve(s.items) : s;
  const out = {
    name: p.name,
    in: p.in,
    required: Boolean(p.required),
    type: item.type ?? (item.enum ? "string" : "string"),
  };
  if (isArray) out.array = true;
  if (item.enum) out.enum = item.enum;
  if (item.format) out.format = item.format;
  const ex = s.example ?? item.example ?? p.example;
  if (ex !== undefined && typeof ex !== "object") out.example = ex;
  if (s.default !== undefined) out.default = s.default;
  if (s.minimum !== undefined) out.min = s.minimum;
  if (s.maximum !== undefined) out.max = s.maximum;
  const d = clean(p.description || s.description || item.description || "", 280);
  if (d) out.description = d;
  return out;
}

// Build a sample value from a schema, preferring the spec's own examples.
function sample(schema, depth = 0, seen = new Set()) {
  if (depth > 8) return null;
  if (schema?.$ref) {
    const name = refName(schema.$ref);
    if (seen.has(name)) return null;
    const next = new Set(seen).add(name);
    return sample(S[name], depth + 1, next);
  }
  const s = schema ?? {};
  if (s.example !== undefined) return s.example;
  for (const k of ["oneOf", "anyOf", "allOf"]) {
    if (s[k]?.length) {
      if (k === "allOf") return Object.assign({}, ...s[k].map((x) => sample(x, depth + 1, seen) ?? {}));
      return sample(s[k][0], depth + 1, seen);
    }
  }
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case "array": return [sample(s.items, depth + 1, seen)];
    case "integer": return 1;
    case "number": return 1.5;
    case "boolean": return true;
    case "string": return s.format === "date" ? "2026-10-14" : s.format === "date-time" ? "2026-10-14T14:30:00Z" : "sample";
  }
  if (s.properties) {
    const o = {};
    for (const [k, v] of Object.entries(s.properties)) o[k] = sample(v, depth + 1, seen);
    return o;
  }
  return null;
}

const endpoints = [];
const samples = {};
for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
    const tag = op.tags?.[0] ?? "other";
    const id = op.operationId ?? `${method}_${path}`.replace(/[^a-zA-Z0-9]+/g, "_");
    const params = (op.parameters ?? []).map((p) => (p.$ref ? resolve(p) : p)).map(paramInfo);
    const body = op.requestBody?.content?.["application/json"]?.schema;
    endpoints.push({
      id,
      method: method.toUpperCase(),
      path,
      tag,
      group: GROUP_LABELS[tag] ?? tag,
      summary: op.summary ?? id,
      description: clean(op.description ?? "", 900),
      deprecated: Boolean(op.deprecated || /deprecated/i.test(op.summary ?? "")),
      params,
      ...(body ? { bodyExample: sample(body) } : {}),
    });
    const ok = op.responses?.["200"] ?? op.responses?.["201"];
    const schema = ok?.content?.["application/json"]?.schema;
    samples[`${method.toUpperCase()} ${path}`] = schema ? sample(schema) : { data: [] };
  }
}

endpoints.sort((a, b) => a.group.localeCompare(b.group) || a.path.localeCompare(b.path));
const outDir = join(root, "server", "src", "uw");
writeFileSync(
  join(outDir, "catalog.json"),
  JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), version: spec.info?.version ?? null, endpoints }, null, 0)
);
writeFileSync(join(outDir, "samples.json"), JSON.stringify(samples));
console.log(`catalog: ${endpoints.length} endpoints, ${new Set(endpoints.map((e) => e.group)).size} groups`);

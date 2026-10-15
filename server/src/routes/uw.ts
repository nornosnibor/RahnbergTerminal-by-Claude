import { Router, type Request, type Response } from "express";
import { catalog, findByPath, matchEndpoint, buildPath, latestRow, toRows } from "../uw/catalog.js";
import { UwError, baseUrl, getKey, isValidKey, maskKey, restricted, saveKey, usage, uwFetch } from "../uw/client.js";

export const uwRouter = Router();

// The proxy spends the user's paid API quota, so only the terminal's own web UI may call it.
// (The rest of the API keeps the original open CORS policy.)
const allowedOrigins = () =>
  (process.env.UW_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((s) => s.trim());

uwRouter.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && !allowedOrigins().includes(origin)) {
    return res.status(403).json({ error: `Origin ${origin} is not allowed to use the Unusual Whales proxy (see UW_ALLOWED_ORIGINS).` });
  }
  res.removeHeader("Access-Control-Allow-Origin");
  next();
});

function sendError(res: Response, err: unknown) {
  const status = err instanceof UwError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  const planRestricted = err instanceof UwError && err.planRestricted;
  res.status(status).json({ error: message, status, planRestricted, detail: err instanceof UwError ? err.body : undefined });
}

/** Raw query string of the incoming request — kept verbatim so `issue_types[]=a&issue_types[]=b` survives. */
function rawQuery(req: Request): string {
  const i = req.originalUrl.indexOf("?");
  if (i < 0) return "";
  const params = new URLSearchParams(req.originalUrl.slice(i + 1));
  params.delete("_fresh");
  return params.toString();
}

uwRouter.get("/status", (_req, res) => {
  const { key, source } = getKey();
  res.json({
    configured: Boolean(key),
    source,
    key: maskKey(key),
    baseUrl: baseUrl(),
    endpoints: catalog.endpoints.length,
    usage,
    // Endpoint templates this key was refused for (not in the plan) — the UI greys them out.
    restricted: [...restricted],
  });
});

uwRouter.put("/key", (req, res) => {
  const key = String(req.body?.key ?? "").trim();
  if (!isValidKey(key)) return res.status(400).json({ error: "Unusual Whales API keys are UUIDs (e.g. 123e4567-e89b-12d3-a456-426614174000)." });
  saveKey(key);
  res.json({ ok: true, key: maskKey(key) });
});

uwRouter.delete("/key", (_req, res) => {
  saveKey(null);
  res.json({ ok: true, ...getKey(), key: maskKey(getKey().key) });
});

/** Cheap authenticated call used by the Settings panel to confirm the key works. */
uwRouter.post("/key/test", async (_req, res) => {
  try {
    const json = await uwFetch({ path: "/api/market/market-tide", query: "interval_5m=true", fresh: true });
    res.json({ ok: true, rows: toRows(json).length, limits: usage.limits });
  } catch (err) {
    sendError(res, err);
  }
});

uwRouter.get("/catalog", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.json(catalog);
});

// Forward a request to any endpoint in the catalog. Unknown paths are rejected, and write
// methods (watchlists/alerts) require an explicit confirmation header from the UI.
uwRouter.all("/proxy/*", async (req, res) => {
  const rawPath = req.path.replace(/^\/proxy/, "");
  let match;
  try {
    match = matchEndpoint(req.method, rawPath);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
  if (!match) return res.status(404).json({ error: `${req.method} ${rawPath} is not an Unusual Whales endpoint in the catalog.` });
  if (req.method !== "GET" && req.get("x-uw-confirm-write") !== "1") {
    return res.status(428).json({ error: "Write requests must be confirmed (x-uw-confirm-write: 1)." });
  }
  try {
    const json = await uwFetch({
      method: req.method,
      template: match.endpoint.path,
      path: match.upstreamPath,
      query: rawQuery(req),
      body: req.method === "GET" || req.method === "DELETE" ? undefined : req.body,
      fresh: "_fresh" in req.query,
    });
    res.json(json);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Multi-ticker scan: run one per-ticker endpoint across a list of tickers and merge the
 * results into a single table (one row per ticker, or every row when `mode` is "all").
 */
uwRouter.post("/scan", async (req, res) => {
  const { path: template, tickers, params = {}, mode = "latest" } = req.body ?? {};
  const ep = typeof template === "string" ? findByPath("GET", template) : undefined;
  if (!ep || !ep.path.includes("{ticker}")) return res.status(400).json({ error: "path must be a GET catalog endpoint containing {ticker}" });
  const list: string[] = Array.isArray(tickers)
    ? [...new Set(tickers.map((t: unknown) => String(t).trim().toUpperCase()).filter((t) => /^[A-Z0-9.^/-]{1,12}$/.test(t)))]
    : [];
  if (list.length === 0) return res.status(400).json({ error: "tickers must be a non-empty list" });
  if (list.length > 60) return res.status(400).json({ error: "scan is limited to 60 tickers at a time" });

  const qs = new URLSearchParams();
  const pathParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === "" || v === null || v === undefined) continue;
    if (ep.path.includes(`{${k}}`)) pathParams[k] = String(v);
    else if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
    else qs.append(k, String(v));
  }

  const rows: Record<string, unknown>[] = [];
  const errors: Array<{ ticker: string; error: string }> = [];
  await Promise.all(
    list.map(async (ticker) => {
      try {
        const json = await uwFetch({ path: buildPath(ep.path, { ...pathParams, ticker }), template: ep.path, query: qs.toString() });
        const r = toRows(json);
        const latest = latestRow(r);
        const picked = mode === "all" ? r : latest ? [latest] : [];
        for (const row of picked) rows.push({ ticker, ...row });
      } catch (err) {
        errors.push({ ticker, error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
  rows.sort((a, b) => list.indexOf(String(a.ticker)) - list.indexOf(String(b.ticker)));
  res.json({ endpoint: ep.path, rows, errors });
});

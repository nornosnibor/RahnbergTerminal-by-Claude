import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

// Isolate the DB and point the client at an in-process mock of api.unusualwhales.com.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "uw-test-")), "test.db");
delete process.env.UW_API_KEY;
delete process.env.UNUSUAL_WHALES_API_KEY;

const { createMockUw } = await import("./mock.js");
const { app } = await import("../index.js");
const { catalog } = await import("./catalog.js");
const client = await import("./client.js");

const GOOD_KEY = "123e4567-e89b-42d3-a456-426614174000";
let mock: Server;
let api: Server;
let echo: Server;
let apiUrl = "";
let mockUrl = "";
let echoUrl = "";
let lastEcho: { url: string; auth?: string; body?: unknown } | null = null;

const listen = (a: express.Express) =>
  new Promise<Server>((resolve) => {
    const s = a.listen(0, "127.0.0.1", () => resolve(s));
  });
const urlOf = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

beforeAll(async () => {
  mock = await listen(createMockUw());
  api = await listen(app);
  const e = express();
  e.use(express.json());
  e.use((req, res) => {
    lastEcho = { url: req.originalUrl, auth: req.get("authorization"), body: req.body };
    res.json({ data: [{ ok: true }] });
  });
  echo = await listen(e);
  mockUrl = urlOf(mock);
  apiUrl = urlOf(api);
  echoUrl = urlOf(echo);
});

afterAll(() => {
  mock?.close();
  api?.close();
  echo?.close();
});

beforeEach(() => {
  process.env.UW_BASE_URL = mockUrl;
  process.env.UW_MAX_RPM = "100000";
  process.env.UW_CACHE_TTL_MS = "10000";
  client._resetUwState();
  client.saveKey(GOOD_KEY);
});

const get = (p: string, init?: RequestInit) => fetch(`${apiUrl}${p}`, init);

// Sensible concrete values for every path parameter in the catalog.
const PATH_DEFAULTS: Record<string, string> = {
  ticker: "SPY", sector: "Technology", name: "VANGUARD GROUP INC", quarter: "2026Q2", pair: "BTC-USD",
  candle_size: "5m", interval: "5min", token: "BTC", indicator: "gdp", chain: "4SPX261218P05000000",
  contract: "ESZ6", security_id: "1", expiry: "2026-10-16", flow_group: "airline",
  id: "SPY261016C00585000", date: "2026-10-14", politician_id: "abc", asset_id: "123", user_id: "u1",
  npm_ticker: "SPACEX", month: "3", function: "RSI",
};

function concrete(ep: (typeof catalog.endpoints)[number]) {
  const path = ep.path.replace(/\{([^}]+)\}/g, (_, n: string) => {
    const p = ep.params.find((x) => x.name === n && x.in === "path");
    const v = PATH_DEFAULTS[n] ?? String(p?.example ?? p?.enum?.[0] ?? "x");
    return encodeURIComponent(v.split(" or ")[0]);
  });
  const qs = new URLSearchParams();
  for (const p of ep.params.filter((x) => x.in === "query" && x.required)) {
    qs.append(p.name, String(p.example ?? p.enum?.[0] ?? (p.type === "date" || /date|expiry/.test(p.name) ? "2026-10-16" : p.name === "delta" ? "0.25" : "AAPL")));
  }
  return `${path}${qs.size ? `?${qs}` : ""}`;
}

describe("uw key management", () => {
  it("reports status with a masked key", async () => {
    const s = await (await get("/api/uw/status")).json();
    expect(s.configured).toBe(true);
    expect(s.source).toBe("settings");
    expect(s.key).toBe("123e…4000");
    expect(JSON.stringify(s)).not.toContain(GOOD_KEY);
    expect(s.endpoints).toBe(catalog.endpoints.length);
  });

  it("rejects malformed keys and accepts UUIDs", async () => {
    const bad = await get("/api/uw/key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "nope" }) });
    expect(bad.status).toBe(400);
    const ok = await get("/api/uw/key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: GOOD_KEY }) });
    expect(ok.status).toBe(200);
  });

  it("returns 503 with guidance when no key is configured", async () => {
    client.saveKey(null);
    const res = await get("/api/uw/proxy/api/market/market-tide");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/API key not configured/);
  });

  it("falls back to UW_API_KEY from the environment", async () => {
    client.saveKey(null);
    process.env.UW_API_KEY = GOOD_KEY;
    try {
      expect(client.getKey().source).toBe("env");
      expect((await get("/api/uw/proxy/api/market/market-tide")).status).toBe(200);
    } finally {
      delete process.env.UW_API_KEY;
    }
  });

  it("key test endpoint verifies against the API", async () => {
    const res = await get("/api/uw/key/test", { method: "POST" });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.rows).toBeGreaterThan(0);
  });
});

describe("uw proxy", () => {
  it("serves the endpoint catalog", async () => {
    const c = await (await get("/api/uw/catalog")).json();
    expect(c.endpoints.length).toBe(catalog.endpoints.length);
  });

  it(`returns data for every GET endpoint in the catalog (${catalog.endpoints.filter((e) => e.method === "GET").length})`, async () => {
    const failures: string[] = [];
    const gets = catalog.endpoints.filter((e) => e.method === "GET");
    for (const ep of gets) {
      const url = concrete(ep);
      const res = await get(`/api/uw/proxy${url}`);
      if (res.status !== 200) failures.push(`${res.status} ${url} ${await res.text()}`);
      else await res.json();
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it("forwards the raw query string, including repeated array params", async () => {
    process.env.UW_BASE_URL = echoUrl;
    const res = await get("/api/uw/proxy/api/screener/stocks?issue_types[]=ETF&issue_types[]=Common%20Stock&min_marketcap=1000000000&_fresh=1");
    expect(res.status).toBe(200);
    expect(lastEcho!.url).toBe("/api/screener/stocks?issue_types%5B%5D=ETF&issue_types%5B%5D=Common+Stock&min_marketcap=1000000000");
    expect(lastEcho!.auth).toBe(`Bearer ${GOOD_KEY}`);
  });

  it("rejects paths outside the catalog and traversal attempts", async () => {
    expect((await get("/api/uw/proxy/api/admin/secrets")).status).toBe(404);
    expect((await get("/api/uw/proxy/api/stock/..%2F..%2Fx/info")).status).toBe(400);
  });

  it("requires confirmation for write endpoints", async () => {
    process.env.UW_BASE_URL = echoUrl;
    const body = JSON.stringify({ name: "scalps", tickers: ["SPY"] });
    const headers = { "Content-Type": "application/json" };
    expect((await get("/api/uw/proxy/api/watchlists/stocks", { method: "POST", headers, body })).status).toBe(428);
    const ok = await get("/api/uw/proxy/api/watchlists/stocks", { method: "POST", headers: { ...headers, "x-uw-confirm-write": "1" }, body });
    expect(ok.status).toBe(200);
    expect(lastEcho!.body).toEqual({ name: "scalps", tickers: ["SPY"] });
  });

  it("blocks cross-origin callers from spending the API quota", async () => {
    const res = await get("/api/uw/proxy/api/market/market-tide", { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect((await get("/api/uw/status", { headers: { Origin: "http://localhost:3000" } })).status).toBe(200);
  });

  it("passes upstream auth / plan / rate-limit errors through with their message", async () => {
    client.saveKey("deadbeef-0000-4000-8000-000000000000");
    let res = await get("/api/uw/proxy/api/stock/SPY/gex-levels");
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.error).toMatch(/tier/);
    expect(j.planRestricted).toBe(true);
    client.saveKey("1a1a1a1a-0000-4000-8000-000000000000");
    res = await get("/api/uw/proxy/api/stock/QQQ/gex-levels");
    expect(res.status).toBe(429);
  });

  it("treats UW's 422 'Missing access' as a plan restriction and reports it in status", async () => {
    client.saveKey("cccccccc-0000-4000-8000-000000000000");
    const res = await get("/api/uw/proxy/api/companies/AAPL/profile");
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.planRestricted).toBe(true);
    expect(j.error).toMatch(/Missing access/);
    const s = await (await get("/api/uw/status")).json();
    expect(s.restricted).toContain("GET /api/companies/{ticker}/profile");
    expect((await get("/api/uw/proxy/api/stock/AAPL/info")).status).toBe(200);
    client.saveKey(GOOD_KEY);
    expect((await (await get("/api/uw/status")).json()).restricted).toEqual([]);
  });

  it("caches GETs and de-duplicates concurrent identical requests", async () => {
    await Promise.all([1, 2, 3].map(() => get("/api/uw/proxy/api/stock/NVDA/max-pain")));
    await get("/api/uw/proxy/api/stock/NVDA/max-pain");
    expect(client.usage.requests).toBe(1);
    expect(client.usage.cacheHits).toBeGreaterThanOrEqual(1);
    await get("/api/uw/proxy/api/stock/NVDA/max-pain?_fresh=1");
    expect(client.usage.requests).toBe(2);
  });

  it("records UW rate-limit headers for the UI", async () => {
    await get("/api/uw/proxy/api/market/oi-change?_fresh=1");
    const s = await (await get("/api/uw/status")).json();
    expect(s.usage.limits["x-uw-req-per-minute-remaining"]).toBeDefined();
  });

  it("pauses when Unusual Whales reports the per-minute budget is spent", async () => {
    client.saveKey("2b2b2b2b-0000-4000-8000-000000000000");
    expect((await get("/api/uw/proxy/api/stock/AAPL/iv-rank")).status).toBe(200);
    const t0 = Date.now();
    expect((await get("/api/uw/proxy/api/stock/MSFT/iv-rank")).status).toBe(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
  });

  it("enforces the local per-minute budget instead of hammering UW", async () => {
    process.env.UW_MAX_RPM = "2";
    expect((await get("/api/uw/proxy/api/stock/AAPL/info")).status).toBe(200);
    expect((await get("/api/uw/proxy/api/stock/MSFT/info")).status).toBe(200);
    const third = await get("/api/uw/proxy/api/stock/AMD/info");
    expect(third.status).toBe(429);
    expect((await third.json()).error).toMatch(/budget/);
  });
});

describe("uw multi-ticker scan", () => {
  it("merges one row per ticker and drops invalid symbols", async () => {
    const res = await get("/api/uw/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/api/stock/{ticker}/gex-levels", tickers: ["spy", "QQQ", "bad ticker!", "SPY"] }),
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.rows.map((r: any) => r.ticker)).toEqual(["SPY", "QQQ"]);
    expect(j.rows[0]).toHaveProperty("call_wall");
    expect(j.errors).toEqual([]);
  });

  it("returns every row in mode=all and fills extra path params", async () => {
    const res = await get("/api/uw/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/api/stock/{ticker}/ohlc/{candle_size}", tickers: ["SPY"], params: { candle_size: "5m", limit: 10 }, mode: "all" }),
    });
    const j = await res.json();
    expect(j.rows.length).toBe(10);
  });

  it("validates input", async () => {
    const bad = await get("/api/uw/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "/api/market/market-tide", tickers: ["SPY"] }) });
    expect(bad.status).toBe(400);
  });
});

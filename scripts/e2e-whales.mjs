#!/usr/bin/env node
// End-to-end smoke test of the WHALES page in a real (headless) browser.
//
//   npm run dev:mock            # terminal 1: app + mock Unusual Whales API
//   npm run test:e2e            # terminal 2
//
// Visits every section and sub-tab, runs every flow/screener/contract preset, a watchlist
// multi-scan and the API explorer, and fails on any page error, console error, or
// non-2xx /api/uw response. Screenshots land in e2e-shots/.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_SHOTS ?? "e2e-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const problems = [];
let uwCalls = 0;
let planRestricted = 0;
// E2E_REAL=1: running against a real key — endpoints outside the plan are expected, not failures.
const REAL = process.env.E2E_REAL === "1";

page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  // Failed-resource lines duplicate the HTTP check above (which knows about plan restrictions).
  if (m.type() === "error" && !/Download the React DevTools|favicon|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 300)}`);
});
page.on("response", async (r) => {
  const url = r.url();
  if (!url.includes("/api/uw/")) return;
  uwCalls++;
  if (r.status() >= 400) {
    const text = await r.text().catch(() => "");
    if (REAL && text.includes('"planRestricted":true')) return void planRestricted++;
    problems.push(`HTTP ${r.status()} ${url.replace(BASE, "")} ${text.slice(0, 200)}`);
  }
});

const settle = async (ms = 1200) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
const click = async (name, exact = false) => {
  await page.getByRole("button", { name, exact }).first().click();
  await settle();
};
const visibleErrors = async (where) => {
  const errs = await page.locator(".down").filter({ hasText: /^\d{3} · / }).allInnerTexts();
  for (const e of errs) problems.push(`${where}: visible error "${e.slice(0, 160)}"`);
};
const step = async (label, fn) => {
  const before = problems.length;
  try {
    await fn();
  } catch (e) {
    problems.push(`${label}: ${String(e.message ?? e).split("\n")[0]}`);
  }
  await visibleErrors(label);
  console.log(`${problems.length === before ? "✓" : "✗"} ${label}`);
};

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.goto(BASE);
await settle(2000);

await step("terminal page still loads", async () => {
  await page.getByText("Add widget").waitFor();
  await shot("00-terminal");
});

await step("switch to WHALES (button)", async () => {
  await click(/WHALES/);
  await page.getByText("SCALP COCKPIT").first().waitFor();
});

const sections = [
  ["SCALP COCKPIT", "01-cockpit", []],
  ["GEX / GREEKS", "02-gex", []],
  ["OPTIONS FLOW", "03-flow", ["Unusual options activity", "Hottest chains", "Multi-leg trades", "OI change leaders", "Flow alerts"]],
  ["MARKET PULSE", "04-market", []],
  ["SCANNERS", "05-scanners", ["Short squeeze screener", "Analyst ratings", "Options pulse", "Saved scans", "Stock screener"]],
  ["VALUE / FUNDAMENTALS", "06-value", []],
  ["VOLATILITY", "07-volatility", []],
  ["DARK POOL & TAPE", "08-darkpool", []],
  ["SMART MONEY", "09-smart", ["Insiders", "Institutions (13F)", "Politician portfolios", "Congress"]],
  ["SETTINGS", "11-settings", []],
];

for (const [label, file, tabs] of sections) {
  await step(`section ${label}`, async () => {
    await click(label);
    await settle(1500);
    await shot(file);
    const rows = await page.locator("table.uw-table tbody tr").count();
    const charts = await page.locator(".recharts-surface").count();
    console.log(`    rows=${rows} charts=${charts}`);
    if (label !== "SETTINGS" && rows + charts === 0 && !REAL) problems.push(`${label}: rendered no tables or charts`);
  });
  for (const tab of tabs) {
    await step(`  tab ${label} › ${tab}`, async () => {
      await click(tab, true);
      await settle(800);
      await shot(`${file}-${tab.replace(/\W+/g, "_")}`);
    });
  }
}

await step("ticker switch → NVDA reloads cockpit", async () => {
  await click("SCALP COCKPIT");
  await page.getByLabel("Ticker").fill("nvda");
  await page.getByLabel("Ticker").press("Enter");
  await settle(1500);
  await page.getByText("Gamma exposure by strike · NVDA").waitFor();
  // The header must show NVDA's price (mock spot ≈ 182), never the previous ticker's.
  const priceCell = page.locator("div.text-\\[15px\\]").first();
  let price = NaN;
  for (let i = 0; i < 30 && !(price > 0); i++) {
    price = Number((await priceCell.innerText()).replace(/,/g, "")); // "—" while loading
    if (!(price > 0)) await page.waitForTimeout(500);
  }
  if (REAL ? !(price > 0) : !(price > 170 && price < 195)) problems.push(`cockpit header shows ${price} after switching to NVDA`);
  await shot("12-cockpit-nvda");
});

await step("GEX ladder modes (Vol / Dir / c-p / ±10%)", async () => {
  for (const m of ["Vol", "Dir", "OI"]) await click(m, true);
  await click("c/p", true);
  await page.locator("select").filter({ hasText: "±5%" }).first().selectOption("0.1");
  await settle();
  await shot("13-gex-modes");
});

await step("every flow preset", async () => {
  await click("OPTIONS FLOW");
  for (const p of ["Unusual (UW default)", "Whale prints ≥ $1M", "0DTE scalps", "Aggressive sweeps", "Bullish call buying", "Bearish put buying", "New positions (size > OI)", "Earnings plays", "LEAPS accumulation", "Floor trades", "Small-cap unusual", "Everything (raw tape)"]) {
    await click(p, true);
  }
  await page.getByPlaceholder("tickers e.g. SPY,QQQ or -TSLA").fill("SPY,QQQ");
  await page.getByPlaceholder("min prem $").fill("50000");
  await page.getByText("sweeps", { exact: true }).click();
  await settle();
  await shot("14-flow-filtered");
});

await step("table tools: sort, filter, columns", async () => {
  const th = page.locator("table.uw-table th", { hasText: "Total Prem" }).first();
  await th.click();
  await page.getByRole("button", { name: /filters/ }).first().click();
  await page.locator("table.uw-table thead tr").nth(1).locator("input").nth(1).fill("spy");
  await settle(400);
  await page.getByRole("button", { name: /^cols/ }).first().click();
  await page.waitForTimeout(300);
  await shot("15-table-tools");
  await page.mouse.move(5, 5);
});

await step("every stock screener preset + custom DSL run", async () => {
  await click("SCANNERS");
  await click("Stock screener", true);
  for (const p of ["Most active options", "Net call premium leaders", "Net put premium leaders", "High IV rank (sell premium)", "Low IV rank (buy premium)", "Gamma flip → put dominance", "Momentum pullback (RSI ≤ 30)", "Value: dividend large caps", "Value: near 52-week low", "Insider buying (3m)", "2 ATR above 20 EMA", "2σ daily move (IV-implied)", "S&P 500 — all"]) {
    await click(p, true);
  }
  await page.locator("textarea").first().fill("where iv_rank > 60 and put_call_ratio < 0.5");
  await click("show all", false);
  await click("▶ run", true);
  await shot("16-screener");
});

await step("save a scan and run it", async () => {
  page.once("dialog", (d) => d.accept("My IV scan"));
  await click("☆ save scan", true);
  await click("Saved scans", true);
  await click("▶ My IV scan", true);
  await settle();
  await shot("17-saved-scan");
});

await step("hottest-chain presets", async () => {
  await click("OPTIONS FLOW");
  await click("Hottest chains", true);
  for (const p of ["Hottest chains", "Volume ≫ OI", "0DTE movers", "Cheap OTM lottos", "OI building 3+ days", "Sweep heavy", "UW unusual"]) {
    await page.getByRole("button", { name: p, exact: true }).last().click();
    await settle(500);
  }
});

await step("watchlist multi-scan (every target)", async () => {
  await click("SCANNERS");
  await click("Watchlist multi-scan", true);
  const select = page.locator("select").filter({ hasText: "GEX levels" }).first();
  const options = await select.locator("option").allInnerTexts();
  for (const o of options) {
    await select.selectOption({ label: o });
    await click("▶ scan", true);
    await page.getByText(/tickers$/).first().waitFor({ timeout: 20000 });
  }
  await select.selectOption({ index: 0 });
  await click("▶ scan", true);
  await settle();
  await shot("18-multiscan");
});

await step("explorer: open from panel ⇱, search, run, json, sub-tables", async () => {
  await click("SCALP COCKPIT");
  await page.getByTitle("Open /api/stock/{ticker}/flow-alerts in the API explorer").first().click();
  await settle(1500);
  await page.getByText("Result ·").waitFor();
  await shot("19-explorer-from-panel");
  await page.getByPlaceholder(/search 230 endpoints/).fill("full financials");
  await page.getByRole("button", { name: /Full Financials/ }).first().click();
  await click("▶ run", true);
  await page.getByRole("button", { name: /income_statements/ }).click();
  await settle(400);
  await click("json", true);
  await shot("20-explorer-json");
});

await step("explorer: run 40 assorted endpoints from the list", async () => {
  const search = page.getByPlaceholder(/search 230 endpoints/);
  for (const q of ["GEX Levels", "Greek Exposure By Strike And Expiry", "Max Pain", "Option Chains", "Interpolated IV", "Short Data", "Sector Tide", "Economic calendar", "Holdings", "Recent Congress Trades", "Futures Contracts", "FX Spot Rate", "Crypto Pair State", "Unusual Prediction Markets", "Company Profile", "Analyst Rating", "Realized Volatility", "Top Volatility Anomalies", "Insider buy & sells", "Technical Indicator", "News Headlines", "Option Price Levels", "OHLC", "Stock Quote", "Market Seasonality", "Correlations", "IPO Calendar", "Earnings Call Transcript", "Lobbying", "Fixed-Window Analytics", "FLEX market overview", "Commodity Series", "Economic Indicator", "Volume Unusualness", "Options Pulse Scanner", "Option watchlists", "Alert filters", "Full Tape", "ATM Chains", "Greek flow by expiry"]) {
    await search.fill(q);
    await page.locator("nav, div").getByRole("button", { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&"), "i") }).first().click();
    const run = page.getByRole("button", { name: "▶ run", exact: true });
    if (await run.isDisabled()) {
      // Required params with no sensible default (ids, quarters…) — fill test values.
      const PATH_VALUES = { quarter: "2026Q2", pair: "BTC-USD", token: "BTC", politician_id: "abc", asset_id: "1", user_id: "u1", npm_ticker: "SPACEX", function: "RSI", security_id: "1", id: "SPY261016C00585000", date: "2026-10-14", name: "VANGUARD GROUP INC", contract: "ESZ6", chain: "4SPX261218P05000000" };
      for (const label of await page.locator("label").filter({ has: page.locator("span.amber") }).all()) {
        const name = (await label.locator("span.amber, span.dim").first().innerText()).replace(" *", "").trim();
        const input = label.locator("input");
        if ((await input.count()) && !(await input.inputValue())) await input.fill(PATH_VALUES[name] ?? "x");
      }
    }
    if (await run.isDisabled()) problems.push(`explorer: run still disabled for "${q}"`);
    else await run.click();
    await page.waitForTimeout(250);
  }
  await settle();
  await shot("21-explorer-many");
});

await step("explorer: write endpoint requires confirmation", async () => {
  const search = page.getByPlaceholder(/search 230 endpoints/);
  await search.fill("Create stock watchlist");
  await page.getByRole("button", { name: /Create stock watchlist/ }).first().click();
  page.once("dialog", (d) => d.dismiss());
  await click(/send POST/);
  if (await page.getByText("Response").count()) problems.push("write ran without confirmation");
});

await step("⌥W toggles back to terminal", async () => {
  await page.keyboard.press("Alt+KeyW");
  await settle(500);
  await page.getByText("Add widget").waitFor();
  await page.keyboard.press("Alt+KeyW");
  await settle(500);
  await page.keyboard.press("Alt+Digit3");
  await settle(500);
  await page.getByText("Flow alerts").first().waitFor();
});

console.log(`\n${uwCalls} /api/uw responses observed${REAL ? ` (${planRestricted} not in plan)` : ""}`);
await browser.close();
if (problems.length) {
  console.log(`\n✗ ${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.log(" -", p);
  process.exit(1);
}
console.log("✓ WHALES e2e passed");

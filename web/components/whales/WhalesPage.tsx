"use client";

import { useState } from "react";
import { useUwStatus } from "../../lib/uw/api";
import { useTerminal } from "../../store/terminal";
import { useWhales, type WhalesSection } from "../../store/whales";
import Cockpit from "./sections/Cockpit";
import DarkPool from "./sections/DarkPool";
import Explorer from "./sections/Explorer";
import Flow from "./sections/Flow";
import Gex from "./sections/Gex";
import Market from "./sections/Market";
import Scanners from "./sections/Scanners";
import Settings from "./sections/Settings";
import SmartMoney from "./sections/SmartMoney";
import Value from "./sections/Value";
import Volatility from "./sections/Volatility";

export const SECTIONS: Array<{ id: WhalesSection; label: string; hint: string; perTicker: boolean }> = [
  { id: "cockpit", label: "SCALP COCKPIT", hint: "Price, GEX levels, strike ladder, net flow, live alerts", perTicker: true },
  { id: "gex", label: "GEX / GREEKS", hint: "Gamma, delta, vanna, charm by strike & expiry", perTicker: true },
  { id: "flow", label: "OPTIONS FLOW", hint: "Market-wide flow alerts, unusual activity, hottest chains", perTicker: false },
  { id: "market", label: "MARKET PULSE", hint: "Market/sector/ETF tide, movers, calendars, news", perTicker: false },
  { id: "scanners", label: "SCANNERS", hint: "Stock screener, watchlist multi-scan, shorts, analysts", perTicker: false },
  { id: "value", label: "VALUE / FUNDAMENTALS", hint: "Financials, earnings, ownership, seasonality", perTicker: true },
  { id: "volatility", label: "VOLATILITY", hint: "IV vs RV, term structure, skew, anomalies", perTicker: true },
  { id: "darkpool", label: "DARK POOL & TAPE", hint: "Dark pool & lit prints, price levels, shorts", perTicker: true },
  { id: "smart", label: "SMART MONEY", hint: "Congress, insiders, institutions, politicians", perTicker: false },
  { id: "explorer", label: "API EXPLORER", hint: "Every Unusual Whales endpoint with a form", perTicker: false },
  { id: "settings", label: "SETTINGS", hint: "API key, refresh rate, usage", perTicker: false },
];

function Body({ section }: { section: WhalesSection }) {
  switch (section) {
    case "cockpit": return <Cockpit />;
    case "gex": return <Gex />;
    case "flow": return <Flow />;
    case "market": return <Market />;
    case "scanners": return <Scanners />;
    case "value": return <Value />;
    case "volatility": return <Volatility />;
    case "darkpool": return <DarkPool />;
    case "smart": return <SmartMoney />;
    case "explorer": return <Explorer />;
    case "settings": return <Settings />;
  }
}

function TickerBox() {
  const active = useTerminal((s) => s.activeSymbol);
  const setActive = useTerminal((s) => s.setActiveSymbol);
  const scanTickers = useWhales((s) => s.scanTickers);
  const [draft, setDraft] = useState("");
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) setActive(draft.trim().toUpperCase());
        setDraft("");
      }}
    >
      <span className="dim">TICKER</span>
      <input
        aria-label="Ticker"
        className="w-24 !text-[13px] font-bold uppercase !text-[var(--amber)]"
        placeholder={active}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <span className="amber font-bold text-[13px] w-16">{active}</span>
      {scanTickers.slice(0, 10).map((t) => (
        <button type="button" key={t} className={`term-btn !px-1 ${t === active ? "active" : ""}`} onClick={() => setActive(t)}>
          {t}
        </button>
      ))}
    </form>
  );
}

export default function WhalesPage() {
  const section = useWhales((s) => s.section);
  const setSection = useWhales((s) => s.setSection);
  const autoRefresh = useWhales((s) => s.autoRefresh);
  const setAutoRefresh = useWhales((s) => s.setAutoRefresh);
  const refreshSecs = useWhales((s) => s.refreshSecs);
  const { data: status } = useUwStatus();
  const remaining = status?.usage.limits["x-uw-req-per-minute-remaining"];
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="flex flex-1 overflow-hidden">
      <nav className="w-44 bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider border-b border-[var(--border)] amber">🐋 Unusual Whales</div>
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            title={s.hint}
            onClick={() => setSection(s.id)}
            className={`text-left px-2 py-1.5 text-[11px] flex justify-between hover:bg-[#1a1a1a] hover:text-[var(--amber)] ${section === s.id ? "bg-[#1f1a10] text-[var(--amber)] border-l-2 border-[var(--amber)]" : ""}`}
          >
            <span>{s.label}</span>
            <span className="dim text-[9px]">{i < 9 ? `⌥${i + 1}` : ""}</span>
          </button>
        ))}
        <div className="mt-auto border-t border-[var(--border)] p-2 text-[10px] flex flex-col gap-1">
          <span className={status?.configured ? "up" : "down"}>{status?.configured ? `● key ${status.key}` : "○ no API key"}</span>
          <span className="dim">{status ? `${status.usage.requests} req · ${status.usage.cacheHits} cached` : ""}</span>
          {remaining !== undefined && <span className="dim">{remaining}/min left</span>}
        </div>
      </nav>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-2 h-8 border-b border-[var(--border)] bg-[var(--panel-2)] shrink-0 text-[11px]">
          <span className="amber font-bold">{current.label}</span>
          <span className="dim hidden xl:inline">{current.hint}</span>
          <span className="ml-auto" />
          {(current.perTicker || section === "explorer") && <TickerBox />}
          <label className="flex items-center gap-1 cursor-pointer" title="Auto-refresh live panels">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            <span className={autoRefresh ? "up" : "dim"}>LIVE {refreshSecs}s</span>
          </label>
        </div>
        {!status?.configured && section !== "settings" && status && (
          <div className="px-3 py-2 bg-[#1f1a10] border-b border-[var(--amber-dim)] text-[11px] flex items-center gap-2">
            <span className="amber">Connect your Unusual Whales API key to load data.</span>
            <button className="term-btn active" onClick={() => setSection("settings")}>open settings →</button>
          </div>
        )}
        <main className={`flex-1 min-h-0 ${section === "explorer" ? "overflow-hidden" : "overflow-auto"}`}>
          <Body section={section} />
        </main>
      </div>
    </div>
  );
}

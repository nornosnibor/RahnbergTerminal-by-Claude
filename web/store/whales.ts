"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Params } from "../lib/uw/api";

export type WhalesSection =
  | "cockpit" | "gex" | "flow" | "market" | "scanners" | "value"
  | "volatility" | "darkpool" | "smart" | "explorer" | "settings";

export type SavedScan = { id: string; name: string; path: string; params: Params; createdAt: string };

type WhalesState = {
  section: WhalesSection;
  autoRefresh: boolean;
  refreshSecs: number;
  scanTickers: string[];
  savedScans: SavedScan[];
  explorer: { path: string | null; method: string; params: Params; run: number };
  setSection: (s: WhalesSection) => void;
  setAutoRefresh: (on: boolean) => void;
  setRefreshSecs: (n: number) => void;
  setScanTickers: (t: string[]) => void;
  saveScan: (scan: Omit<SavedScan, "id" | "createdAt">) => void;
  deleteScan: (id: string) => void;
  openInExplorer: (path: string, params?: Params, method?: string) => void;
};

export const useWhales = create<WhalesState>()(
  persist(
    (set) => ({
      section: "cockpit",
      autoRefresh: true,
      refreshSecs: 30,
      scanTickers: ["SPY", "QQQ", "IWM", "NVDA", "TSLA", "AAPL", "AMD", "META", "AMZN", "MSFT"],
      savedScans: [],
      explorer: { path: null, method: "GET", params: {}, run: 0 },
      setSection: (section) => set({ section }),
      setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
      setRefreshSecs: (refreshSecs) => set({ refreshSecs: Math.max(5, Math.min(600, refreshSecs)) }),
      setScanTickers: (scanTickers) => set({ scanTickers }),
      saveScan: (scan) =>
        set((s) => ({ savedScans: [...s.savedScans, { ...scan, id: `scan-${Date.now()}`, createdAt: new Date().toISOString() }] })),
      deleteScan: (id) => set((s) => ({ savedScans: s.savedScans.filter((x) => x.id !== id) })),
      openInExplorer: (path, params = {}, method = "GET") =>
        set((s) => ({ section: "explorer", explorer: { path, method, params, run: s.explorer.run + 1 } })),
    }),
    { name: "rahnberg-whales", partialize: ({ explorer: _e, ...rest }) => rest }
  )
);

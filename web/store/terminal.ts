"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WidgetType =
  | "quote"
  | "chart"
  | "watchlist"
  | "news"
  | "heatmap"
  | "screener"
  | "crypto"
  | "macro"
  | "options"
  | "portfolio"
  | "ai"
  | "tape"
  | "tv"
  | "recap"
  | "oilrates";

export type WidgetInstance = {
  id: string;
  type: WidgetType;
  symbol?: string;
  linked: boolean; // follows the globally active symbol
};

export type LayoutItem = { i: string; x: number; y: number; w: number; h: number };

export type Page = "terminal" | "whales";

type TerminalState = {
  page: Page;
  setPage: (p: Page) => void;
  activeSymbol: string;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  watchlist: string[];
  commandOpen: boolean;
  setActiveSymbol: (s: string) => void;
  setCommandOpen: (open: boolean) => void;
  addWidget: (type: WidgetType, symbol?: string) => void;
  removeWidget: (id: string) => void;
  setWidgetSymbol: (id: string, symbol: string) => void;
  toggleLinked: (id: string) => void;
  setLayout: (layout: LayoutItem[]) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  resetWorkspace: () => void;
};

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "w-chart", type: "chart", linked: true },
  { id: "w-quote", type: "quote", linked: true },
  { id: "w-watchlist", type: "watchlist", linked: false },
  { id: "w-news", type: "news", linked: true },
  { id: "w-macro", type: "macro", linked: false },
  { id: "w-oilrates", type: "oilrates", linked: false },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "w-chart", x: 0, y: 0, w: 7, h: 12 },
  { i: "w-quote", x: 7, y: 0, w: 5, h: 6 },
  { i: "w-watchlist", x: 7, y: 6, w: 5, h: 6 },
  { i: "w-oilrates", x: 0, y: 12, w: 12, h: 12 },
  { i: "w-news", x: 0, y: 24, w: 7, h: 7 },
  { i: "w-macro", x: 7, y: 24, w: 5, h: 7 },
];

const SIZE_BY_TYPE: Record<WidgetType, { w: number; h: number }> = {
  quote: { w: 5, h: 6 },
  chart: { w: 7, h: 12 },
  watchlist: { w: 4, h: 7 },
  news: { w: 5, h: 8 },
  heatmap: { w: 7, h: 10 },
  screener: { w: 12, h: 9 },
  crypto: { w: 6, h: 9 },
  macro: { w: 5, h: 7 },
  options: { w: 12, h: 9 },
  portfolio: { w: 7, h: 8 },
  ai: { w: 5, h: 10 },
  tape: { w: 4, h: 10 },
  tv: { w: 6, h: 11 },
  recap: { w: 5, h: 12 },
  oilrates: { w: 12, h: 12 },
};

type PersistedWorkspace = { widgets?: WidgetInstance[]; layout?: LayoutItem[] };

/**
 * Bring a saved workspace up to date. v1 added the Oil & Rates widget to the
 * main page: it goes in under the chart and everything from there down moves
 * below it.
 */
export function migrateWorkspace(persisted: unknown, version: number): PersistedWorkspace {
  const state = (persisted ?? {}) as PersistedWorkspace;
  if (version < 1 && state.widgets && state.layout && !state.widgets.some((w) => w.type === "oilrates")) {
    const at = 12;
    const size = SIZE_BY_TYPE.oilrates;
    state.widgets = [...state.widgets, { id: "w-oilrates", type: "oilrates", linked: false }];
    state.layout = [
      ...state.layout.map((l) => (l.y >= at ? { ...l, y: l.y + size.h } : l)),
      { i: "w-oilrates", x: 0, y: at, ...size },
    ];
  }
  return state;
}

export const useTerminal = create<TerminalState>()(
  persist(
    (set) => ({
      page: "terminal",
      setPage: (page) => set({ page }),
      activeSymbol: "AAPL",
      widgets: DEFAULT_WIDGETS,
      layout: DEFAULT_LAYOUT,
      watchlist: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "SPY"],
      commandOpen: false,
      setActiveSymbol: (s) => set({ activeSymbol: s.toUpperCase() }),
      setCommandOpen: (open) => set({ commandOpen: open }),
      addWidget: (type, symbol) =>
        set((st) => {
          const id = `w-${type}-${Date.now()}`;
          const size = SIZE_BY_TYPE[type];
          const maxY = st.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          return {
            widgets: [...st.widgets, { id, type, symbol, linked: !symbol }],
            layout: [...st.layout, { i: id, x: 0, y: maxY, ...size }],
          };
        }),
      removeWidget: (id) =>
        set((st) => ({
          widgets: st.widgets.filter((w) => w.id !== id),
          layout: st.layout.filter((l) => l.i !== id),
        })),
      setWidgetSymbol: (id, symbol) =>
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, symbol: symbol.toUpperCase(), linked: false } : w)),
        })),
      toggleLinked: (id) =>
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, linked: !w.linked } : w)),
        })),
      setLayout: (layout) => set({ layout }),
      addToWatchlist: (s) =>
        set((st) => ({
          watchlist: st.watchlist.includes(s.toUpperCase()) ? st.watchlist : [...st.watchlist, s.toUpperCase()],
        })),
      removeFromWatchlist: (s) => set((st) => ({ watchlist: st.watchlist.filter((x) => x !== s) })),
      resetWorkspace: () => set({ widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT }),
    }),
    { name: "openterminal-workspace", version: 1, migrate: (persisted, version) => migrateWorkspace(persisted, version) as TerminalState }
  )
);

/** Symbol a widget should display: its own, or the active one when linked. */
export function useWidgetSymbol(widget: WidgetInstance): string {
  const active = useTerminal((s) => s.activeSymbol);
  return widget.linked ? active : widget.symbol ?? active;
}

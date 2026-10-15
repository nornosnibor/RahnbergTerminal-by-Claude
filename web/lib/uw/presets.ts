import type { Params } from "./api";

export type Preset = { id: string; label: string; hint: string; params: Params };

/** Market-wide flow alert presets — the scans traders actually run all day. */
export const FLOW_PRESETS: Preset[] = [
  { id: "unusual", label: "Unusual (UW default)", hint: "vol>OI, opening, OTM, ask-side ≥50%, ≥$10k, ≤60 DTE", params: { unusual: true } },
  { id: "whales", label: "Whale prints ≥ $1M", hint: "Any alert with ≥ $1,000,000 premium", params: { min_premium: 1_000_000 } },
  { id: "0dte", label: "0DTE scalps", hint: "Same-day expiry, ≥ $50k, ask-side heavy", params: { max_dte: 0, min_premium: 50_000, min_ask_perc: 0.6 } },
  { id: "sweeps", label: "Aggressive sweeps", hint: "Intermarket sweeps, ask side, ≥ $100k", params: { is_sweep: true, is_ask_side: true, min_premium: 100_000 } },
  { id: "bull-calls", label: "Bullish call buying", hint: "Calls on the ask, opening, ≥ $250k", params: { is_call: true, is_ask_side: true, all_opening: true, min_premium: 250_000 } },
  { id: "bear-puts", label: "Bearish put buying", hint: "Puts on the ask, opening, ≥ $250k", params: { is_put: true, is_ask_side: true, all_opening: true, min_premium: 250_000 } },
  { id: "new-pos", label: "New positions (size > OI)", hint: "Size exceeds open interest — fresh positioning", params: { size_greater_oi: true, min_premium: 100_000 } },
  { id: "earnings", label: "Earnings plays", hint: "Expiry within 7 days after next earnings", params: { min_days_between_expiry_and_earnings: 0, max_days_between_expiry_and_earnings: 7, min_premium: 50_000 } },
  { id: "leaps", label: "LEAPS accumulation", hint: "≥ 180 DTE, ≥ $250k — long-horizon conviction", params: { min_dte: 180, min_premium: 250_000 } },
  { id: "floor", label: "Floor trades", hint: "Floor-executed (institutional) orders", params: { is_floor: true, min_premium: 100_000 } },
  { id: "smallcap", label: "Small-cap unusual", hint: "Market cap < $2B, vol > OI", params: { max_marketcap: 2_000_000_000, vol_greater_oi: true, min_premium: 25_000 } },
  { id: "all", label: "Everything (raw tape)", hint: "No filters — newest alerts first", params: {} },
];

/** Stock screener presets (`/api/screener/stocks`). Fractions: 0.05 = 5%. */
export const SCREENER_PRESETS: Preset[] = [
  { id: "active-opts", label: "Most active options", hint: "Highest options volume vs 30-day average", params: { min_perc_30_day_total: 2, min_volume: 10_000 } },
  { id: "bull-prem", label: "Net call premium leaders", hint: "Biggest net call premium today", params: { min_net_call_premium: 1_000_000, order: "net_call_premium", order_direction: "desc" } },
  { id: "bear-prem", label: "Net put premium leaders", hint: "Biggest net put premium today", params: { min_net_put_premium: 1_000_000, order: "net_put_premium", order_direction: "desc" } },
  { id: "high-iv", label: "High IV rank (sell premium)", hint: "IV rank ≥ 70, liquid options", params: { min_iv_rank: 70, min_oi: 50_000, order: "iv_rank", order_direction: "desc" } },
  { id: "low-iv", label: "Low IV rank (buy premium)", hint: "IV rank ≤ 15, liquid options", params: { max_iv_rank: 15, min_oi: 50_000, order: "iv_rank", order_direction: "asc" } },
  { id: "gamma-flip", label: "Gamma flip → put dominance", hint: "UW's bearish gamma-flip recipe", params: { query: "where open_interest >= 50000 and gex_perc_change <= -1 and gex_net_change <= 0" } },
  { id: "oversold-mom", label: "Momentum pullback (RSI ≤ 30)", hint: "12-1 momentum > 10% with oversold RSI", params: { query: "where one_year_close > 0 and ((one_month_close / one_year_close) - 1) > 0.10 and rsi_14 <= 30" } },
  { id: "value-div", label: "Value: dividend large caps", hint: "Dividend payers > $10B down > 10% over 3 months", params: { has_dividends: true, min_marketcap: 10_000_000_000, max_pct_price_change_3_month: -0.1, order: "marketcap", order_direction: "desc" } },
  { id: "value-52w", label: "Value: near 52-week low", hint: "Bottom 15% of 52w range (log scale), > $2B", params: { min_marketcap: 2_000_000_000, query: "where week_52_low > 0 and week_52_high > week_52_low and price > 0 and log(price / week_52_low) / log(week_52_high / week_52_low) <= 0.15" } },
  { id: "insider-buys", label: "Insider buying (3m)", hint: "Insiders bought shares in the last 3 months", params: { query: "where insider_buy_volume_3m > 0 and insider_buy_volume_3m > insider_sell_volume_3m", order: "marketcap", order_direction: "desc" } },
  { id: "breakout", label: "2 ATR above 20 EMA", hint: "Extended breakouts (price − EMA20 ≥ 2×ATR14)", params: { query: "where atr_14 > 0 and price - ema_20 >= atr_14 * 2" } },
  { id: "big-move", label: "2σ daily move (IV-implied)", hint: "Moved ≥ 2 daily std devs implied by 30d IV", params: { query: "where change > -1 and iv30d > 0 and abs(ln(1 + change)) >= 2 * iv30d * sqrt(1 / 251)" } },
  { id: "sp500", label: "S&P 500 — all", hint: "Constituents ranked by options volume", params: { is_s_p_500: true, limit: 500 } },
];

/** Option-contract screener presets (`/api/screener/option-contracts`, "Hottest Chains"). */
export const CONTRACT_PRESETS: Preset[] = [
  { id: "hottest", label: "Hottest chains", hint: "Top contracts by volume", params: { min_volume: 5_000 } },
  { id: "vol-oi", label: "Volume ≫ OI", hint: "Volume > OI, ≥ $250k premium", params: { vol_greater_oi: true, min_premium: 250_000 } },
  { id: "0dte", label: "0DTE movers", hint: "Expiring today, ≥ 10k volume", params: { max_dte: 0, min_volume: 10_000 } },
  { id: "cheap-otm", label: "Cheap OTM lottos", hint: "OTM, avg price ≤ $0.50, ≥ 5k volume", params: { is_otm: true, max_avg_price: 0.5, min_volume: 5_000 } },
  { id: "oi-build", label: "OI building 3+ days", hint: "Open interest up ≥ 3 straight days", params: { min_days_of_oi_increases: 3, min_open_interest: 1_000 } },
  { id: "sweepy", label: "Sweep heavy", hint: "≥ 50% of volume from sweeps", params: { min_sweep_volume_ratio: 0.5, min_volume: 2_000 } },
  { id: "unusual", label: "UW unusual", hint: "UW's unusual-contract expression", params: { unusual: true } },
];

/** Endpoints that make sense to run across a watchlist (one row per ticker). */
export const SCAN_TARGETS: Array<{ path: string; label: string; cols: string[]; params?: Params }> = [
  { path: "/api/stock/{ticker}/gex-levels", label: "GEX levels (walls, flip, magnet)", cols: ["ticker", "call_wall", "put_wall", "gamma_flip", "gamma_magnet", "time"] },
  { path: "/api/stock/{ticker}/iv-rank", label: "IV rank", cols: ["ticker", "iv_rank_1y", "volatility", "close", "date"] },
  { path: "/api/stock/{ticker}/stock-state", label: "Price / volume", cols: ["ticker", "close", "prev_close", "open", "high", "low", "total_volume"] },
  { path: "/api/stock/{ticker}/max-pain", label: "Max pain (nearest expiry)", cols: ["ticker", "expiry", "max_pain"] },
  { path: "/api/stock/{ticker}/nope", label: "NOPE (latest)", cols: ["ticker", "nope", "nope_fill", "call_vol", "put_vol", "timestamp"] },
  { path: "/api/stock/{ticker}/options-volume", label: "Options volume & premium", cols: ["ticker", "call_volume", "put_volume", "call_premium", "put_premium", "net_call_premium", "net_put_premium", "bullish_premium", "bearish_premium"] },
  { path: "/api/stock/{ticker}/spot-exposures", label: "GEX per 1% move (latest)", cols: ["ticker", "price", "gamma_per_one_percent_move_oi", "gamma_per_one_percent_move_vol", "gamma_per_one_percent_move_dir", "time"] },
  { path: "/api/shorts/{ticker}/interest-float/v2", label: "Short interest", cols: [] },
  { path: "/api/stock/{ticker}/volatility/stats", label: "Volatility stats", cols: [] },
  { path: "/api/stock/{ticker}/info", label: "Company info", cols: ["ticker", "full_name", "sector", "marketcap", "next_earnings_date", "beta", "avg30_volume"] },
  { path: "/api/stock/{ticker}/unusualness", label: "Volume unusualness", cols: [] },
  { path: "/api/stock/{ticker}/insider-buy-sells", label: "Insider buys/sells", cols: [] },
];

"use client";

import { useMemo, useState } from "react";
import { useUw } from "../../../lib/uw/api";
import { num, toRows } from "../../../lib/uw/format";
import { useTerminal } from "../../../store/terminal";
import { COLORS, SimpleBars } from "../charts";
import { EndpointTable, ErrorNote, ExplorerLink, Panel, Segmented } from "../ui";

const PRINT_COLS = ["executed_at", "ticker", "price", "size", "premium", "nbbo_bid", "nbbo_ask", "market_center", "trade_settlement", "ext_hour_sold_codes", "canceled"];

export default function DarkPool() {
  const ticker = useTerminal((s) => s.activeSymbol).replace(/^\^/, "");
  const [minPrem, setMinPrem] = useState("1000000");
  const [orderBy, setOrderBy] = useState<"executed_at" | "premium" | "size">("executed_at");

  const levels = useUw("/api/darkpool/{ticker}/price-levels", { ticker });
  const levelData = useMemo(
    () =>
      toRows(levels.data)
        .map((r) => ({ price: num(r.price) ?? 0, dark: num(r.dark_pool_volume) ?? 0, lit: num(r.regular_volume) ?? 0 }))
        .sort((a, b) => a.price - b.price),
    [levels.data]
  );

  return (
    <div className="grid gap-1 p-1 grid-cols-12 auto-rows-min">
      <EndpointTable
        className="col-span-12 h-[440px]"
        title="Dark pool prints — market"
        path="/api/darkpool/recent"
        params={{ limit: 200, min_premium: minPrem || undefined, order_by: orderBy, cancellation_status: "hide_cancelled" }}
        live
        columns={PRINT_COLS}
        extra={
          <>
            <select value={minPrem} onChange={(e) => setMinPrem(e.target.value)} className="!py-0">
              <option value="">any size</option>
              <option value="500000">≥ $500K</option>
              <option value="1000000">≥ $1M</option>
              <option value="5000000">≥ $5M</option>
              <option value="25000000">≥ $25M</option>
            </select>
            <Segmented value={orderBy} onChange={setOrderBy} options={[{ value: "executed_at", label: "newest" }, { value: "premium", label: "$" }, { value: "size", label: "size" }]} />
          </>
        }
      />
      <Panel className="col-span-12 xl:col-span-5 h-[400px]" title={`Dark vs lit volume by price · ${ticker}`} right={<ExplorerLink path="/api/darkpool/{ticker}/price-levels" params={{ ticker }} />}>
        <ErrorNote error={levels.error} />
        <SimpleBars data={levelData} x="price" bars={[{ key: "dark", name: "Dark pool", color: "#b388ff" }, { key: "lit", name: "Lit", color: COLORS.AXIS }]} />
      </Panel>
      <EndpointTable className="col-span-12 xl:col-span-7 h-[400px]" title={`Dark pool prints · ${ticker}`} path="/api/darkpool/{ticker}" params={{ ticker, limit: 300 }} live columns={PRINT_COLS.filter((c) => c !== "ticker")} />
      <EndpointTable className="col-span-12 xl:col-span-7 h-[380px]" title="Lit flow — market" path="/api/lit-flow/recent" params={{ limit: 200, min_premium: minPrem || undefined }} live columns={PRINT_COLS} />
      <EndpointTable className="col-span-12 xl:col-span-5 h-[380px]" title={`Off/lit exchange price levels · ${ticker}`} path="/api/stock/{ticker}/stock-volume-price-levels" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-6 h-[320px]" title={`Short volume by exchange · ${ticker}`} path="/api/shorts/{ticker}/volumes-by-exchange" params={{ ticker }} />
      <EndpointTable className="col-span-12 xl:col-span-6 h-[320px]" title={`Failures to deliver · ${ticker}`} path="/api/shorts/{ticker}/ftds" params={{ ticker }} />
    </div>
  );
}

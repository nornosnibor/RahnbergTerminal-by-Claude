"use client";

import { useState } from "react";
import { useTerminal } from "../../../store/terminal";
import { EndpointTable, Panel, Segmented } from "../ui";

type Tab = "congress" | "insiders" | "institutions" | "politicians";

function Institutions() {
  const [name, setName] = useState("");
  const [lookup, setLookup] = useState("");
  return (
    <div className="grid gap-1 grid-cols-12">
      <EndpointTable className="col-span-12 h-[360px]" title="Latest 13F filings" path="/api/institutions/latest_filings" params={{ limit: 200 }} />
      <Panel className="col-span-12" title="Look up an institution" bodyClass="p-1">
        <form
          className="flex gap-2 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setLookup(name.trim());
          }}
        >
          <input className="w-80" placeholder="e.g. VANGUARD GROUP INC, BERKSHIRE HATHAWAY INC, or a CIK" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="term-btn active">▶ load</button>
          <span className="dim text-[10px]">Click a name in “Latest 13F filings” and paste it here.</span>
        </form>
      </Panel>
      {lookup && (
        <>
          <EndpointTable className="col-span-12 xl:col-span-7 h-[420px]" title={`Holdings · ${lookup}`} path="/api/institution/{name}/holdings" params={{ name: lookup, limit: 500 }} sort={{ key: "value", dir: "desc" }} />
          <EndpointTable className="col-span-12 xl:col-span-5 h-[420px]" title={`Sector exposure · ${lookup}`} path="/api/institution/{name}/sectors" params={{ name: lookup }} />
          <EndpointTable className="col-span-12 h-[380px]" title={`Recent activity · ${lookup}`} path="/api/institution/{name}/activity/v2" params={{ name: lookup }} />
        </>
      )}
    </div>
  );
}

export default function SmartMoney() {
  const ticker = useTerminal((s) => s.activeSymbol).replace(/^\^/, "");
  const [tab, setTab] = useState<Tab>("congress");
  return (
    <div className="p-1 flex flex-col gap-1">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "congress", label: "Congress" },
          { value: "insiders", label: "Insiders" },
          { value: "institutions", label: "Institutions (13F)" },
          { value: "politicians", label: "Politician portfolios" },
        ]}
      />
      {tab === "congress" && (
        <div className="grid gap-1 grid-cols-12">
          <EndpointTable
            className="col-span-12 xl:col-span-7 h-[460px]"
            title="Recent congressional trades"
            path="/api/congress/recent-trades"
            params={{ limit: 200 }}
            columns={["transaction_date", "filed_at_date", "name", "member_type", "ticker", "txn_type", "amounts", "issuer", "notes"]}
          />
          <EndpointTable className="col-span-12 xl:col-span-5 h-[460px]" title="Unusual congressional trades" path="/api/congress/unusual-trades" />
          <EndpointTable className="col-span-12 xl:col-span-6 h-[340px]" title="Late reports" path="/api/congress/late-reports" />
          <EndpointTable className="col-span-12 xl:col-span-6 h-[340px]" title={`Congress trades in ${ticker}`} path="/api/congress/recent-trades" params={{ ticker, limit: 200 }} />
        </div>
      )}
      {tab === "insiders" && (
        <div className="grid gap-1 grid-cols-12">
          <EndpointTable
            className="col-span-12 h-[460px]"
            title="Insider transactions — officers & directors, ≥ $100K"
            path="/api/insider/transactions"
            params={{ limit: 200, min_value: 100_000, common_stock_only: true }}
            columns={["transaction_date", "ticker", "owner_name", "officer_title", "transaction_code", "amount", "price", "stock_price", "shares_owned_after", "marketcap", "is_10b5_1", "sector"]}
          />
          <EndpointTable className="col-span-12 xl:col-span-6 h-[340px]" title={`Insider ticker flow · ${ticker}`} path="/api/insider/{ticker}/ticker-flow" params={{ ticker }} />
          <EndpointTable className="col-span-12 xl:col-span-6 h-[340px]" title={`Insider transactions · ${ticker}`} path="/api/insider/transactions" params={{ ticker_symbol: ticker, limit: 200 }} />
        </div>
      )}
      {tab === "institutions" && <Institutions />}
      {tab === "politicians" && (
        <div className="grid gap-1 grid-cols-12">
          <EndpointTable className="col-span-12 xl:col-span-7 h-[460px]" title="Politician trades" path="/api/politician-portfolios/recent_trades" />
          <EndpointTable className="col-span-12 xl:col-span-5 h-[460px]" title={`Politicians holding ${ticker}`} path="/api/politician-portfolios/holders/{ticker}" params={{ ticker }} />
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useTerminal } from "../../store/terminal";
import { cellClass, columnKind, downloadCsv, flattenRow, fmtCell, humanize, type ColKind, type Row } from "../../lib/uw/format";
import { applyTable, columnsOf, type SortState } from "../../lib/uw/table";

type Props = {
  rows: Row[];
  /** Columns shown by default, in order. Everything else is one click away in the column picker. */
  columns?: string[];
  name?: string;
  initialSort?: SortState;
  pageSize?: number;
  onRowClick?: (row: Row) => void;
  rowClass?: (row: Row) => string;
  /** Hide the toolbar (search/filters/CSV) for tiny tables. */
  bare?: boolean;
};

export default function DataTable({ rows: rawRows, columns, name = "uw", initialSort = null, pageSize = 150, onRowClick, rowClass, bare }: Props) {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const rows = useMemo(() => rawRows.map(flattenRow), [rawRows]);
  const allCols = useMemo(() => columnsOf(rows, columns), [rows, columns]);
  const [shown, setShown] = useState<string[] | null>(null);
  const visible = shown ?? (columns?.length ? allCols.filter((c) => columns.includes(c)) : allCols.slice(0, 14));
  const [sort, setSort] = useState<SortState>(initialSort);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [picker, setPicker] = useState(false);
  const [limit, setLimit] = useState(pageSize);

  const kinds = useMemo(() => {
    const k: Record<string, ColKind> = {};
    for (const c of allCols) {
      const sample = rows.find((r) => r[c] !== null && r[c] !== undefined && r[c] !== "")?.[c];
      k[c] = columnKind(c, sample);
    }
    return k;
  }, [rows, allCols]);

  const view = useMemo(() => applyTable(rows, { search, filters, sort }), [rows, search, filters, sort]);
  const activeFilters = Object.values(filters).filter((v) => v.trim()).length;

  const clickSort = (c: string) =>
    setSort((s) => (s?.key === c ? (s.dir === "desc" ? { key: c, dir: "asc" } : null) : { key: c, dir: "desc" }));

  return (
    <div className="flex flex-col min-h-0 h-full">
      {!bare && (
        <div className="flex gap-1.5 items-center px-1 py-1 border-b border-[var(--border)] shrink-0 flex-wrap">
          <input className="w-36" placeholder="search rows…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className={`term-btn ${showFilters ? "active" : ""}`} onClick={() => setShowFilters((v) => !v)} title="Per-column filters: >1m  <0.5  10..20  =call  !put  a|b">
            ⧩ filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          {activeFilters > 0 && (
            <button className="term-btn" onClick={() => setFilters({})}>
              clear
            </button>
          )}
          <div className="relative">
            <button className={`term-btn ${picker ? "active" : ""}`} onClick={() => setPicker((v) => !v)}>
              cols {visible.length}/{allCols.length}
            </button>
            {picker && (
              <div className="absolute z-30 mt-1 bg-[var(--panel-2)] border border-[var(--amber-dim)] max-h-72 overflow-auto w-64 p-1 shadow-xl" onMouseLeave={() => setPicker(false)}>
                <div className="flex gap-1 mb-1">
                  <button className="term-btn" onClick={() => setShown(allCols)}>all</button>
                  <button className="term-btn" onClick={() => setShown(null)}>default</button>
                </div>
                {allCols.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 px-1 py-0.5 hover:bg-[#1a1a1a] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visible.includes(c)}
                      onChange={(e) => setShown(e.target.checked ? allCols.filter((x) => x === c || visible.includes(x)) : visible.filter((x) => x !== c))}
                    />
                    <span className="truncate">{humanize(c)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="term-btn" onClick={() => downloadCsv(name, view, visible)} disabled={!view.length}>
            ⤓ csv
          </button>
          <span className="dim ml-auto text-[10px]">
            {view.length === rows.length ? `${rows.length} rows` : `${view.length} / ${rows.length} rows`}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="data-table uw-table">
          <thead className="sticky top-0 bg-[var(--panel)] z-10">
            <tr>
              {visible.map((c) => (
                <th key={c} onClick={() => clickSort(c)} className={sort?.key === c ? "!text-[var(--amber)]" : ""} title={c}>
                  {humanize(c)} {sort?.key === c ? (sort.dir === "desc" ? "▼" : "▲") : ""}
                </th>
              ))}
            </tr>
            {showFilters && (
              <tr>
                {visible.map((c) => (
                  <th key={c} className="!p-0.5">
                    <input
                      className="w-full min-w-12 !text-[10px] !py-0"
                      placeholder={kinds[c] === "text" || kinds[c] === "ticker" || kinds[c] === "side" ? "text" : ">0"}
                      value={filters[c] ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setFilters((f) => ({ ...f, [c]: e.target.value }))}
                    />
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {view.slice(0, limit).map((r, i) => (
              <tr key={i} onClick={() => onRowClick?.(r)} className={rowClass?.(r) ?? ""}>
                {visible.map((c) => {
                  const kind = kinds[c];
                  const v = r[c];
                  return (
                    <td
                      key={c}
                      className={`${cellClass(c, v, kind)} ${kind === "text" ? "!text-left max-w-72 truncate" : ""}`}
                      title={typeof v === "string" && v.length > 30 ? v : undefined}
                      onClick={
                        kind === "ticker" && typeof v === "string"
                          ? (e) => {
                              e.stopPropagation();
                              setActiveSymbol(v);
                            }
                          : undefined
                      }
                    >
                      {fmtCell(c, v, kind)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {view.length > limit && (
          <button className="term-btn w-full mt-1" onClick={() => setLimit((l) => l + pageSize)}>
            show {Math.min(pageSize, view.length - limit)} more ({view.length - limit} hidden)
          </button>
        )}
        {rows.length === 0 && <div className="p-3 dim text-center">No rows returned.</div>}
      </div>
    </div>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useApi, useDebounced } from "../lib/hooks";
import { ISearch } from "./icons";
import { ErrorNote, Loading } from "./ui";
import { PeriodPicker, periodQuery } from "./PeriodPicker";
import { ExportMenu } from "./ExportMenu";

export type Col = { key: string; label: string; render: (r: any) => ReactNode; className?: string };

export function Ledger({ endpoint, exportPath, cols, rowHref, filters, empty, extraParams = "", sumsLabel }: {
  endpoint: string; exportPath: string; cols: Col[]; rowHref: (r: any) => string; filters?: (set: (k: string, v: string) => void, vals: Record<string, string>) => ReactNode;
  empty: ReactNode; extraParams?: string; sumsLabel: (s: any) => ReactNode;
}) {
  const { meta } = useAuth();
  const nav = useNavigate();
  const [period, setPeriod] = useState(meta?.current_period || "all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const qs = useMemo(() => {
    const p = [periodQuery(period, from, to), dq && `q=${encodeURIComponent(dq)}`, ...Object.entries(vals).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`), extraParams, `page=${page}`].filter(Boolean);
    return p.join("&");
  }, [period, from, to, dq, vals, page, extraParams]);
  const { data, error, loading, reload } = useApi<any>(`${endpoint}?${qs}`, [qs]);
  const set = (k: string, v: string) => { setVals((x) => ({ ...x, [k]: v })); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  const exportQs = [periodQuery(period, from, to)].filter(Boolean).join("&");

  return (
    <>
      <div className="toolbar">
        <PeriodPicker value={period} onChange={(v) => { setPeriod(v); setPage(1); }} />
        {period === "range" && (
          <>
            <div className="field"><label htmlFor="f-from">From</label><input id="f-from" type="date" className="input boxed" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="field"><label htmlFor="f-to">To</label><input id="f-to" type="date" className="input boxed" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </>
        )}
        {filters?.(set, vals)}
        <div className="field grow">
          <label htmlFor="f-q">Search</label>
          <div className="search"><ISearch /><input id="f-q" className="input boxed" placeholder="Number, name or GSTIN" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        </div>
      </div>
      {error ? <ErrorNote error={error} retry={reload} /> : !data ? <Loading /> : (
        <div className="sheet">
          <div className="sheet-head">
            <div className="small">{sumsLabel(data)}</div>
            <ExportMenu path={`${exportPath}${exportQs ? `?${exportQs}` : ""}`} name="export" />
          </div>
          {data.rows.length === 0 ? <div className="empty">{empty}</div> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="ruled cards">
                <thead><tr>{cols.map((c) => <th key={c.key} className={c.className} scope="col">{c.label}</th>)}</tr></thead>
                <tbody>
                  {data.rows.map((r: any) => (
                    <tr key={r.id} className={`clickable ${r.status !== "active" ? "cancelled" : ""}`} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) nav(rowHref(r)); }}>
                      {cols.map((c) => <td key={c.key} className={c.className}>{c.render(r)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="sheet-foot">
              <span className="small muted">Page {page} of {pages} · {data.total} entries</span>
              <div className="btn-row">
                <button className="btn quiet small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
                <button className="btn quiet small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

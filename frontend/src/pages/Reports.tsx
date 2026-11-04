import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { amount, date } from "../lib/format";
import { useApi, useTitle } from "../lib/hooks";
import { ExportMenu } from "../components/ExportMenu";
import { PeriodPicker, periodQuery } from "../components/PeriodPicker";
import { ErrorNote, Loading } from "../components/ui";

const ABOUT: Record<string, string> = {
  sales: "Every sale bill and note, with tax split and GSTR-1 section.",
  purchases: "Every supplier bill with GST paid, credit and GSTR-2B status.",
  gst_collected: "GST charged on sales, month by month.",
  gst_paid: "GST paid on purchases, month by month.",
  output_liability: "Tax payable on sales by month and rate.",
  itc: "Credit you can claim and credit you cannot, by month.",
  itc_recon: "Your purchase bills matched against GSTR-2B.",
  hsn: "Sales by HSN/SAC code: quantity, value and tax.",
  rate_wise: "Sales and purchases grouped by GST rate.",
  gstr1: "GSTR-1 sections for each period.",
  gstr3b: "GSTR-3B tables for each period.",
  net_payable: "Tax on sales less credit, and the cash to pay.",
};

export function Reports() {
  useTitle("Reports");
  const { meta } = useAuth();
  const [sp, setSp] = useSearchParams();
  const kind = sp.get("r") || "sales";
  const [period, setPeriod] = useState(meta?.current_period || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = useApi<any[]>("/reports");
  const q = periodQuery(period, from, to) || `fy=${meta?.current_fy}`;
  const rep = useApi<any>(`/reports/${kind}?${q}`, [kind, q]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">Reports</h1>
          <p className="lede muted">Twelve GST reports for any month, quarter, year or dates you pick. Download them for your accountant as Excel, PDF, CSV or JSON.</p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 260px) minmax(0, 1fr)", gap: 24 }} className="reports-grid">
        <nav aria-label="Reports" className="sheet" style={{ alignSelf: "start" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 8 }}>
            {list.data?.map((r) => (
              <li key={r.key}>
                <button className="nav-link" aria-current={kind === r.key ? "page" : undefined} onClick={() => setSp({ r: r.key }, { replace: true })}
                  style={{ width: "100%", background: kind === r.key ? "var(--ink)" : "none", color: kind === r.key ? "#fff" : "var(--ink)", border: 0, cursor: "pointer", textAlign: "left", boxShadow: kind === r.key ? "4px 4px 0 var(--carbon)" : "none" }}>
                  {r.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section aria-live="polite" style={{ minWidth: 0 }}>
          <div className="toolbar">
            <PeriodPicker value={period} onChange={setPeriod} allowAll={false} />
            {period === "range" && (
              <>
                <div className="field"><label htmlFor="r-from">From</label><input id="r-from" type="date" className="input boxed" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div className="field"><label htmlFor="r-to">To</label><input id="r-to" type="date" className="input boxed" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              </>
            )}
          </div>
          {rep.error ? <ErrorNote error={rep.error} /> : !rep.data ? <Loading /> : (
            <div className="sheet">
              <div className="sheet-head">
                <div><h2 className="h2">{rep.data.title}</h2><p className="small muted" style={{ margin: "4px 0 0" }}>{ABOUT[kind]}</p></div>
                <ExportMenu path={`/reports/${kind}/export?${q}`} name={kind} />
              </div>
              {rep.data.rows.length === 0 ? <div className="empty"><h3 className="h2">Nothing in this period</h3><p>Pick another month or the whole year.</p></div> : (
                <div className="table-wrap" tabIndex={0} role="region" aria-label="Table" style={{ maxHeight: "70vh", opacity: rep.loading ? 0.6 : 1 }}>
                  <table className="ruled">
                    <thead><tr>{rep.data.columns.map((c: any) => <th key={c.key} scope="col" className={c.type === "money" || c.type === "number" ? "num" : ""}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {rep.data.rows.map((r: any, i: number) => (
                        <tr key={i}>{rep.data.columns.map((c: any) => <td key={c.key} className={c.type === "money" || c.type === "number" ? "num" : ""}>{fmt(r[c.key], c.type)}</td>)}</tr>
                      ))}
                    </tbody>
                    {rep.data.totals && (
                      <tfoot><tr>{rep.data.columns.map((c: any, i: number) => <td key={c.key} className={c.type === "money" ? "num" : ""}>{i === 0 ? "Total" : rep.data.totals[c.key] !== undefined ? fmt(rep.data.totals[c.key], c.type) : ""}</td>)}</tr></tfoot>
                    )}
                  </table>
                </div>
              )}
              {rep.data.extra?.ineligible_reasons?.length > 0 && (
                <div className="sheet-foot" style={{ display: "block" }}>
                  <div className="small strong">Why some credit is not claimed</div>
                  <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{rep.data.extra.ineligible_reasons.map((x: any) => <li key={x.reason}>{x.reason}: ₹{amount(x.amount)}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      <style>{`@media (max-width: 860px) { .reports-grid { grid-template-columns: 1fr !important; } .reports-grid nav ul { display: flex; overflow-x: auto; gap: 4px; } .reports-grid nav li { flex: none; } }`}</style>
    </div>
  );
}

function fmt(v: any, t?: string) {
  if (v === null || v === undefined || v === "") return "";
  if (t === "money") return amount(v);
  if (t === "date") return date(String(v));
  return String(v);
}

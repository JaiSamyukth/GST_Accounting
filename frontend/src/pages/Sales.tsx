import { Link } from "react-router-dom";
import { DOC_LABEL, SECTION_LABEL, date } from "../lib/format";
import { useTitle } from "../lib/hooks";
import { IClip, IPlus } from "../components/icons";
import { Ledger } from "../components/Ledger";
import { Money, StatusTag, Term } from "../components/ui";

export function SalesList() {
  useTitle("Sales");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">Sales</h1>
          <p className="lede muted">Every bill given to a customer, with credit and debit notes. Open one to see or correct it.</p>
        </div>
        <div className="btn-row">
          <Link className="btn quiet" to="/sales/new?type=credit_note">Credit or debit note</Link>
          <Link className="btn primary" to="/sales/new"><IPlus />New sale bill</Link>
        </div>
      </div>
      <Ledger
        endpoint="/sales" exportPath="/sales/export" rowHref={(r) => `/sales/${r.id}`}
        sumsLabel={(d) => <>{d.total} entries · taxable <Money v={d.sums.taxable_value} /> · GST <Money v={d.sums.tax} /> · billed <b><Money v={d.sums.total} /></b></>}
        filters={(set, v) => (
          <>
            <div className="field">
              <label htmlFor="f-t">Type</label>
              <select id="f-t" className="select boxed" value={v.doc_type || ""} onChange={(e) => set("doc_type", e.target.value)}>
                <option value="">All types</option><option value="invoice">Invoices</option><option value="credit_note">Credit notes</option><option value="debit_note">Debit notes</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-s">Customer</label>
              <select id="f-s" className="select boxed" value={v.section || ""} onChange={(e) => set("section", e.target.value)}>
                <option value="">Everyone</option><option value="b2b">With GSTIN (B2B)</option><option value="b2c">Without GSTIN (B2C)</option>
              </select>
            </div>
          </>
        )}
        cols={[
          { key: "date", label: "Date", className: "hide-sm", render: (r) => date(r.date) },
          { key: "no", label: "Number", className: "cell-main", render: (r) => <><Link className="rowlink" to={`/sales/${r.id}`}>{r.number.replace(/~A$/, "")}</Link>{r.doc_type !== "invoice" && <> <span className="tag">{DOC_LABEL[r.doc_type]}</span></>}{r.status !== "active" && <> <StatusTag s={r.status} /></>}{r.attachments > 0 && <IClip width={14} height={14} style={{ display: "inline", marginLeft: 6 }} aria-label="Has attachment" />}<div className="small muted" style={{ display: "none" }} /></> },
          { key: "party", label: "Customer", className: "cell-main", render: (r) => <><span>{r.party_name}</span><div className="tiny muted">{date(r.date)}{r.party_gstin ? ` · ${r.party_gstin}` : ""}</div></> },
          { key: "sec", label: "Return section", className: "hide-sm", render: (r) => <Term k={r.section === "b2b" || r.section === "cdnr" ? "b2b" : r.section === "b2cl" ? "b2cl" : "b2c"}>{SECTION_LABEL[r.section] || r.section}</Term> },
          { key: "tax", label: "GST", className: "num hide-sm", render: (r) => <Money v={Number(r.cgst) + Number(r.sgst) + Number(r.igst) + Number(r.cess)} /> },
          { key: "total", label: "Total", className: "num cell-amt", render: (r) => <Money v={r.doc_type === "credit_note" ? -r.total : r.total} /> },
        ]}
        empty={<><h2 className="h2">No sales in this period</h2><p>Write the first bill from your order book. It takes a minute.</p><Link className="btn primary" to="/sales/new"><IPlus />New sale bill</Link></>}
      />
    </div>
  );
}

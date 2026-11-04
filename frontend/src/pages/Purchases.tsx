import { Link } from "react-router-dom";
import { DOC_LABEL, date } from "../lib/format";
import { useTitle } from "../lib/hooks";
import { IClip, IPlus } from "../components/icons";
import { Ledger } from "../components/Ledger";
import { Money, StatusTag } from "../components/ui";

export const CATEGORY: Record<string, string> = { inputs: "Goods for catering", input_services: "Services", capital_goods: "Equipment (capital goods)", expense: "Other expense (no credit)" };

export function PurchaseList() {
  useTitle("Purchases");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">Purchases</h1>
          <p className="lede muted">Supplier bills, with the GST you paid and whether it can be claimed as credit.</p>
        </div>
        <Link className="btn primary" to="/purchases/new"><IPlus />New purchase bill</Link>
      </div>
      <Ledger
        endpoint="/purchases" exportPath="/purchases/export" rowHref={(r) => `/purchases/${r.id}`}
        sumsLabel={(d) => <>{d.total} bills · GST paid <Money v={d.sums.tax} /> · total <b><Money v={d.sums.total} /></b></>}
        filters={(set, v) => (
          <div className="field">
            <label htmlFor="f-r">GSTR-2B check</label>
            <select id="f-r" className="select boxed" value={v.recon || ""} onChange={(e) => set("recon", e.target.value)}>
              <option value="">All bills</option><option value="matched">Matched</option><option value="mismatch">Amounts differ</option><option value="missing_in_2b">Not in GSTR-2B</option><option value="pending">Not checked</option>
            </select>
          </div>
        )}
        cols={[
          { key: "date", label: "Date", className: "hide-sm", render: (r) => date(r.date) },
          { key: "sup", label: "Supplier", className: "cell-main", render: (r) => <><Link className="rowlink" to={`/purchases/${r.id}`}>{r.supplier_name}</Link>{r.attachments > 0 && <IClip width={14} height={14} style={{ display: "inline", marginLeft: 6 }} aria-label="Has attachment" />}<div className="tiny muted">Bill {r.number} · {date(r.date)}</div></> },
          { key: "cat", label: "Type", className: "hide-sm", render: (r) => <>{CATEGORY[r.category]}{r.doc_type !== "invoice" && <> <span className="tag">{DOC_LABEL[r.doc_type]}</span></>}{r.status !== "active" && <> <StatusTag s={r.status} /></>}</> },
          { key: "2b", label: "GSTR-2B", className: "hide-sm", render: (r) => <StatusTag s={r.recon_status} /> },
          { key: "tax", label: "GST paid", className: "num hide-sm", render: (r) => <Money v={Number(r.cgst) + Number(r.sgst) + Number(r.igst) + Number(r.cess)} /> },
          { key: "itc", label: "Credit", className: "num hide-sm", render: (r) => <Money v={r.itc_eligible_amount} /> },
          { key: "total", label: "Total", className: "num cell-amt", render: (r) => <Money v={r.total} /> },
        ]}
        empty={<><h2 className="h2">No purchase bills in this period</h2><p>Enter a supplier bill, or import a month of bills from Excel.</p><div className="btn-row" style={{ justifyContent: "center" }}><Link className="btn primary" to="/purchases/new"><IPlus />New purchase bill</Link><Link className="btn quiet" to="/import">Import from Excel</Link></div></>}
      />
    </div>
  );
}

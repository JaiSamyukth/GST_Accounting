"use client";

import Link from "next/link";
import { useState } from "react";
import { emptyFilters, ListFilters, Pager, type Filters } from "@/components/list-filters";
import { useApp } from "@/components/shell";
import { DOC_LABEL, Err, Field, Loading, Money, qs, useLoad } from "@/components/ui";

interface Row { id: number; docType: string; number: string; date: string; supplierName: string; supplierGstin: string; itcPeriod: string; taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; itcTotal: number; grandTotal: number; status: string }
interface List { rows: Row[]; total: number; page: number; pageSize: number; totals: { taxableValue: number; tax: number; itc: number; grandTotal: number } }

export default function PurchasesPage() {
  const { meta } = useApp();
  const [f, setF] = useState<Filters & { itc: string }>({ ...emptyFilters(meta.currentPeriod), itc: "" });
  const query = qs({ period: f.period, from: f.period ? "" : f.from, to: f.period ? "" : f.to, q: f.q, docType: f.docType, status: f.status, itc: f.itc, page: f.page });
  const { data, error } = useLoad<List>(`/api/purchases${query}`);
  const exportQ = qs({ period: f.period, from: f.period ? "" : f.from, to: f.period ? "" : f.to });

  return (
    <>
      <h1>Purchases</h1>
      <div className="actions"><Link className="button primary big" href="/purchases/new">New purchase bill</Link></div>
      <ListFilters f={f} set={(x) => setF({ ...f, ...x })} periods={meta.periods} extra={
        <Field label="ITC">
          <select value={f.itc} onChange={(e) => setF({ ...f, itc: e.target.value, page: 1 })}>
            <option value="">All</option><option value="eligible">Has ITC</option><option value="ineligible">Has ineligible lines</option>
          </select>
        </Field>
      } />
      <Err error={error} />
      {!data ? <Loading /> : data.rows.length === 0 ? <p className="muted">No bills for this selection.</p> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Bill no.</th><th>Type</th><th>Supplier</th><th>ITC period</th><th className="num">Taxable</th><th className="num">Tax</th><th className="num">ITC</th><th className="num">Total</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={r.status === "cancelled" ? "cancelled" : undefined}>
                  <td>{r.date}</td>
                  <td><Link href={`/purchases/${r.id}`}>{r.number}</Link></td>
                  <td>{DOC_LABEL[r.docType]}{r.status === "cancelled" ? " (cancelled)" : ""}</td>
                  <td>{r.supplierName}{r.supplierGstin ? <><br /><small>{r.supplierGstin}</small></> : null}</td>
                  <td>{r.itcPeriod}</td>
                  <td className="num"><Money p={r.taxableValue} /></td>
                  <td className="num"><Money p={r.cgst + r.sgst + r.igst + r.cess} /></td>
                  <td className="num"><Money p={r.itcTotal} /></td>
                  <td className="num"><Money p={r.grandTotal} /></td>
                </tr>
              ))}
              <tr className="total"><td colSpan={5}>{data.total} bill(s); totals exclude cancelled</td>
                <td className="num"><Money p={data.totals.taxableValue} /></td><td className="num"><Money p={data.totals.tax} /></td><td className="num"><Money p={data.totals.itc} /></td><td className="num"><Money p={data.totals.grandTotal} /></td></tr>
            </tbody>
          </table></div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} go={(p) => setF({ ...f, page: p })} />
        </>
      )}
      <p className="muted">Download this list: {["pdf", "xlsx", "csv", "json"].map((fmt) => <span key={fmt}><a href={`/api/purchases/export${exportQ}${exportQ ? "&" : "?"}fmt=${fmt}`}>{fmt.toUpperCase()}</a>{" "}</span>)}</p>
    </>
  );
}

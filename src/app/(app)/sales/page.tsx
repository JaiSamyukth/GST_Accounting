"use client";

import Link from "next/link";
import { useState } from "react";
import { emptyFilters, ListFilters, Pager, type Filters } from "@/components/list-filters";
import { useApp } from "@/components/shell";
import { DOC_LABEL, Err, Field, Loading, Money, qs, useLoad } from "@/components/ui";

interface Row { id: number; docType: string; number: string; date: string; partyName: string; partyGstin: string; section: string; taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; grandTotal: number; status: string }
interface List { rows: Row[]; total: number; page: number; pageSize: number; totals: { taxableValue: number; tax: number; grandTotal: number } }

export default function SalesPage() {
  const { meta } = useApp();
  const [f, setF] = useState<Filters & { section: string }>({ ...emptyFilters(meta.currentPeriod), section: "" });
  const query = qs({ period: f.period, from: f.period ? "" : f.from, to: f.period ? "" : f.to, q: f.q, docType: f.docType, status: f.status, section: f.section, page: f.page });
  const { data, error } = useLoad<List>(`/api/sales${query}`);
  const exportQ = qs({ period: f.period, from: f.period ? "" : f.from, to: f.period ? "" : f.to });

  return (
    <>
      <h1>Sales</h1>
      <div className="actions">
        <Link className="button primary" href="/sales/new">New invoice</Link>
        <Link className="button" href="/sales/new?type=credit_note">New credit note</Link>
        <Link className="button" href="/sales/new?type=debit_note">New debit note</Link>
      </div>
      <ListFilters f={f} set={(x) => setF({ ...f, ...x })} periods={meta.periods} extra={
        <Field label="Section">
          <select value={f.section} onChange={(e) => setF({ ...f, section: e.target.value, page: 1 })}>
            <option value="">All</option>{["b2b", "b2cl", "b2cs", "exp", "cdnr", "cdnur"].map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        </Field>
      } />
      <Err error={error} />
      {!data ? <Loading /> : data.rows.length === 0 ? <p className="muted">No sales for this selection.</p> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Number</th><th>Type</th><th>Customer</th><th>Section</th><th className="num">Taxable</th><th className="num">Tax</th><th className="num">Total</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={r.status === "cancelled" ? "cancelled" : undefined}>
                  <td>{r.date}</td>
                  <td><Link href={`/sales/${r.id}`}>{r.number}</Link></td>
                  <td>{DOC_LABEL[r.docType]}{r.status === "cancelled" ? " (cancelled)" : ""}</td>
                  <td>{r.partyName}{r.partyGstin ? <><br /><small>{r.partyGstin}</small></> : null}</td>
                  <td>{r.section.toUpperCase()}</td>
                  <td className="num"><Money p={r.taxableValue} /></td>
                  <td className="num"><Money p={r.cgst + r.sgst + r.igst + r.cess} /></td>
                  <td className="num"><Money p={r.grandTotal} /></td>
                </tr>
              ))}
              <tr className="total"><td colSpan={5}>{data.total} document(s); totals exclude cancelled, credit notes subtracted</td>
                <td className="num"><Money p={data.totals.taxableValue} /></td><td className="num"><Money p={data.totals.tax} /></td><td className="num"><Money p={data.totals.grandTotal} /></td></tr>
            </tbody>
          </table></div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} go={(p) => setF({ ...f, page: p })} />
        </>
      )}
      <p>Download: {["pdf", "xlsx", "csv", "json"].map((fmt) => <span key={fmt}><a href={`/api/sales/export${exportQ}${exportQ ? "&" : "?"}fmt=${fmt}`}>{fmt.toUpperCase()}</a>{" "}</span>)}</p>
    </>
  );
}

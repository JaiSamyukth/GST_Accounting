"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { api, errorText } from "./api";
import { Err, Money, Ok, useLoad } from "./ui";

interface Doc { id: number; supplierGstin: string; supplierName: string; number: string; date: string; taxableValue: number; igst: number; cgst: number; sgst: number; cess: number }
interface Row { status: string; book: Doc | null; twoB: Doc | null; diff: { taxableValue: number; igst: number; cgst: number; sgst: number; cess: number } | null; note: string }
interface Recon { hasEntries: boolean; entries: number; rows: Row[]; summary: Record<string, number> }

const LABEL: Record<string, string> = {
  matched: "Matched", mismatch: "Amounts differ", probable: "Probable match", missing_in_2b: "Not in 2B (ITC deferred)", missing_in_books: "Not in purchases",
};
const tax = (d: Doc) => d.igst + d.cgst + d.sgst + d.cess;

export function Gstr2bSection({ period, locked, onChange }: { period: string; locked: boolean; onChange: () => void }) {
  const { data, error, reload } = useLoad<Recon>(`/api/itc/recon/${period}`);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr("Choose the GSTR-2B file first");
    const form = new FormData();
    form.set("period", period);
    form.set("file", file);
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const r = await api<{ imported: number; skipped: number }>("/api/itc/gstr2b", { form });
      setOk(`Loaded ${r.imported} GSTR-2B row(s)${r.skipped ? `, skipped ${r.skipped} incomplete` : ""}.`);
      if (fileRef.current) fileRef.current.value = "";
      reload();
      onChange();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="muted">Download GSTR-2B for this period from the GST portal (Returns → GSTR-2B → Download JSON) and load it here. Bills that are not in 2B have their ITC held back until they appear.</p>
      <Err error={error || err} />
      <Ok message={ok} />
      {!locked ? (
        <div className="filters">
          <div className="field"><label>GSTR-2B file (portal JSON or ZIP, or CSV/XLSX){" "}<input ref={fileRef} type="file" accept=".json,.zip,.csv,.xlsx" /></label></div>
          <button onClick={upload} disabled={busy}>{busy ? "Loading…" : data?.hasEntries ? "Replace GSTR-2B" : "Load GSTR-2B"}</button>
        </div>
      ) : null}
      {data && !data.hasEntries ? <p>No GSTR-2B loaded for this period. ITC is claimed as per your purchase entries.</p> : null}
      {data && data.hasEntries ? (
        <>
          <p>{data.entries} row(s) in GSTR-2B. {Object.entries(data.summary).filter(([, n]) => n).map(([k, n]) => `${LABEL[k]}: ${n}`).join(" · ")}</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Status</th><th>Supplier</th><th>Bill</th><th>Date</th><th className="num">Taxable (books)</th><th className="num">Taxable (2B)</th><th className="num">Tax (books)</th><th className="num">Tax (2B)</th><th>Note</th></tr></thead>
            <tbody>{data.rows.map((r, i) => {
              const d = r.book ?? r.twoB!;
              return (
                <tr key={i}>
                  <td>{LABEL[r.status]}</td>
                  <td>{d.supplierName}<br /><small>{d.supplierGstin}</small></td>
                  <td>{r.book ? <Link href={`/purchases/${r.book.id}`}>{r.book.number}</Link> : r.twoB?.number}{r.book && r.twoB && r.twoB.number !== r.book.number ? <><br /><small>2B: {r.twoB.number}</small></> : null}</td>
                  <td>{d.date}</td>
                  <td className="num">{r.book ? <Money p={r.book.taxableValue} /> : ""}</td>
                  <td className="num">{r.twoB ? <Money p={r.twoB.taxableValue} /> : ""}</td>
                  <td className="num">{r.book ? <Money p={tax(r.book)} /> : ""}</td>
                  <td className="num">{r.twoB ? <Money p={tax(r.twoB)} /> : ""}</td>
                  <td>{r.note}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <p className="muted">To claim a deferred bill in a later month, open it and change &quot;Claim ITC in period&quot;.</p>
        </>
      ) : null}
    </>
  );
}

"use client";

import Link from "next/link";
import { use, useState } from "react";
import { api, errorText } from "@/components/api";
import { Attachments } from "@/components/attachments";
import { DataTable } from "@/components/data-table";
import { Gstr2bSection } from "@/components/gstr2b-section";
import { useApp } from "@/components/shell";
import { Err, Field, Loading, Money, Ok, rupeesInput, useLoad } from "@/components/ui";
import { gstr1Tables, gstr3bTables } from "@/lib/export/return-tables";
import type { Gstr1Result, Gstr3bResult } from "@/lib/gst/returns";

interface Status {
  period: string; gstr1Status: string; gstr3bStatus: string; gstr1Arn: string; gstr3bArn: string; gstr1FiledOn: string | null; gstr3bFiledOn: string | null;
  locked: boolean; paidIgst: number; paidCgst: number; paidSgst: number; paidCess: number; interest: number; lateFee: number; challanRef: string; paidOn: string | null; notes: string;
}
interface Overview {
  range: { label: string; from: string; to: string }; due: { gstr1: string; gstr3b: string }; status: Status; fromSnapshot: boolean;
  compare: Array<{ head: string; gstr1: number; gstr3b: number; difference: number }>; issues: string[];
  gstr3b: { payment: { cash: { igst: number; cgst: number; sgst: number; cess: number } } };
}
interface Adj { id: number; kind: string; rule: string; igst: number; cgst: number; sgst: number; cess: number; note: string }

export default function ReturnWorkspace({ params }: { params: Promise<{ period: string }> }) {
  const { period } = use(params);
  const { me, meta } = useApp();
  const ov = useLoad<Overview>(`/api/returns/${period}`);
  const g1 = useLoad<Gstr1Result>(`/api/returns/${period}/gstr1`);
  const g3 = useLoad<Gstr3bResult>(`/api/returns/${period}/gstr3b`);
  const adj = useLoad<{ adjustments: Adj[] }>(`/api/itc/adjustments?period=${period}`);
  const [tab, setTab] = useState<"gstr1" | "gstr3b">("gstr1");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [arn, setArn] = useState({ gstr1: "", gstr3b: "", date: meta.today });
  const [pay, setPay] = useState<Record<string, string> | null>(null);
  const [newAdj, setNewAdj] = useState({ kind: "reversal", rule: "rule_42", igst: "", cgst: "", sgst: "", cess: "", note: "" });

  const reloadAll = () => { ov.reload(); g1.reload(); g3.reload(); adj.reload(); };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    setOk(null);
    try {
      await fn();
      setOk(msg);
      reloadAll();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (ov.error) return <Err error={ov.error} />;
  if (!ov.data) return <Loading />;
  const o = ov.data;
  const s = o.status;
  const owner = me.role === "owner";
  const payForm = pay ?? {
    paidIgst: rupeesInput(s.paidIgst), paidCgst: rupeesInput(s.paidCgst), paidSgst: rupeesInput(s.paidSgst), paidCess: rupeesInput(s.paidCess),
    interest: rupeesInput(s.interest), lateFee: rupeesInput(s.lateFee), challanRef: s.challanRef, paidOn: s.paidOn ?? "",
  };
  const cash = o.gstr3b.payment.cash;

  const filed1 = s.gstr1Status === "filed";
  const filed3 = s.gstr3bStatus === "filed";
  const approved = s.gstr1Status !== "open" && s.gstr3bStatus !== "open";
  const differs = o.compare.some((c) => c.difference !== 0);
  const checked = !o.issues.length && !differs;
  const totalCash = cash.igst + cash.cgst + cash.sgst + cash.cess;
  const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const dl = (file: string) => `/api/returns/${period}/${file}`;

  return (
    <>
      <h1>Returns for {o.range.label}</h1>
      <p>GSTR-1 due by <b>{fmt(o.due.gstr1)}</b> · GSTR-3B due by <b>{fmt(o.due.gstr3b)}</b> · <Link href="/returns">Other months</Link></p>
      {s.locked ? <div className="ok">This month is <b>filed and locked</b>{o.fromSnapshot ? "; the figures shown are the ones that were filed" : ""}. To correct a sale, open it and use Amend.</div> : null}
      <Err error={error} />
      <Ok message={ok} />

      <section className={`step${checked ? " done" : ""}`}>
        <h2>1. Check</h2>
        {o.issues.length ? o.issues.map((i) => <div key={i} className="notice">{i}</div>) : <p>No problems found.</p>}
        <p>You will pay about <b>₹ <Money p={totalCash} /></b> in cash for this month (IGST <Money p={cash.igst} />, CGST <Money p={cash.cgst} />, SGST <Money p={cash.sgst} />{cash.cess ? <>, cess <Money p={cash.cess} /></> : null}).</p>
        {differs ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Head</th><th className="num">GSTR-1</th><th className="num">GSTR-3B</th><th className="num">Difference</th></tr></thead>
            <tbody>{o.compare.map((c) => <tr key={c.head}><td>{c.head}</td><td className="num"><Money p={c.gstr1} /></td><td className="num"><Money p={c.gstr3b} /></td><td className="num">{c.difference ? <b><Money p={c.difference} /></b> : "0.00"}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="muted">GSTR-1 and GSTR-3B agree.</p>}
        <details className="more">
          <summary>See all the figures</summary>
          <div className="actions">
            <button className={tab === "gstr1" ? "primary" : undefined} onClick={() => setTab("gstr1")}>GSTR-1</button>
            <button className={tab === "gstr3b" ? "primary" : undefined} onClick={() => setTab("gstr3b")}>GSTR-3B</button>
          </div>
          {tab === "gstr1" ? (g1.data ? gstr1Tables(g1.data).map((t) => <DataTable key={t.title} table={t} />) : <Err error={g1.error} />) : null}
          {tab === "gstr3b" ? (g3.data ? gstr3bTables(g3.data).map((t) => <DataTable key={t.title} table={t} />) : <Err error={g3.error} />) : null}
        </details>
      </section>

      <section className="step">
        <h2>2. Match supplier bills with GSTR-2B <span className="muted">(recommended)</span></h2>
        <Gstr2bSection period={period} locked={s.locked} onChange={reloadAll} />
      </section>

      <section className={`step${approved ? " done" : ""}`}>
        <h2>3. Approve</h2>
        {approved ? <p>Approved{s.locked ? "" : ". If you change any sale or bill now, approve again."}</p> : owner ? (
          <>
            <p>When the figures look right, approve them. This does not file anything yet.</p>
            <button className="primary big" onClick={() => act(() => api(`/api/returns/${period}/approve`, { body: { ret: "both" } }), "Approved. Now file on the GST portal (step 4).")}>Approve</button>
          </>
        ) : <p className="muted">Ask the owner to approve.</p>}
      </section>

      <section className={`step${filed1 && filed3 ? " done" : ""}`}>
        <h2>4. File on the GST portal</h2>
        <ol>
          <li><b>GSTR-1:</b> download the file below. On the portal open GSTR-1 → <b>Prepare offline</b> → <b>Upload</b>, check, submit and file.
            <div className="actions"><a className="button" href={dl("gstr1.json")}>Download GSTR-1 file (JSON)</a></div></li>
          <li><b>GSTR-3B:</b> download the PDF and type the same figures into GSTR-3B on the portal. Pay any tax due, then file.
            <div className="actions"><a className="button" href={dl("gstr3b.pdf")}>Download GSTR-3B (PDF)</a></div></li>
          <li>Type the <b>ARN</b> the portal gives you for each return below. When both are saved, the month locks.</li>
        </ol>
        {!s.locked ? (
          <>
            {!approved ? <p className="muted">These unlock after you approve in step 3.</p> : null}
            <div className="filters">
              <Field label="Filed on"><input type="date" value={arn.date} onChange={(e) => setArn({ ...arn, date: e.target.value })} /></Field>
            </div>
            {!filed1 ? (
              <div className="filters">
                <Field label="GSTR-1 ARN"><input value={arn.gstr1} onChange={(e) => setArn({ ...arn, gstr1: e.target.value })} /></Field>
                <button disabled={!approved} onClick={() => act(() => api(`/api/returns/${period}/filed`, { body: { ret: "gstr1", arn: arn.gstr1, filedOn: arn.date } }), "GSTR-1 saved as filed.")}>Save GSTR-1 ARN</button>
              </div>
            ) : null}
            {!filed3 ? (
              <div className="filters">
                <Field label="GSTR-3B ARN"><input value={arn.gstr3b} onChange={(e) => setArn({ ...arn, gstr3b: e.target.value })} /></Field>
                <button disabled={!approved} onClick={() => act(() => api(`/api/returns/${period}/filed`, { body: { ret: "gstr3b", arn: arn.gstr3b, filedOn: arn.date } }), "GSTR-3B saved as filed.")}>Save GSTR-3B ARN</button>
              </div>
            ) : null}
          </>
        ) : null}
        {filed1 ? <p>GSTR-1 filed on {s.gstr1FiledOn}, ARN {s.gstr1Arn}.</p> : null}
        {filed3 ? <p>GSTR-3B filed on {s.gstr3bFiledOn}, ARN {s.gstr3bArn}.</p> : null}
        <details className="more">
          <summary>Other download formats</summary>
          <p>GSTR-1: <a href={dl("gstr1.pdf")}>PDF</a> · <a href={dl("gstr1.xlsx")}>Excel</a> · <a href={dl("gstr1.csv")}>CSV</a></p>
          <p>GSTR-3B: <a href={dl("gstr3b.json")}>JSON</a> · <a href={dl("gstr3b.xlsx")}>Excel</a> · <a href={dl("gstr3b.csv")}>CSV</a></p>
        </details>
      </section>

      <section className="step">
        <h2>5. Record the payment <span className="muted">(optional)</span></h2>
        <p>For your records: what you paid on the portal, and the challan number.</p>
        <div className="filters">
          {([["paidCgst", "CGST paid"], ["paidSgst", "SGST paid"], ["paidIgst", "IGST paid"], ["challanRef", "Challan (CIN)"]] as const).map(([k, label]) => (
            <Field key={k} label={label}><input value={payForm[k]} disabled={s.locked} onChange={(e) => setPay({ ...payForm, [k]: e.target.value })} /></Field>
          ))}
          <Field label="Paid on"><input type="date" value={payForm.paidOn} disabled={s.locked} onChange={(e) => setPay({ ...payForm, paidOn: e.target.value })} /></Field>
        </div>
        <details className="more">
          <summary>Cess, interest and late fee</summary>
          <div className="filters">
            {([["paidCess", "Cess paid"], ["interest", "Interest"], ["lateFee", "Late fee"]] as const).map(([k, label]) => (
              <Field key={k} label={label}><input value={payForm[k]} disabled={s.locked} onChange={(e) => setPay({ ...payForm, [k]: e.target.value })} /></Field>
            ))}
          </div>
        </details>
        {!s.locked ? <button onClick={() => act(async () => { await api(`/api/returns/${period}/payment`, { body: { ...payForm, paidOn: payForm.paidOn || null } }); setPay(null); }, "Payment saved.")}>Save payment</button> : null}
      </section>

      <details className="more">
        <summary>More: ITC reversals, locking, notes and acknowledgements</summary>
        <h3>ITC reversals and reclaims</h3>
        <p className="muted">Only if your accountant asks you to reverse or reclaim input tax credit for this month.</p>
        {adj.data && adj.data.adjustments.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Kind</th><th>Rule</th><th className="num">IGST</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">Cess</th><th>Note</th><th></th></tr></thead>
            <tbody>{adj.data.adjustments.map((a) => (
              <tr key={a.id}><td>{a.kind}</td><td>{meta.itcRules.find((r) => r.key === a.rule)?.label ?? a.rule}</td>
                <td className="num"><Money p={a.igst} /></td><td className="num"><Money p={a.cgst} /></td><td className="num"><Money p={a.sgst} /></td><td className="num"><Money p={a.cess} /></td><td>{a.note}</td>
                <td>{!s.locked ? <button className="link" onClick={() => act(() => api(`/api/itc/adjustments/${a.id}`, { method: "DELETE" }), "Removed.")}>Remove</button> : null}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p>None.</p>}
        {!s.locked ? (
          <div className="filters">
            <Field label="Kind"><select value={newAdj.kind} onChange={(e) => setNewAdj({ ...newAdj, kind: e.target.value })}><option value="reversal">Reversal</option><option value="reclaim">Reclaim</option></select></Field>
            <Field label="Rule"><select value={newAdj.rule} onChange={(e) => setNewAdj({ ...newAdj, rule: e.target.value })}>{meta.itcRules.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
            {(["igst", "cgst", "sgst", "cess"] as const).map((k) => <Field key={k} label={`${k.toUpperCase()} (₹)`}><input inputMode="decimal" value={newAdj[k]} onChange={(e) => setNewAdj({ ...newAdj, [k]: e.target.value })} /></Field>)}
            <Field label="Note"><input value={newAdj.note} onChange={(e) => setNewAdj({ ...newAdj, note: e.target.value })} /></Field>
            <button onClick={() => act(async () => {
              await api("/api/itc/adjustments", { body: { ...newAdj, period } });
              setNewAdj({ ...newAdj, igst: "", cgst: "", sgst: "", cess: "", note: "" });
            }, "Adjustment added.")}>Add</button>
          </div>
        ) : null}
        {owner ? (
          <>
            <h3>Lock or unlock</h3>
            {!s.locked
              ? <button onClick={() => act(() => api(`/api/returns/${period}/lock`, { method: "POST" }), "Locked.")}>Lock this month without filing</button>
              : <button onClick={() => {
                  const reason = prompt("Why does this month need to be unlocked?");
                  if (reason) act(() => api(`/api/returns/${period}/unlock`, { body: { reason } }), "Unlocked. The returns are back to approved and the ARNs were cleared.");
                }}>Unlock this month</button>}
          </>
        ) : null}
        {s.notes ? <><h3>Notes</h3><p style={{ whiteSpace: "pre-wrap" }}>{s.notes}</p></> : null}
        <Attachments entityType="return" entityId={period} defaultKind="acknowledgement" />
      </details>
    </>
  );
}

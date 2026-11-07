"use client";

import Link from "next/link";
import { use, useState } from "react";
import { api, errorText } from "@/components/api";
import { Attachments } from "@/components/attachments";
import { DataTable } from "@/components/data-table";
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

  return (
    <>
      <h1>Returns: {o.range.label}</h1>
      <p>
        {o.range.from} to {o.range.to} · GSTR-1 due {o.due.gstr1} · GSTR-3B due {o.due.gstr3b} · <Link href="/returns">All periods</Link>
      </p>
      {s.locked ? <div className="notice">This period is <b>locked</b>{o.fromSnapshot ? " and shows the figures frozen at filing" : ""}. Sales, purchases and ITC in it cannot be changed.</div> : null}
      {o.issues.map((i) => <div key={i} className="notice">{i}</div>)}
      <Err error={error} />
      <Ok message={ok} />

      <h2>Steps</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Step</th><th>GSTR-1</th><th>GSTR-3B</th></tr></thead>
        <tbody>
          <tr><td>1. Check figures below</td><td colSpan={2}>Fix any notices above before approving.</td></tr>
          <tr><td>2. Approve (owner)</td><td>{s.gstr1Status}</td><td>{s.gstr3bStatus}</td></tr>
          <tr><td>3. Download and upload to the GST portal</td>
            <td><a href={`/api/returns/${period}/gstr1.json`}>JSON</a> · <a href={`/api/returns/${period}/gstr1.xlsx`}>Excel</a> · <a href={`/api/returns/${period}/gstr1.csv`}>CSV</a> · <a href={`/api/returns/${period}/gstr1.pdf`}>PDF</a></td>
            <td><a href={`/api/returns/${period}/gstr3b.json`}>JSON</a> · <a href={`/api/returns/${period}/gstr3b.xlsx`}>Excel</a> · <a href={`/api/returns/${period}/gstr3b.csv`}>CSV</a> · <a href={`/api/returns/${period}/gstr3b.pdf`}>PDF</a></td></tr>
          <tr><td>4. Record ARN after filing</td><td>{s.gstr1Arn ? `${s.gstr1Arn} on ${s.gstr1FiledOn}` : "—"}</td><td>{s.gstr3bArn ? `${s.gstr3bArn} on ${s.gstr3bFiledOn}` : "—"}</td></tr>
        </tbody>
      </table></div>

      {!s.locked ? (
        <div className="box">
          {owner ? (
            <div className="actions">
              <button className="primary" onClick={() => act(() => api(`/api/returns/${period}/approve`, { body: { ret: "both" } }), "Approved.")}>Approve both returns</button>
              <button onClick={() => act(() => api(`/api/returns/${period}/lock`, { method: "POST" }), "Locked.")}>Lock period without filing</button>
            </div>
          ) : <p className="muted">The owner approves returns.</p>}
          <div className="filters">
            <Field label="Filing date"><input type="date" value={arn.date} onChange={(e) => setArn({ ...arn, date: e.target.value })} /></Field>
            {s.gstr1Status !== "filed" ? <>
              <Field label="GSTR-1 ARN"><input value={arn.gstr1} onChange={(e) => setArn({ ...arn, gstr1: e.target.value })} /></Field>
              <button onClick={() => act(() => api(`/api/returns/${period}/filed`, { body: { ret: "gstr1", arn: arn.gstr1, filedOn: arn.date } }), "GSTR-1 marked filed.")}>Mark GSTR-1 filed</button>
            </> : null}
            {s.gstr3bStatus !== "filed" ? <>
              <Field label="GSTR-3B ARN"><input value={arn.gstr3b} onChange={(e) => setArn({ ...arn, gstr3b: e.target.value })} /></Field>
              <button onClick={() => act(() => api(`/api/returns/${period}/filed`, { body: { ret: "gstr3b", arn: arn.gstr3b, filedOn: arn.date } }), "GSTR-3B marked filed.")}>Mark GSTR-3B filed</button>
            </> : null}
          </div>
          <p className="muted">When both returns are marked filed, the period locks and the figures are frozen.</p>
        </div>
      ) : owner ? (
        <div className="actions">
          <button onClick={() => {
            const reason = prompt("Why does this period need to be unlocked?");
            if (reason) act(() => api(`/api/returns/${period}/unlock`, { body: { reason } }), "Unlocked. Returns are back to approved; ARNs were cleared.");
          }}>Unlock period</button>
        </div>
      ) : null}

      <h2>GSTR-1 vs GSTR-3B</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Head</th><th className="num">GSTR-1</th><th className="num">GSTR-3B 3.1(a)+(b)</th><th className="num">Difference</th></tr></thead>
        <tbody>{o.compare.map((c) => <tr key={c.head}><td>{c.head}</td><td className="num"><Money p={c.gstr1} /></td><td className="num"><Money p={c.gstr3b} /></td><td className="num">{c.difference ? <b><Money p={c.difference} /></b> : "0.00"}</td></tr>)}</tbody>
      </table></div>

      <h2>Figures</h2>
      <div className="actions">
        <button className={tab === "gstr1" ? "primary" : undefined} onClick={() => setTab("gstr1")}>GSTR-1</button>
        <button className={tab === "gstr3b" ? "primary" : undefined} onClick={() => setTab("gstr3b")}>GSTR-3B</button>
      </div>
      {tab === "gstr1" ? (g1.data ? gstr1Tables(g1.data).map((t) => <DataTable key={t.title} table={t} />) : <Err error={g1.error} />) : null}
      {tab === "gstr3b" ? (g3.data ? gstr3bTables(g3.data).map((t) => <DataTable key={t.title} table={t} />) : <Err error={g3.error} />) : null}

      <h2>ITC reversals and reclaims</h2>
      {adj.data && adj.data.adjustments.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Kind</th><th>Rule</th><th className="num">IGST</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">Cess</th><th>Note</th><th></th></tr></thead>
          <tbody>{adj.data.adjustments.map((a) => (
            <tr key={a.id}><td>{a.kind}</td><td>{meta.itcRules.find((r) => r.key === a.rule)?.label ?? a.rule}</td>
              <td className="num"><Money p={a.igst} /></td><td className="num"><Money p={a.cgst} /></td><td className="num"><Money p={a.sgst} /></td><td className="num"><Money p={a.cess} /></td><td>{a.note}</td>
              <td>{!s.locked ? <button className="link" onClick={() => act(() => api(`/api/itc/adjustments/${a.id}`, { method: "DELETE" }), "Removed.")}>Remove</button> : null}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted">None.</p>}
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

      <h2>Payment</h2>
      <p>Cash payable per GSTR-3B: IGST <Money p={cash.igst} /> · CGST <Money p={cash.cgst} /> · SGST <Money p={cash.sgst} /> · Cess <Money p={cash.cess} /></p>
      <div className="filters">
        {([["paidIgst", "IGST paid"], ["paidCgst", "CGST paid"], ["paidSgst", "SGST paid"], ["paidCess", "Cess paid"], ["interest", "Interest"], ["lateFee", "Late fee"], ["challanRef", "Challan (CPIN/CIN)"]] as const).map(([k, label]) => (
          <Field key={k} label={label}><input value={payForm[k]} disabled={s.locked} onChange={(e) => setPay({ ...payForm, [k]: e.target.value })} /></Field>
        ))}
        <Field label="Paid on"><input type="date" value={payForm.paidOn} disabled={s.locked} onChange={(e) => setPay({ ...payForm, paidOn: e.target.value })} /></Field>
        {!s.locked ? <button onClick={() => act(async () => { await api(`/api/returns/${period}/payment`, { body: { ...payForm, paidOn: payForm.paidOn || null } }); setPay(null); }, "Payment saved.")}>Save payment</button> : null}
      </div>
      {s.notes ? <><h3>Notes</h3><p style={{ whiteSpace: "pre-wrap" }}>{s.notes}</p></> : null}
      <Attachments entityType="return" entityId={period} defaultKind="acknowledgement" />
    </>
  );
}

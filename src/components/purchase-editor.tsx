"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorText } from "./api";
import { Attachments } from "./attachments";
import { blankLine, LinesEditor, toPayloadLine, trimDecimal, type LineState } from "./lines-editor";
import { useApp } from "./shell";
import { Check, DOC_LABEL, Err, Field, Money, Ok, rupeesInput } from "./ui";

type DocType = "invoice" | "credit_note" | "debit_note";
interface PLine { id: number; description: string; hsnSac: string; qty: string; unit: string; unitPrice: string; discount: number; gstRateBp: number; cessRateBp: number; supplyKind: string; itcEligible: boolean; itcReason: string }
interface PDoc {
  id: number; docType: DocType; number: string; date: string; supplierId: number | null; supplierName: string; supplierGstin: string;
  supplierStateCode: string; placeOfSupply: string; reverseCharge: boolean; priceMode: "exclusive" | "inclusive"; category: string;
  itcPeriod: string; notes: string; originalNumber: string; status: string; itcTotal: number;
}
interface Party { id: number; name: string; gstin: string; stateCode: string }

export function PurchaseEditor({ existing }: { existing?: { doc: PDoc; lines: PLine[] } }) {
  const { meta } = useApp();
  const router = useRouter();
  const d = existing?.doc;
  const [f, setF] = useState({
    docType: d?.docType ?? "invoice" as DocType, number: d?.number ?? "", date: d?.date ?? meta.today,
    supplierId: d?.supplierId ?? null as number | null, supplierName: d?.supplierName ?? "", supplierGstin: d?.supplierGstin ?? "",
    supplierStateCode: d?.supplierStateCode ?? meta.business.stateCode, reverseCharge: d?.reverseCharge ?? false,
    priceMode: d?.priceMode ?? "exclusive" as "exclusive" | "inclusive", category: d?.category ?? "goods",
    itcPeriod: d?.itcPeriod ?? "", notes: d?.notes ?? "", originalNumber: d?.originalNumber ?? "",
  });
  const [lines, setLines] = useState<LineState[]>(existing ? existing.lines.map((l) => ({
    description: l.description, hsnSac: l.hsnSac, qty: trimDecimal(l.qty), unit: l.unit, unitPrice: trimDecimal(l.unitPrice),
    discount: l.discount ? rupeesInput(l.discount) : "", gstRateBp: l.gstRateBp, cessRateBp: l.cessRateBp, supplyKind: l.supplyKind,
    itcEligible: l.itcEligible, itcReason: l.itcReason, id: l.id,
  })) : [blankLine()]);
  const [parties, setParties] = useState<Party[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("saved") ? "Saved." : null));
  const [busy, setBusy] = useState(false);
  const cancelled = d?.status === "cancelled";
  const blocked = meta.categories.find((c) => c.key === f.category)?.blocked;

  useEffect(() => {
    api<{ parties: Party[] }>("/api/parties?kind=supplier&active=1").then((r) => setParties(r.parties)).catch(() => undefined);
  }, []);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const pickParty = (name: string) => {
    const p = parties.find((x) => x.name === name);
    if (p) setF((x) => ({ ...x, supplierId: p.id, supplierName: p.name, supplierGstin: p.gstin, supplierStateCode: p.stateCode }));
    else setF((x) => ({ ...x, supplierName: name, supplierId: null }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    const body = { ...f, itcPeriod: f.itcPeriod || undefined, lines: lines.map((l) => toPayloadLine(l, true)) };
    try {
      if (d) {
        await api(`/api/purchases/${d.id}`, { method: "PUT", body });
        window.location.assign(new URL(`/purchases/${d.id}?saved=1`, window.location.href));
      } else {
        const r = await api<{ purchase: { id: number } }>("/api/purchases", { body });
        router.replace(`/purchases/${r.purchase.id}?saved=1`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const reason = prompt("Why is this bill being cancelled?");
    if (!reason) return;
    try {
      await api(`/api/purchases/${d!.id}/cancel`, { body: { reason } });
      location.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <>
      <h1>{d ? `Purchase ${DOC_LABEL[d.docType].toLowerCase()} ${d.number}` : "New purchase bill"}{cancelled ? " (cancelled)" : ""}</h1>
      {d ? (
        <div className="actions">
          {!cancelled ? <button type="button" onClick={cancel}>Cancel bill</button> : null}
          <Link href="/purchases">Back to purchases</Link>
          <span className="muted">ITC claimed: <Money p={d.itcTotal} /> in {d.itcPeriod}</span>
        </div>
      ) : null}
      <form onSubmit={save}>
        <fieldset disabled={cancelled}>
          <div className="grid">
            <Field label="Type">
              <select value={f.docType} onChange={(e) => set("docType", e.target.value as DocType)}>
                <option value="invoice">Bill / invoice</option><option value="credit_note">Credit note from supplier</option><option value="debit_note">Debit note from supplier</option>
              </select>
            </Field>
            <Field label="Bill number"><input value={f.number} onChange={(e) => set("number", e.target.value)} maxLength={16} required /></Field>
            <Field label="Bill date"><input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} required /></Field>
            <Field label="Prices are">
              <select value={f.priceMode} onChange={(e) => set("priceMode", e.target.value as "exclusive" | "inclusive")}>
                <option value="exclusive">Before GST</option><option value="inclusive">Including GST</option>
              </select>
            </Field>
          </div>
          <h2>Supplier</h2>
          <datalist id="suppliers">{parties.map((p) => <option key={p.id} value={p.name}>{p.gstin}</option>)}</datalist>
          <div className="grid">
            <Field label="Name"><input list="suppliers" value={f.supplierName} onChange={(e) => pickParty(e.target.value)} required /></Field>
            <Field label="GSTIN" hint="Empty for an unregistered supplier (no ITC)."><input value={f.supplierGstin} onChange={(e) => set("supplierGstin", e.target.value.toUpperCase())} maxLength={15} /></Field>
            <Field label="Supplier state">
              <select value={f.supplierStateCode} onChange={(e) => set("supplierStateCode", e.target.value)}>
                {meta.states.filter((s) => s.code !== "96").map((s) => <option key={s.code} value={s.code}>{s.code} – {s.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid">
            <Field label="Category">
              <select value={f.category} onChange={(e) => set("category", e.target.value)}>
                {meta.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Claim ITC in period" hint="Leave as automatic to use the bill's own period.">
              <select value={f.itcPeriod} onChange={(e) => set("itcPeriod", e.target.value)}>
                <option value="">Automatic</option>
                {meta.periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            {f.docType !== "invoice" ? <Field label="Original bill number"><input value={f.originalNumber} onChange={(e) => set("originalNumber", e.target.value)} /></Field> : null}
          </div>
          <Check label="Reverse charge (you pay the GST)" checked={f.reverseCharge} onChange={(v) => set("reverseCharge", v)} />
          {meta.business.noItcScheme ? <div className="notice">Your business pays GST without input tax credit, so no ITC is claimed on any bill.</div> : null}
          {blocked ? <div className="notice">This category is blocked under section 17(5): ITC is shown in 4A(5) and reversed in 4B(1).</div> : null}
          <h2>Items</h2>
          <LinesEditor lines={lines} setLines={setLines} itc disabled={cancelled}
            context={{ placeOfSupply: meta.business.stateCode, supplierStateCode: f.supplierStateCode, priceMode: f.priceMode }} />
          <Field label="Notes"><textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </fieldset>
        <Err error={error} />
        <Ok message={ok} />
        {!cancelled ? <div className="actions"><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div> : null}
      </form>
      {d ? <Attachments entityType="purchase" entityId={String(d.id)} defaultKind="supplier_pdf" /> : <p className="muted">Save first to attach the supplier&apos;s bill.</p>}
    </>
  );
}

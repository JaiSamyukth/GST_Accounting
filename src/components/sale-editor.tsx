"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorText } from "./api";
import { Attachments } from "./attachments";
import { blankLine, LinesEditor, toPayloadLine, trimDecimal, type LineState } from "./lines-editor";
import { useApp } from "./shell";
import { Check, DOC_LABEL, Err, Field, Ok, rupeesInput } from "./ui";

type DocType = "invoice" | "credit_note" | "debit_note";

interface SaleLine { id: number; description: string; hsnSac: string; qty: string; unit: string; unitPrice: string; discount: number; gstRateBp: number; cessRateBp: number; supplyKind: string }
export interface SaleDoc {
  id: number; docType: DocType; number: string; date: string; partyId: number | null; partyName: string; partyGstin: string;
  partyAddress: string; placeOfSupply: string; reverseCharge: boolean; priceMode: "exclusive" | "inclusive"; notes: string;
  originalNumber: string; originalDate: string | null; noteReason: string; isExport: boolean; exportWithIgst: boolean;
  orderRef: string; status: string; section: string; grandTotal: number;
}
interface Party { id: number; name: string; gstin: string; address: string; stateCode: string }

function fromLine(l: SaleLine): LineState {
  return {
    description: l.description, hsnSac: l.hsnSac, qty: trimDecimal(l.qty), unit: l.unit, unitPrice: trimDecimal(l.unitPrice),
    discount: l.discount ? rupeesInput(l.discount) : "", gstRateBp: l.gstRateBp, cessRateBp: l.cessRateBp,
    supplyKind: l.supplyKind === "zero_rated" ? "taxable" : l.supplyKind, itcEligible: true, itcReason: "",
  };
}

export function SaleEditor({ existing, docType: newType }: { existing?: { doc: SaleDoc; lines: SaleLine[] }; docType?: DocType }) {
  const { meta } = useApp();
  const router = useRouter();
  const d = existing?.doc;
  const docType: DocType = d?.docType ?? newType ?? "invoice";
  const [f, setF] = useState({
    number: d?.number ?? "", date: d?.date ?? meta.today, partyId: d?.partyId ?? null as number | null, partyName: d?.partyName ?? "",
    partyGstin: d?.partyGstin ?? "", partyAddress: d?.partyAddress ?? "", placeOfSupply: d && d.placeOfSupply !== "96" ? d.placeOfSupply : meta.business.stateCode,
    reverseCharge: d?.reverseCharge ?? false, priceMode: d?.priceMode ?? meta.business.defaultPriceMode, notes: d?.notes ?? "",
    originalNumber: d?.originalNumber ?? "", originalDate: d?.originalDate ?? "", noteReason: d?.noteReason ?? "",
    isExport: d?.isExport ?? false, exportWithIgst: d?.exportWithIgst ?? false, orderRef: d?.orderRef ?? "",
  });
  const [lines, setLines] = useState<LineState[]>(existing ? existing.lines.map(fromLine) : [blankLine()]);
  const [parties, setParties] = useState<Party[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("saved") ? "Saved." : null));
  const [busy, setBusy] = useState(false);
  const cancelled = d?.status === "cancelled";

  useEffect(() => {
    api<{ parties: Party[] }>("/api/parties?kind=customer&active=1").then((r) => setParties(r.parties)).catch(() => undefined);
    if (!existing) api<{ number: string }>(`/api/sales/next-number?docType=${docType}`).then((r) => setF((x) => ({ ...x, number: x.number || r.number }))).catch(() => undefined);
  }, [existing, docType]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const pickParty = (name: string) => {
    const p = parties.find((x) => x.name === name);
    if (p) setF((x) => ({ ...x, partyId: p.id, partyName: p.name, partyGstin: p.gstin, partyAddress: p.address, placeOfSupply: p.stateCode }));
    else setF((x) => ({ ...x, partyName: name, partyId: null }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    const body = {
      ...f, docType, number: f.number || undefined, originalDate: f.originalDate || null,
      partyGstin: f.isExport ? "" : f.partyGstin, lines: lines.map((l) => toPayloadLine(l, false)),
    };
    try {
      if (d) {
        await api(`/api/sales/${d.id}`, { method: "PUT", body });
        window.location.assign(new URL(`/sales/${d.id}?saved=1`, window.location.href));
      } else {
        const r = await api<{ sale: { id: number } }>("/api/sales", { body });
        router.replace(`/sales/${r.sale.id}?saved=1`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const reason = prompt("Why is this being cancelled?");
    if (!reason) return;
    try {
      await api(`/api/sales/${d!.id}/cancel`, { body: { reason } });
      location.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <>
      <h1>{d ? `${DOC_LABEL[docType]} ${d.number}` : `New ${DOC_LABEL[docType].toLowerCase()}`}{cancelled ? " (cancelled)" : ""}</h1>
      {d ? (
        <div className="actions">
          <a className="button" href={`/api/sales/${d.id}/pdf`} target="_blank" rel="noreferrer">Print / download PDF</a>
          {!cancelled ? <button type="button" onClick={cancel}>Cancel document</button> : null}
          <Link href="/sales">Back to sales</Link>
          <span className="muted">GSTR-1 section: {d.section.toUpperCase()}</span>
        </div>
      ) : null}
      <form onSubmit={save}>
        <fieldset disabled={cancelled}>
          <div className="grid">
            <Field label="Number" hint={d ? undefined : "Suggested automatically; you may change it."}><input value={f.number} onChange={(e) => set("number", e.target.value)} maxLength={16} required /></Field>
            <Field label="Date"><input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} required /></Field>
            <Field label="Prices are">
              <select value={f.priceMode} onChange={(e) => set("priceMode", e.target.value as "exclusive" | "inclusive")}>
                <option value="exclusive">Before GST</option><option value="inclusive">Including GST</option>
              </select>
            </Field>
            <Field label="Order / event reference"><input value={f.orderRef} onChange={(e) => set("orderRef", e.target.value)} /></Field>
          </div>
          <h2>Customer</h2>
          <datalist id="customers">{parties.map((p) => <option key={p.id} value={p.name}>{p.gstin}</option>)}</datalist>
          <div className="grid">
            <Field label="Name"><input list="customers" value={f.partyName} onChange={(e) => pickParty(e.target.value)} required /></Field>
            {!f.isExport ? <Field label="GSTIN" hint="Leave empty for an unregistered customer."><input value={f.partyGstin} onChange={(e) => set("partyGstin", e.target.value.toUpperCase())} maxLength={15} /></Field> : null}
            {!f.isExport ? (
              <Field label="Place of supply">
                <select value={f.placeOfSupply} onChange={(e) => set("placeOfSupply", e.target.value)}>
                  {meta.states.filter((s) => s.code !== "96").map((s) => <option key={s.code} value={s.code}>{s.code} – {s.name}</option>)}
                </select>
              </Field>
            ) : null}
            <Field label="Address"><input value={f.partyAddress} onChange={(e) => set("partyAddress", e.target.value)} /></Field>
          </div>
          <div className="grid">
            <Check label="Export (outside India)" checked={f.isExport} onChange={(v) => set("isExport", v)} />
            {f.isExport ? <Check label="Export with payment of IGST" checked={f.exportWithIgst} onChange={(v) => set("exportWithIgst", v)} /> : null}
            <Check label="Reverse charge applies" checked={f.reverseCharge} onChange={(v) => set("reverseCharge", v)} />
          </div>
          {docType !== "invoice" ? (
            <div className="grid">
              <Field label="Original invoice number"><input value={f.originalNumber} onChange={(e) => set("originalNumber", e.target.value)} required /></Field>
              <Field label="Original invoice date"><input type="date" value={f.originalDate} onChange={(e) => set("originalDate", e.target.value)} /></Field>
              <Field label="Reason"><input value={f.noteReason} onChange={(e) => set("noteReason", e.target.value)} placeholder="e.g. fewer plates served" /></Field>
            </div>
          ) : null}
          <h2>Items</h2>
          <LinesEditor lines={lines} setLines={setLines} disabled={cancelled}
            context={{ placeOfSupply: f.placeOfSupply, priceMode: f.priceMode, isExport: f.isExport, exportWithIgst: f.exportWithIgst }} />
          <Field label="Notes (printed on the invoice)"><textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </fieldset>
        <Err error={error} />
        <Ok message={ok} />
        {!cancelled ? <div className="actions"><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div> : null}
      </form>
      {d ? <Attachments entityType="sale" entityId={String(d.id)} /> : <p className="muted">Save first to attach bill photos or PDFs.</p>}
    </>
  );
}

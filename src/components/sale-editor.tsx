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
  amendsId: number | null; amendedById: number | null; amendPeriod: string | null;
}
export interface SaleExisting { doc: SaleDoc; lines: SaleLine[]; period: string; locked: boolean; amendable: boolean }
interface Party { id: number; name: string; gstin: string; address: string; stateCode: string }

function fromLine(l: SaleLine): LineState {
  return {
    description: l.description, hsnSac: l.hsnSac, qty: trimDecimal(l.qty), unit: l.unit, unitPrice: trimDecimal(l.unitPrice),
    discount: l.discount ? rupeesInput(l.discount) : "", gstRateBp: l.gstRateBp, cessRateBp: l.cessRateBp,
    supplyKind: l.supplyKind === "zero_rated" ? "taxable" : l.supplyKind, itcEligible: true, itcReason: "",
  };
}

export function SaleEditor({ existing, docType: newType }: { existing?: SaleExisting; docType?: DocType }) {
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
  const [amending, setAmending] = useState(false);
  const [amendPeriod, setAmendPeriod] = useState(meta.currentPeriod);
  const readOnly = cancelled || !!d?.amendedById || (!!existing?.locked && !amending);
  const shownNumber = d ? d.number.replace(/~A\d*$/, "") : "";

  useEffect(() => {
    api<{ parties: Party[] }>("/api/parties?kind=customer&active=1").then((r) => setParties(r.parties)).catch(() => undefined);
    if (!existing) api<{ number: string }>(`/api/sales/next-number?docType=${docType}`).then((r) => setF((x) => ({ ...x, number: x.number || r.number }))).catch(() => undefined);
  }, [existing, docType]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // Opened by default only when this document already uses one of the extra options.
  const [moreOpen] = useState(() => !!(d && (d.priceMode === "inclusive" || d.isExport || d.reverseCharge || d.partyAddress || d.orderRef || d.notes)));
  const setGstin = (v: string) => {
    const g = v.toUpperCase().replace(/\s+/g, "");
    // A GSTIN starts with the state code: use it as the place of supply.
    setF((x) => ({ ...x, partyGstin: g, placeOfSupply: g.length >= 2 && meta.states.some((st) => st.code === g.slice(0, 2)) ? g.slice(0, 2) : x.placeOfSupply }));
  };
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
      if (d && amending) {
        const r = await api<{ sale: { id: number } }>(`/api/sales/${d.id}/amend`, { body: { ...body, number: undefined, amendPeriod } });
        window.location.assign(new URL(`/sales/${r.sale.id}?saved=1`, window.location.href));
      } else if (d) {
        await api(`/api/sales/${d.id}`, { method: "PUT", body: d.amendsId ? { ...body, number: undefined } : body });
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
      <h1>
        {d ? `${DOC_LABEL[docType]} ${shownNumber}` : `New ${DOC_LABEL[docType].toLowerCase()}`}
        {d?.amendsId ? " (amendment)" : ""}{cancelled ? " (cancelled)" : ""}
      </h1>
      {d ? (
        <div className="actions">
          <a className="button" href={`/api/sales/${d.id}/pdf`} target="_blank" rel="noreferrer">Print / download PDF</a>
          {!cancelled && !existing?.locked && !d.amendedById ? <button type="button" onClick={cancel}>{d.amendsId ? "Withdraw amendment" : "Cancel document"}</button> : null}
          {existing?.amendable && !amending ? <button type="button" onClick={() => setAmending(true)}>Amend</button> : null}
          <Link href="/sales">Back to sales</Link>
          <span className="muted">GSTR-1 section: {d.section.toUpperCase()}</span>
        </div>
      ) : null}
      {d?.amendedById ? <div className="notice">This version was replaced by an <Link href={`/sales/${d.amendedById}`}>amendment</Link>. Changes go there.</div> : null}
      {d?.amendsId ? <div className="notice">Amendment of the <Link href={`/sales/${d.amendsId}`}>earlier version</Link>, reported in {d.amendPeriod}. GSTR-1 shows it as amended; GSTR-3B takes only the difference.</div> : null}
      {existing?.locked && !d?.amendedById && !amending ? (
        <div className="notice">
          Period {existing.period} is filed and locked, so this document cannot be edited.
          {existing.amendable ? " To correct it, click Amend." : " Correct it with a credit or debit note."}
        </div>
      ) : null}
      {amending ? (
        <div className="box">
          <p><b>Amending.</b> Change what was wrong below and save. The filed version stays as it was; the amendment is reported in the period you choose.</p>
          <div className="filters">
            <Field label="Report the amendment in">
              <select value={amendPeriod} onChange={(e) => setAmendPeriod(e.target.value)}>
                {meta.periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            <button type="button" onClick={() => setAmending(false)}>Stop amending</button>
          </div>
        </div>
      ) : null}
      <form onSubmit={save}>
        <fieldset disabled={readOnly}>
          <div className="grid">
            <Field label={docType === "invoice" ? "Invoice number" : "Note number"} hint={d ? undefined : "Filled in for you; change it if you need to."}><input value={d?.amendsId || amending ? shownNumber : f.number} disabled={!!d?.amendsId || amending} onChange={(e) => set("number", e.target.value)} maxLength={16} required /></Field>
            <Field label="Date"><input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} required /></Field>
          </div>
          <h2>Customer</h2>
          <datalist id="customers">{parties.map((p) => <option key={p.id} value={p.name}>{p.gstin}</option>)}</datalist>
          <div className="grid">
            <Field label="Customer name" hint="Start typing to pick a saved customer."><input list="customers" value={f.partyName} onChange={(e) => pickParty(e.target.value)} required /></Field>
            {!f.isExport ? <Field label="Customer GSTIN" hint="Leave empty if the customer is not registered."><input value={f.partyGstin} onChange={(e) => setGstin(e.target.value)} maxLength={15} /></Field> : null}
            {!f.isExport ? (
              <Field label="Place of supply" hint="The state where the event is held.">
                <select value={f.placeOfSupply} onChange={(e) => set("placeOfSupply", e.target.value)}>
                  {meta.states.filter((s) => s.code !== "96").map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              </Field>
            ) : null}
          </div>
          {docType !== "invoice" ? (
            <div className="grid">
              <Field label="Original invoice number"><input value={f.originalNumber} onChange={(e) => set("originalNumber", e.target.value)} required /></Field>
              <Field label="Original invoice date"><input type="date" value={f.originalDate} onChange={(e) => set("originalDate", e.target.value)} /></Field>
              <Field label="Reason"><input value={f.noteReason} onChange={(e) => set("noteReason", e.target.value)} placeholder="e.g. fewer plates served" /></Field>
            </div>
          ) : null}
          <h2>Items</h2>
          <LinesEditor lines={lines} setLines={setLines} disabled={readOnly}
            context={{ placeOfSupply: f.placeOfSupply, priceMode: f.priceMode, isExport: f.isExport, exportWithIgst: f.exportWithIgst }} />
          <details className="more" open={moreOpen}>
            <summary>More options</summary>
            <div className="grid">
              <Field label="Prices are">
                <select value={f.priceMode} onChange={(e) => set("priceMode", e.target.value as "exclusive" | "inclusive")}>
                  <option value="exclusive">Before GST (GST added on top)</option><option value="inclusive">Including GST</option>
                </select>
              </Field>
              <Field label="Customer address"><input value={f.partyAddress} onChange={(e) => set("partyAddress", e.target.value)} /></Field>
              <Field label="Order / event reference"><input value={f.orderRef} onChange={(e) => set("orderRef", e.target.value)} /></Field>
            </div>
            <Field label="Notes (printed on the invoice)"><textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
            <Check label="Export (customer outside India)" checked={f.isExport} onChange={(v) => set("isExport", v)} />
            {f.isExport ? <Check label="Export with payment of IGST" checked={f.exportWithIgst} onChange={(v) => set("exportWithIgst", v)} /> : null}
            <Check label="Reverse charge applies" checked={f.reverseCharge} onChange={(v) => set("reverseCharge", v)} />
          </details>
        </fieldset>
        <Err error={error} />
        <Ok message={ok} />
        {!readOnly ? <div className="actions"><button className="primary" disabled={busy}>{busy ? "Saving…" : amending ? "Save amendment" : "Save"}</button></div> : null}
      </form>
      {d ? <Attachments entityType="sale" entityId={String(d.id)} /> : <p className="muted">Save first to attach bill photos or PDFs.</p>}
    </>
  );
}

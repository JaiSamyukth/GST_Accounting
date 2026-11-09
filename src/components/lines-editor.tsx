"use client";

import { useEffect, useRef, useState } from "react";
import { formatINR } from "@/lib/money";
import { api, errorText } from "./api";
import { useApp } from "./shell";

export interface LineState {
  description: string;
  hsnSac: string;
  qty: string;
  unit: string;
  unitPrice: string;
  discount: string;
  gstRateBp: number;
  cessRateBp: number;
  supplyKind: string;
  itcEligible: boolean;
  itcReason: string;
  id?: number;
}

export const blankLine = (rateBp = 500, itcEligible = true): LineState => ({
  description: "", hsnSac: "", qty: "1", unit: "NOS", unitPrice: "", discount: "", gstRateBp: rateBp,
  cessRateBp: 0, supplyKind: "taxable", itcEligible, itcReason: "",
});

export function trimDecimal(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export function toPayloadLine(l: LineState, withItc: boolean) {
  const base = {
    description: l.description, hsnSac: l.hsnSac, qty: l.qty || "0", unit: l.unit, unitPrice: l.unitPrice || "0",
    discount: l.discount || "0", gstRateBp: l.gstRateBp, cessRateBp: l.cessRateBp, supplyKind: l.supplyKind,
  };
  return withItc ? { ...base, itcEligible: l.itcEligible, itcReason: l.itcReason } : base;
}

interface Hsn { code: string; description: string; defaultRateBp: number; supplyKind: string; uqc: string }
interface Calc {
  taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; roundOff: number; grandTotal: number;
  lines: Array<{ taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number }>;
}

const KIND_LABEL: Record<string, string> = { taxable: "Taxable", exempt: "Exempt", nil: "Nil rated", non_gst: "Non-GST", zero_rated: "Zero rated" };

/** Editable line table with a live server-side tax preview. */
export function LinesEditor({ lines, setLines, context, itc, disabled }: {
  lines: LineState[];
  setLines: (l: LineState[]) => void;
  context: { placeOfSupply: string; supplierStateCode?: string; priceMode: string; isExport?: boolean; exportWithIgst?: boolean };
  itc?: boolean;
  disabled?: boolean;
}) {
  const { meta } = useApp();
  const [hsn, setHsn] = useState<Hsn[]>([]);
  // Everyday columns only; discount, unit, cess and supply type appear on request (or when already used).
  const [showMore, setShowMore] = useState(() =>
    lines.some((l) => (l.discount && Number(l.discount) !== 0) || l.cessRateBp > 0 || l.supplyKind !== "taxable"));
  const [calc, setCalc] = useState<Calc | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    api<{ hsn: Hsn[] }>("/api/hsn").then((r) => setHsn(r.hsn)).catch(() => undefined);
  }, []);

  const body = JSON.stringify({ ...context, lines: lines.map((l) => toPayloadLine(l, false)) });
  const ready = lines.length > 0 && lines.every((l) => l.description.trim() && Number(l.qty) > 0 && l.unitPrice !== "");
  useEffect(() => {
    if (!ready) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      api<Calc>("/api/gst/calculate", { body: JSON.parse(body) })
        .then((r) => { if (my === seq.current) { setCalc(r); setCalcError(null); } })
        .catch((e) => { if (my === seq.current) { setCalc(null); setCalcError(errorText(e)); } });
    }, 350);
    return () => clearTimeout(t);
  }, [body, ready]);
  const shown = ready ? calc : null;

  const update = (i: number, patch: Partial<LineState>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickHsn = (i: number, code: string) => {
    const h = hsn.find((x) => x.code === code);
    const patch: Partial<LineState> = { hsnSac: code };
    if (h) {
      patch.gstRateBp = h.defaultRateBp;
      patch.supplyKind = h.supplyKind;
      patch.unit = h.uqc;
      if (!lines[i].description) patch.description = h.description;
    }
    update(i, patch);
  };
  const rates = meta.rates.some((r) => r.rateBp === 0) ? meta.rates : [{ id: 0, rateBp: 0, label: "0%" }, ...meta.rates];

  return (
    <>
      <datalist id="hsn-list">{hsn.map((h) => <option key={h.code} value={h.code}>{h.description}</option>)}</datalist>
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr>
              <th>#</th><th>Description</th><th>HSN/SAC</th><th>Qty</th>{showMore ? <th>Unit</th> : null}<th>Rate (₹)</th>
              {showMore ? <th>Discount (₹)</th> : null}<th>GST</th>{showMore ? <><th>Cess %</th><th>Kind</th></> : null}{itc ? <th>ITC</th> : null}
              <th className="num">Taxable</th><th className="num">Tax</th><th className="num">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const c = shown?.lines[i];
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><input aria-label="Description" value={l.description} disabled={disabled} onChange={(e) => update(i, { description: e.target.value })} style={{ minWidth: "10rem" }} /></td>
                  <td><input aria-label="HSN/SAC" list="hsn-list" value={l.hsnSac} disabled={disabled} onChange={(e) => pickHsn(i, e.target.value.trim())} /></td>
                  <td><input aria-label="Quantity" inputMode="decimal" value={l.qty} disabled={disabled} onChange={(e) => update(i, { qty: e.target.value })} /></td>
                  {showMore ? <td>
                    <select aria-label="Unit" value={l.unit} disabled={disabled} onChange={(e) => update(i, { unit: e.target.value })}>
                      {(meta.uqc.includes(l.unit) ? meta.uqc : [l.unit, ...meta.uqc]).map((u) => <option key={u}>{u}</option>)}
                    </select>
                  </td> : null}
                  <td><input aria-label="Rate" inputMode="decimal" value={l.unitPrice} disabled={disabled} onChange={(e) => update(i, { unitPrice: e.target.value })} /></td>
                  {showMore ? <td><input aria-label="Discount" inputMode="decimal" value={l.discount} disabled={disabled} onChange={(e) => update(i, { discount: e.target.value })} /></td> : null}
                  <td>
                    <select aria-label="GST rate" value={l.gstRateBp} disabled={disabled} onChange={(e) => update(i, { gstRateBp: Number(e.target.value) })}>
                      {(rates.some((r) => r.rateBp === l.gstRateBp) ? rates : [...rates, { id: -1, rateBp: l.gstRateBp, label: `${l.gstRateBp / 100}%` }]).map((r) => <option key={r.rateBp} value={r.rateBp}>{r.label}</option>)}
                    </select>
                  </td>
                  {showMore ? <><td><input aria-label="Cess percent" inputMode="decimal" value={l.cessRateBp ? String(l.cessRateBp / 100) : ""} disabled={disabled} onChange={(e) => update(i, { cessRateBp: Math.round((Number(e.target.value) || 0) * 100) })} style={{ minWidth: "3.5rem" }} /></td>
                  <td>
                    <select aria-label="Supply kind" value={l.supplyKind} disabled={disabled} onChange={(e) => update(i, { supplyKind: e.target.value })}>
                      {meta.supplyKinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}
                    </select>
                  </td></> : null}
                  {itc ? (
                    <td>
                      <label style={{ whiteSpace: "nowrap" }}><input type="checkbox" checked={l.itcEligible} disabled={disabled} onChange={(e) => update(i, { itcEligible: e.target.checked })} />Claim</label>
                      {!l.itcEligible ? <input aria-label="Reason ITC not claimed" placeholder="Reason" value={l.itcReason} disabled={disabled} onChange={(e) => update(i, { itcReason: e.target.value })} /> : null}
                    </td>
                  ) : null}
                  <td className="num">{c ? formatINR(c.taxableValue) : ""}</td>
                  <td className="num">{c ? formatINR(c.cgst + c.sgst + c.igst + c.cess) : ""}</td>
                  <td className="num">{c ? formatINR(c.total) : ""}</td>
                  <td>{!disabled && lines.length > 1 ? <button type="button" className="link" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions">
      {!disabled ? <button type="button" onClick={() => setLines([...lines, blankLine(lines[lines.length - 1]?.gstRateBp, !(itc && meta.business.noItcScheme))])}>Add another item</button> : null}
      <label><input type="checkbox" checked={showMore} onChange={(e) => setShowMore(e.target.checked)} />Show discount, unit, cess and supply type</label>
      </div>
      {ready && calcError ? <p className="muted">Preview: {calcError}</p> : null}
      {shown ? (
        <div className="table-wrap" style={{ maxWidth: 420 }}>
          <table>
            <tbody>
              <tr><td>Taxable value</td><td className="num">{formatINR(shown.taxableValue)}</td></tr>
              {shown.cgst ? <tr><td>CGST</td><td className="num">{formatINR(shown.cgst)}</td></tr> : null}
              {shown.sgst ? <tr><td>SGST</td><td className="num">{formatINR(shown.sgst)}</td></tr> : null}
              {shown.igst ? <tr><td>IGST</td><td className="num">{formatINR(shown.igst)}</td></tr> : null}
              {shown.cess ? <tr><td>Cess</td><td className="num">{formatINR(shown.cess)}</td></tr> : null}
              {shown.roundOff ? <tr><td>Round off</td><td className="num">{formatINR(shown.roundOff)}</td></tr> : null}
              <tr className="total"><td>Total</td><td className="num">₹ {formatINR(shown.grandTotal)}</td></tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { stateName, useAuth } from "../lib/auth";
import { DOC_LABEL, amount, date, today } from "../lib/format";
import { gstinProblem } from "../lib/gstin";
import { useApi, useDebounced, useTitle } from "../lib/hooks";
import { IBack, IPlus, ITrash } from "../components/icons";
import { Attachments, uploadQueued } from "../components/Attachments";
import { Confirm, ErrorNote, Field, Leaders, Loading, Seg, StatusTag, Term, useToast } from "../components/ui";
import { CATEGORY } from "./Purchases";

type Line = { description: string; hsn_sac: string; qty: string; unit: string; unit_price: string; discount: string; gst_rate: string; supply_kind: string; itc_eligible?: boolean | null; itc_reason?: string; id?: number };
const blank = (rate = "5", hsn = "996334", desc = ""): Line => ({ description: desc, hsn_sac: hsn, qty: "1", unit: "NOS", unit_price: "", discount: "", gst_rate: rate, supply_kind: "taxable", itc_eligible: null });

const PRESETS = [
  { label: "Morning meal", desc: "Morning tiffin", unit: "NOS" },
  { label: "Afternoon meal", desc: "Afternoon meals", unit: "NOS" },
  { label: "Night meal", desc: "Night dinner", unit: "NOS" },
  { label: "Service charge", desc: "Service charge", unit: "NOS" },
  { label: "Transport charge", desc: "Transport charge", unit: "NOS" },
];

export function DocEditor({ kind }: { kind: "sales" | "purchase" }) {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const isNew = !id;
  const nav = useNavigate();
  const toast = useToast();
  const { meta, business } = useAuth();
  const base = kind === "sales" ? "/sales" : "/purchases";
  const existing = useApi<any>(isNew ? null : `${base}/${id}`, [id]);
  const hsn = useApi<any[]>("/hsn");
  const parties = useApi<any[]>(`/parties?kind=${kind === "sales" ? "customer" : "supplier"}`);
  const home = business?.state_code || "33";

  const [f, setF] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [calc, setCalc] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [queued, setQueued] = useState<File[]>([]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [amending, setAmending] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const docType = f?.doc_type || "invoice";
  const label = kind === "sales" ? DOC_LABEL[docType] : docType === "invoice" ? "Purchase bill" : `Supplier ${DOC_LABEL[docType].toLowerCase()}`;
  useTitle(isNew ? `New ${label.toLowerCase()}` : `${label} ${f?.number || ""}`);

  // initialise
  useEffect(() => {
    if (!business) return;
    if (isNew) {
      const t = sp.get("type") || "invoice";
      const init: any = kind === "sales"
        ? { doc_type: t, number: "", date: today(), party_name: "", party_gstin: "", party_address: "", place_of_supply: home, price_mode: business.default_price_mode || "exclusive", reverse_charge: false, is_export: false, export_with_igst: false, notes: "", order_ref: "", original_number: "", original_date: "", note_reason: "" }
        : { doc_type: "invoice", number: "", date: today(), supplier_name: "", supplier_gstin: "", supplier_state_code: home, place_of_supply: home, price_mode: "exclusive", reverse_charge: false, category: "inputs", notes: "", original_number: "", original_date: "" };
      setF(init);
      setLines([kind === "sales" ? blank("5", "996334", "") : blank("5", "", "")]);
      if (kind === "sales") api(`/sales/next-number?doc_type=${t}`).then((r) => setF((x: any) => ({ ...x, number: x.number || r.number }))).catch(() => {});
    }
  }, [isNew, business, kind, sp, home]);

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setF({ ...d, number: d.number.replace(/~A$/, ""), original_date: d.original_date || "" });
    setLines(d.lines.map((l: any) => ({ ...l, qty: String(Number(l.qty)), unit_price: String(Number(l.unit_price)), discount: Number(l.discount) ? String(Number(l.discount)) : "", gst_rate: String(Number(l.gst_rate)) })));
  }, [existing.data]);

  const readOnly = !isNew && (f?.status !== "active");
  const linePayload = (ls: Line[]) => ls.map((l) => ({ ...l, qty: l.qty || "1", unit_price: l.unit_price || "0", discount: l.discount || "0", gst_rate: l.supply_kind === "taxable" || l.supply_kind === "zero_rated" ? l.gst_rate || "0" : "0" }));

  // live GST calculation from the server (same engine that saves)
  const calcBody = useDebounced(JSON.stringify(f && { kind, price_mode: f.price_mode, place_of_supply: kind === "sales" ? f.place_of_supply : f.place_of_supply, supplier_state_code: f.supplier_state_code, party_gstin: f.party_gstin, is_export: f.is_export, export_with_igst: f.export_with_igst, doc_type: f.doc_type, lines: linePayload(lines) }), 200);
  useEffect(() => {
    if (!calcBody || calcBody === "null") return;
    const ctrl = new AbortController();
    api("/gst/calculate", { body: JSON.parse(calcBody), signal: ctrl.signal }).then(setCalc).catch(() => {});
    return () => ctrl.abort();
  }, [calcBody]);

  const states = useMemo(() => meta?.states.map((s) => s.code) || [], [meta]);
  const gstinField = kind === "sales" ? "party_gstin" : "supplier_gstin";
  const gErr = f ? gstinProblem(f[gstinField] || "", states) : null;

  if (existing.error) return <div className="page"><ErrorNote error={existing.error} /></div>;
  if (!f || !meta) return <Loading />;

  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const setLine = (i: number, k: keyof Line, v: any) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const pickHsn = (i: number, code: string) => {
    const h = hsn.data?.find((x) => x.code === code);
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, hsn_sac: code, ...(h ? { gst_rate: String(Number(h.default_rate)), supply_kind: h.supply_kind, unit: l.unit === "NOS" && h.uqc !== "NA" ? h.uqc : l.unit, description: l.description || h.description } : {}) } : l)));
  };
  const pickParty = (name: string) => {
    const p = parties.data?.find((x) => x.name === name);
    if (!p) return set(kind === "sales" ? "party_name" : "supplier_name", name);
    if (kind === "sales") setF((x: any) => ({ ...x, party_name: p.name, party_gstin: p.gstin, party_address: p.address, place_of_supply: p.state_code, party_id: p.id }));
    else setF((x: any) => ({ ...x, supplier_name: p.name, supplier_gstin: p.gstin, supplier_state_code: p.state_code, supplier_id: p.id }));
  };
  const onGstin = (v: string) => {
    const g = v.toUpperCase().replace(/\s/g, "");
    setF((x: any) => {
      const n = { ...x, [gstinField]: g };
      if (g.length >= 2 && states.includes(g.slice(0, 2))) {
        if (kind === "sales") n.place_of_supply = g.slice(0, 2);
        else n.supplier_state_code = g.slice(0, 2);
      }
      return n;
    });
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (gErr) { setErr(`GSTIN: ${gErr}`); return; }
    setBusy(true);
    setErr(null);
    const body = { ...f, original_date: f.original_date || null, lines: linePayload(lines) };
    try {
      const path = amending ? `${base}/${id}/amend` : isNew ? base : `${base}/${id}`;
      const r = await api<any>(path, { method: isNew || amending ? "POST" : "PUT", body });
      if (queued.length) await uploadQueued(queued, kind, r.id, kind === "sales" ? "sales_invoice" : "purchase_invoice");
      setSaved(r.number.replace(/~A$/, ""));
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => {
        toast(`${label} ${r.number.replace(/~A$/, "")} saved. Total ₹${amount(r.total)}`);
        nav(`${base}/${r.id}`, { replace: true });
        setSaved(null);
        setAmending(false);
        setQueued([]);
        if (!isNew) existing.reload();
      }, reduce ? 500 : 1100);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
      wrap.current?.querySelector<HTMLElement>("[role=alert]")?.focus();
      return;
    }
    setBusy(false);
  };

  const doCancel = async () => {
    try {
      await api(`${base}/${id}/cancel`, { method: "POST" });
      toast(`${label} cancelled`);
      setConfirmCancel(false);
      existing.reload();
    } catch (x) { toast((x as Error).message, true); setConfirmCancel(false); }
  };

  const inter = calc?.inter_state;
  const isNote = docType !== "invoice";
  const sum = calc || { taxable_value: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, round_off: 0, total: 0, lines: [] };
  const partyKey = kind === "sales" ? "party_name" : "supplier_name";
  const disabled = readOnly || busy;
  const lockedMsg = err && err.includes("filed and locked");

  return (
    <div className="page" ref={wrap}>
      <Link className="crumb" to={base}><IBack width={16} height={16} />{kind === "sales" ? "All sales" : "All purchases"}</Link>
      <div className="page-head">
        <div>
          <h1 className="h1">{amending ? `Correct ${f.number}` : isNew ? `New ${label.toLowerCase()}` : `${label} ${f.number}`}</h1>
          {!isNew && <p className="lede muted">{f.status !== "active" ? <StatusTag s={f.status} /> : null} {kind === "sales" ? `Customer ${f.party_name}` : `From ${f.supplier_name}`}, {date(f.date)}</p>}
          {amending && <p className="lede muted">The month of this bill is filed. Your correction is reported as an <Term k="amend">amendment</Term> in this month's GSTR-1.</p>}
        </div>
        {kind === "sales" && isNew && (
          <Seg label="Document type" value={docType} onChange={(v) => { set("doc_type", v); api(`/sales/next-number?doc_type=${v}`).then((r) => set("number", r.number)).catch(() => {}); }}
            options={[{ value: "invoice", label: "Invoice" }, { value: "credit_note", label: "Credit note" }, { value: "debit_note", label: "Debit note" }]} />
        )}
      </div>

      {err && <div className="note bad" role="alert" tabIndex={-1} style={{ marginBottom: 18 }}><p>{err}</p>
        {lockedMsg && kind === "sales" && !isNew && !amending && <button className="linkbtn" onClick={() => { setAmending(true); setErr(null); }}>Correct it as an amendment instead</button>}</div>}

      <form onSubmit={save} noValidate>
        <div className={`carbon-wrap ${saved ? "saved" : ""}`}>
          <div className="carbon-copy" aria-hidden="true" />
          <div className="copy-stamp" aria-hidden="true"><span className="stamp ok">Saved · No. {saved}</span></div>
          <fieldset className="sheet" disabled={disabled} style={{ margin: 0, padding: 0, minWidth: 0 }}>
            <legend className="sr">{label}</legend>
            {/* the head of the order book */}
            <div className="book-head">
              {kind === "sales" ? (
                <div>
                  <div className="tiny muted">Cell: {business.phone || "add in Settings"}</div>
                  <div className="book-title" style={{ marginTop: 6 }}>{(business.trade_name || "DEV CATERS").toUpperCase()}</div>
                  <div className="small" style={{ marginTop: 6 }}>{business.address}</div>
                  {business.proprietor && <div className="small">Prop: <b>{business.proprietor}</b></div>}
                  <div className="tiny muted" style={{ marginTop: 6 }}>GSTIN {business.gstin || "not set"}</div>
                </div>
              ) : (
                <div className="stack">
                  <Field label="Supplier name" htmlFor="sup">
                    <input id="sup" className="input" list="party-list" value={f.supplier_name} onChange={(e) => pickParty(e.target.value)} required autoComplete="off" placeholder="Sri Murugan Provisions" />
                  </Field>
                  <Field label="Bill type" htmlFor="cat" hint={f.category === "expense" ? "Credit is not claimed on these" : undefined}>
                    <select id="cat" className="select" value={f.category} onChange={(e) => set("category", e.target.value)}>
                      {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                </div>
              )}
              <div className="stack">
                {kind === "sales" && (
                  <Field label="Party name" htmlFor="party">
                    <input id="party" className="input" list="party-list" value={f.party_name} onChange={(e) => pickParty(e.target.value)} required autoComplete="off" placeholder="Who is the bill for?" />
                  </Field>
                )}
                <Field label={kind === "sales" ? "Customer GSTIN (if they have one)" : "Supplier GSTIN"} htmlFor="gstin" term="gstin" error={gErr}
                  hint={kind === "sales" ? (f.party_gstin ? "Reported as B2B" : "Leave empty for families and people") : !f.supplier_gstin ? "Leave empty if the supplier is not registered" : undefined}>
                  <input id="gstin" className="input" value={f[gstinField]} onChange={(e) => onGstin(e.target.value)} maxLength={15} autoComplete="off" spellCheck={false} aria-invalid={!!gErr} placeholder="33ABCDE1234F1Z5" style={{ letterSpacing: "0.04em" }} />
                </Field>
                {kind === "sales" && (
                  <Field label="Address" htmlFor="addr"><input id="addr" className="input" value={f.party_address} onChange={(e) => set("party_address", e.target.value)} placeholder="Optional" /></Field>
                )}
              </div>
            </div>
            <datalist id="party-list">{parties.data?.map((p) => <option key={p.id} value={p.name}>{p.gstin}</option>)}</datalist>
            <datalist id="hsn-list">{hsn.data?.map((h) => <option key={h.id} value={h.code}>{h.description}</option>)}</datalist>

            <div className="book-meta">
              <div>
                <div className="inline-field">
                  <label htmlFor="num">{kind === "sales" ? `${isNote ? "Note" : "Bill"} No.` : "Supplier bill No."}</label>
                  <input id="num" className="input order-no" value={f.number} onChange={(e) => set("number", e.target.value)} maxLength={16} required style={{ fontSize: 24 }} autoComplete="off" />
                </div>
              </div>
              <div>
                <div className="inline-field">
                  <label htmlFor="dt">{kind === "sales" ? "Bill date" : "Bill date"}</label>
                  <input id="dt" type="date" className="input" value={f.date} max={today()} onChange={(e) => set("date", e.target.value)} required />
                </div>
              </div>
            </div>

            {isNote && (
              <div className="sheet-pad form-grid" style={{ borderBottom: "1.5px solid var(--ink)" }}>
                <Field className="col-4" label="Against bill No." htmlFor="on" term={docType === "credit_note" ? "credit_note" : "debit_note"}><input id="on" className="input" value={f.original_number} onChange={(e) => set("original_number", e.target.value)} required /></Field>
                <Field className="col-4" label="Date of that bill" htmlFor="od"><input id="od" type="date" className="input" value={f.original_date || ""} onChange={(e) => set("original_date", e.target.value)} /></Field>
                {kind === "sales" && <Field className="col-4" label="Reason" htmlFor="nr"><input id="nr" className="input" value={f.note_reason} onChange={(e) => set("note_reason", e.target.value)} placeholder="Fewer plates served" /></Field>}
              </div>
            )}

            {/* lines */}
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
              <table className="lines">
                <thead>
                  <tr>
                    <th style={{ width: "30%" }}>Description</th>
                    <th><Term k="hsn">HSN/SAC</Term></th>
                    <th className="right">{kind === "sales" ? "Plates / qty" : "Qty"}</th>
                    <th>Unit</th>
                    <th className="right">Rate ₹</th>
                    <th className="right">Discount ₹</th>
                    <th>GST</th>
                    {kind === "purchase" && <th><Term k="itc">Credit</Term></th>}
                    <th className="right">Amount ₹</th>
                    <th><span className="sr">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const r = sum.lines?.[i];
                    const taxed = l.supply_kind === "taxable" || l.supply_kind === "zero_rated";
                    return (
                      <tr key={i}>
                        <td className="wide" data-label="Description"><input aria-label={`Line ${i + 1} description`} className="input" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} placeholder={kind === "sales" ? "Wedding lunch, 150 members" : "Sunflower oil 15 L"} /></td>
                        <td data-label="HSN/SAC"><input aria-label={`Line ${i + 1} HSN or SAC`} className="input" list="hsn-list" inputMode="numeric" value={l.hsn_sac} onChange={(e) => pickHsn(i, e.target.value.replace(/\D/g, "").slice(0, 8))} style={{ width: 96 }} /></td>
                        <td data-label="Qty"><input aria-label={`Line ${i + 1} quantity`} className="input right" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} style={{ width: 80 }} /></td>
                        <td data-label="Unit"><select aria-label={`Line ${i + 1} unit`} className="select" value={l.unit} onChange={(e) => setLine(i, "unit", e.target.value)}>{meta.uqc.map((u) => <option key={u}>{u}</option>)}</select></td>
                        <td data-label="Rate ₹"><input aria-label={`Line ${i + 1} rate`} className="input right" inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(i, "unit_price", e.target.value)} placeholder="0.00" style={{ width: 96 }} /></td>
                        <td data-label="Discount ₹"><input aria-label={`Line ${i + 1} discount`} className="input right" inputMode="decimal" value={l.discount} onChange={(e) => setLine(i, "discount", e.target.value)} placeholder="0" style={{ width: 80 }} /></td>
                        <td data-label="GST">
                          <select aria-label={`Line ${i + 1} GST rate`} className="select" value={taxed ? `r:${Number(l.gst_rate)}` : `k:${l.supply_kind}`} onChange={(e) => {
                            const v = e.target.value;
                            if (v.startsWith("r:")) setLines((ls) => ls.map((x, j) => (j === i ? { ...x, gst_rate: v.slice(2), supply_kind: "taxable" } : x)));
                            else setLines((ls) => ls.map((x, j) => (j === i ? { ...x, gst_rate: "0", supply_kind: v.slice(2) } : x)));
                          }}>
                            {meta.rates.filter((r) => r.active).map((r) => <option key={r.id} value={`r:${Number(r.rate)}`}>{Number(r.rate)}%</option>)}
                            <option value="k:nil">Nil rated</option><option value="k:exempt">Exempt</option><option value="k:non_gst">Non-GST</option>
                          </select>
                        </td>
                        {kind === "purchase" && (
                          <td data-label="Credit">
                            <select aria-label={`Line ${i + 1} input tax credit`} className="select" value={l.itc_eligible === null || l.itc_eligible === undefined ? "auto" : l.itc_eligible ? "yes" : "no"}
                              onChange={(e) => setLine(i, "itc_eligible", e.target.value === "auto" ? null : e.target.value === "yes")} title={l.itc_reason || ""}>
                              <option value="auto">{isNew ? "Auto" : l.itc_eligible ? "Claim" : "No claim"}</option><option value="yes">Claim</option><option value="no">No claim</option>
                            </select>
                          </td>
                        )}
                        <td className="amt" data-label="Amount ₹">{r ? amount(r.total) : "0.00"}</td>
                        <td className="del">{lines.length > 1 && !readOnly && <button type="button" className="iconbtn" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><ITrash /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!readOnly && (
              <div className="sheet-pad btn-row" style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1.5px solid var(--ink)", gap: 8 }}>
                <button type="button" className="btn quiet small" onClick={() => setLines((ls) => [...ls, kind === "sales" ? blank("5", "996334") : blank("5", "")])}><IPlus />Add a line</button>
                {kind === "sales" && PRESETS.map((p) => (
                  <button type="button" key={p.label} className="btn quiet small" onClick={() => setLines((ls) => {
                    const empty = ls.length === 1 && !ls[0].description && !ls[0].unit_price;
                    const nl = { ...blank("5", "996334", p.desc), unit: p.unit };
                    return empty ? [nl] : [...ls, nl];
                  })}>+ {p.label}</button>
                ))}
              </div>
            )}

            {/* bottom of the form: totals with dotted leaders, like the printed book */}
            <div className="grid-2" style={{ gap: 0 }}>
              <div className="sheet-pad stack" style={{ borderRight: "1px solid var(--rule)" }}>
                <div className="btn-row" style={{ alignItems: "flex-end" }}>
                  <div className="field">
                    <span className="label">Rates entered <Term k="inclusive" icon /></span>
                    <Seg label="Rates entered" value={f.price_mode} onChange={(v) => set("price_mode", v)} options={[{ value: "exclusive", label: "Before GST" }, { value: "inclusive", label: "Including GST" }]} />
                  </div>
                </div>
                {kind === "sales" ? (
                  <Field label="Place of supply" htmlFor="pos" term="pos" hint={inter ? "Another state: IGST" : `${stateName(meta, home)}: CGST + SGST`}>
                    <select id="pos" className="select" value={f.place_of_supply} onChange={(e) => set("place_of_supply", e.target.value)} disabled={f.is_export}>
                      {meta.states.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
                    </select>
                  </Field>
                ) : (
                  <Field label="Supplier's state" htmlFor="sst" hint={inter ? "Another state: IGST" : "Same state: CGST + SGST"}>
                    <select id="sst" className="select" value={f.supplier_state_code} onChange={(e) => set("supplier_state_code", e.target.value)}>
                      {meta.states.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
                    </select>
                  </Field>
                )}
                <button type="button" className="linkbtn small" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Fewer options" : "More options"}</button>
                {more && (
                  <div className="stack">
                    <label className="check"><input type="checkbox" checked={f.reverse_charge} onChange={(e) => set("reverse_charge", e.target.checked)} /><span><Term k="rcm">Reverse charge</Term>: the {kind === "sales" ? "customer" : "buyer (you)"} pays the GST</span></label>
                    {kind === "sales" && <label className="check"><input type="checkbox" checked={f.is_export} onChange={(e) => set("is_export", e.target.checked)} /><span>Export or supply to SEZ (zero rated)</span></label>}
                    {kind === "sales" && f.is_export && <label className="check"><input type="checkbox" checked={f.export_with_igst} onChange={(e) => set("export_with_igst", e.target.checked)} /><span>IGST paid on the export (otherwise under LUT, no tax)</span></label>}
                    {kind === "sales" && <Field label="Order book No." htmlFor="oref" hint="The number printed on the paper order, if you want to keep it"><input id="oref" className="input" value={f.order_ref} onChange={(e) => set("order_ref", e.target.value)} placeholder="044" /></Field>}
                    {kind === "purchase" && <Field label="Claim credit in month" htmlFor="itcp" hint="Normally the bill's month"><input id="itcp" type="month" className="input" value={f.itc_period || (f.date || "").slice(0, 7)} onChange={(e) => set("itc_period", e.target.value)} /></Field>}
                    <Field label="Notes" htmlFor="nt"><textarea id="nt" className="textarea" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
                  </div>
                )}
              </div>
              <div className="sheet-pad">
                <Leaders rows={[
                  { label: "Taxable value", value: amount(sum.taxable_value) },
                  ...(inter ? [{ label: "IGST", value: amount(sum.igst) }] : [{ label: "CGST", value: amount(sum.cgst) }, { label: "SGST", value: amount(sum.sgst) }]),
                  ...(Number(sum.cess) ? [{ label: "Cess", value: amount(sum.cess) }] : []),
                  ...(Number(sum.round_off) ? [{ label: "Round off", value: amount(sum.round_off) }] : []),
                  { label: "Total Amount Rs", value: amount(sum.total), grand: true },
                ]} />
                {kind === "sales" && calc?.section && <p className="small muted" style={{ marginTop: 10 }}>Goes to GSTR-1 as <b>{({ b2b: "B2B", b2cl: "B2C large", b2cs: "B2C", exp: "Export", cdnr: "credit/debit note (registered)", cdnur: "credit/debit note (unregistered)" } as any)[calc.section]}</b>.</p>}
                {kind === "purchase" && !isNew && (
                  <p className="small muted" style={{ marginTop: 10 }}>
                    {lines.some((l) => l.itc_reason) ? `Not claimed: ${Array.from(new Set(lines.map((l) => l.itc_reason).filter(Boolean))).join("; ")}` : ""}
                  </p>
                )}
                {kind === "purchase" && isNew && business.no_itc_scheme && <p className="small muted" style={{ marginTop: 10 }}>You charge <Term k="no_itc">5% without ITC</Term>, so GST on this bill is not claimed unless you change it per line.</p>}
              </div>
            </div>

            <div className="sheet-foot">
              <div style={{ flex: "1 1 280px" }}>
                <div className="small strong" style={{ marginBottom: 6 }}>Bill copy</div>
                <Attachments entityType={kind} entityId={isNew || amending ? undefined : Number(id)} category={kind === "sales" ? "sales_invoice" : "purchase_invoice"} queued={queued} setQueued={setQueued} readOnly={readOnly} />
              </div>
              {!readOnly && (
                <div className="btn-row">
                  {!isNew && !amending && <button type="button" className="btn danger small" onClick={() => setConfirmCancel(true)}>Cancel this bill</button>}
                  {amending && <button type="button" className="btn quiet" onClick={() => setAmending(false)}>Stop correcting</button>}
                  <button className="btn primary" disabled={busy || !f[partyKey] || !f.number}>{busy ? "Saving…" : isNew ? `Save ${isNote ? "note" : "bill"}` : amending ? "Save correction" : "Save changes"}</button>
                </div>
              )}
            </div>
          </fieldset>
        </div>
      </form>
      {!isNew && f.status === "active" && kind === "sales" && <p className="small muted" style={{ marginTop: 24 }}>Changed something by mistake? Every change is kept in the audit log in Settings.</p>}
      {readOnly && f.status === "amended" && f.amended_by && <p className="note carbon" style={{ marginTop: 20 }}>This bill was corrected. <Link to={`/sales/${f.amended_by}`}>Open the corrected bill</Link>.</p>}
      {confirmCancel && <Confirm title={`Cancel ${f.number}?`} danger okLabel="Yes, cancel the bill" onClose={() => setConfirmCancel(false)} onOk={doCancel}
        text={<p>The bill stays in the books marked cancelled and is left out of GST. {kind === "sales" ? "If the customer was billed and then the amount changed, use a credit note instead." : ""}</p>} />}
      <div className="sr" aria-live="polite">{saved ? `${label} ${saved} saved` : ""}</div>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, download } from "../lib/api";
import { useAuth } from "../lib/auth";
import { amount, date, periodLabel, today } from "../lib/format";
import { useApi, useTitle } from "../lib/hooks";
import { IBack, IDownload, ILock, ITrash } from "../components/icons";
import { Attachments } from "../components/Attachments";
import { Steps } from "../components/Steps";
import { Confirm, ErrorNote, Field, Loading, Modal, Money, StatusTag, Term, useToast } from "../components/ui";

const TABS = [
  { key: "overview", label: "Checklist" },
  { key: "gstr1", label: "GSTR-1 (sales)" },
  { key: "gstr3b", label: "GSTR-3B (tax)" },
  { key: "itc", label: "Match with GSTR-2B" },
  { key: "file", label: "File and save ARN" },
];

export function ReturnPeriod() {
  const { period = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || "overview";
  const ov = useApi<any>(`/returns/${period}`, [period]);
  useTitle(`Returns ${periodLabel(period)}`);
  if (ov.error) return <div className="page"><ErrorNote error={ov.error} retry={ov.reload} /></div>;
  if (!ov.data) return <Loading text="Adding up the month" />;
  const d = ov.data;
  return (
    <div className="page">
      <Link className="crumb" to="/returns"><IBack width={16} height={16} />All returns</Link>
      <div className="page-head">
        <div>
          <h1 className="h1">{d.label}</h1>
          <p className="lede muted">GSTR-1 due {date(d.gstr1_due)} · GSTR-3B due {date(d.gstr3b_due)} · {d.sales_count} sales, {d.purchase_count} purchase bills</p>
        </div>
        {d.locked ? <span className="stamp ok">Filed · locked</span> : d.overdue ? <span className="stamp">Late</span> : null}
      </div>
      <div className="tabs" role="tablist" aria-label="Return sections">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setSp({ tab: t.key }, { replace: true })}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "overview" && <Overview d={d} />}
        {tab === "gstr1" && <Gstr1 period={period} />}
        {tab === "gstr3b" && <Gstr3b d={d} period={period} />}
        {tab === "itc" && <Itc period={period} locked={d.locked} onChange={ov.reload} />}
        {tab === "file" && <FileTab d={d} period={period} reload={ov.reload} />}
      </div>
    </div>
  );
}

function Overview({ d }: { d: any }) {
  const errors = d.issues.filter((i: any) => i.level === "error");
  const warns = d.issues.filter((i: any) => i.level !== "error");
  return (
    <div className="month-grid">
      <section className="sheet" aria-labelledby="ck">
        <div className="sheet-head"><h2 className="h2" id="ck">Eight steps to close the month</h2></div>
        <div className="sheet-pad" style={{ paddingTop: 6, paddingBottom: 6 }}><Steps steps={d.steps} period={d.period} /></div>
      </section>
      <div className="stack" style={{ marginTop: 0 }}>
        <section className="sheet" aria-labelledby="pr">
          <div className="sheet-head"><h2 className="h2" id="pr">Problems to fix</h2>{errors.length === 0 && <span className="tag ok">None</span>}</div>
          <div className="sheet-pad">
            {d.issues.length === 0 ? <p className="muted" style={{ margin: 0 }}>Every bill has what GSTR-1 needs.</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {[...errors, ...warns].map((i: any, n: number) => (
                  <li key={n} style={{ margin: "6px 0" }}>
                    <span className={`tag ${i.level === "error" ? "bad" : "warn"}`}>{i.level === "error" ? "Fix" : "Check"}</span>{" "}
                    {i.doc_id ? <Link to={`/sales/${i.doc_id}`}>{i.message}</Link> : i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="sheet" aria-labelledby="cmp">
          <div className="sheet-head"><h2 className="h2" id="cmp">GSTR-1 against GSTR-3B</h2>
            {d.compare.every((r: any) => Number(r.difference) === 0) ? <span className="tag ok">They agree</span> : <span className="tag bad">Differences</span>}</div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
            <table className="ruled">
              <thead><tr><th scope="col"></th><th scope="col" className="num">GSTR-1</th><th scope="col" className="num">GSTR-3B</th><th scope="col" className="num">Difference</th></tr></thead>
              <tbody>{d.compare.map((r: any) => (
                <tr key={r.head}><td>{r.head}</td><td className="num"><Money v={r.gstr1} /></td><td className="num"><Money v={r.gstr3b} /></td>
                  <td className={`num ${Number(r.difference) ? "bad-ink strong" : ""}`}><Money v={r.difference} /></td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="sheet-pad small muted" style={{ paddingTop: 10 }}>Both are built from the same bills, so a difference usually comes from an amendment or a reverse charge sale.</div>
        </section>
      </div>
    </div>
  );
}

function Downloads({ period, ret }: { period: string; ret: "gstr1" | "gstr3b" }) {
  const toast = useToast();
  const go = (fmt: string) => download(`/returns/${period}/${ret}.${fmt}`, `${ret}.${fmt}`).catch((e) => toast(e.message, true));
  return (
    <div className="btn-row">
      <button className="btn primary" onClick={() => go("json")}><IDownload />JSON for the GST portal</button>
      <button className="btn quiet small" onClick={() => go("xlsx")}>Excel</button>
      <button className="btn quiet small" onClick={() => go("pdf")}>PDF</button>
      <button className="btn quiet small" onClick={() => go("csv")}>CSV</button>
    </div>
  );
}

const TAXCOLS = ["taxable_value", "igst", "cgst", "sgst", "cess"];

function Gstr1({ period }: { period: string }) {
  const { data, error } = useApi<any>(`/returns/${period}/gstr1`, [period]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const hsnTable = (rows: any[], title: string) => (
    <section className="sheet" aria-label={title}>
      <div className="sheet-head"><h3 className="h3">{title}</h3><span className="small muted">Table 12</span></div>
      {rows.length === 0 ? <div className="sheet-pad muted small">Nothing in this part.</div> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table"><table className="ruled">
          <thead><tr><th scope="col">HSN/SAC</th><th scope="col">Description</th><th scope="col">UQC</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Rate</th><th scope="col" className="num">Taxable</th><th scope="col" className="num">IGST</th><th scope="col" className="num">CGST</th><th scope="col" className="num">SGST</th></tr></thead>
          <tbody>{rows.map((h, i) => <tr key={i}><td>{h.hsn_sc}</td><td>{h.desc}</td><td>{h.uqc}</td><td className="num">{h.qty}</td><td className="num">{h.rt}%</td><td className="num">{amount(h.txval)}</td><td className="num">{amount(h.iamt)}</td><td className="num">{amount(h.camt)}</td><td className="num">{amount(h.samt)}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
  return (
    <div className="stack">
      <div className="sheet">
        <div className="sheet-head"><h2 className="h2">GSTR-1, section by section</h2><Downloads period={period} ret="gstr1" /></div>
        {data.sections.length === 0 ? <div className="empty"><h3 className="h2">No sales in this period</h3><p>A nil GSTR-1 can still be filed on the portal.</p></div> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table"><table className="ruled cards">
            <thead><tr><th scope="col">Section</th><th scope="col" className="num">Documents</th><th scope="col" className="num">Taxable value</th><th scope="col" className="num">IGST</th><th scope="col" className="num">CGST</th><th scope="col" className="num">SGST</th><th scope="col" className="num">Cess</th></tr></thead>
            <tbody>{data.sections.map((s: any) => (
              <tr key={s.key}><td className="cell-main">{s.label}</td><td className="num hide-sm">{s.count || ""}</td>{TAXCOLS.map((k, i) => <td key={k} className={`num ${i === 0 ? "cell-amt" : "hide-sm"}`}><Money v={s[k]} /></td>)}</tr>
            ))}
              {Object.values(data.nil).some((v: any) => Number(v)) && <tr><td className="cell-main">Nil rated, exempt and non-GST (8)</td><td className="hide-sm" /><td className="num cell-amt"><Money v={Number(data.nil.nil_amt) + Number(data.nil.expt_amt) + Number(data.nil.ngsup_amt)} /></td><td className="hide-sm" colSpan={4} /></tr>}
            </tbody>
          </table></div>
        )}
        <div className="sheet-foot small muted">Format {data.schema_version}. Check the JSON in the GST offline tool if the portal rejects it; the portal changes formats from time to time.</div>
      </div>
      {hsnTable(data.hsn.b2b, "HSN summary, B2B")}
      {hsnTable(data.hsn.b2c, "HSN summary, B2C")}
    </div>
  );
}

function Gstr3b({ d, period }: { d: any; period: string }) {
  const g = d.gstr3b;
  const p = g.payment;
  const heads = ["igst", "cgst", "sgst", "cess"];
  return (
    <div className="stack">
      <div className="sheet">
        <div className="sheet-head"><h2 className="h2">GSTR-3B tables</h2><Downloads period={period} ret="gstr3b" /></div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table"><table className="ruled cards">
          <thead><tr><th scope="col">Table</th><th scope="col" className="num">Taxable value</th><th scope="col" className="num">IGST</th><th scope="col" className="num">CGST</th><th scope="col" className="num">SGST</th><th scope="col" className="num">Cess</th></tr></thead>
          <tbody>{Object.entries(g.tables).map(([k, v]: [string, any]) => (
            <tr key={k}><td className="cell-main">{k}</td>
              <td className="num hide-sm">{v.txval !== undefined ? <Money v={v.txval} /> : ""}</td>
              {heads.map((h) => <td key={h} className="num hide-sm">{v[h] !== undefined ? <Money v={v[h]} /> : ""}</td>)}
              <td className="cell-amt" style={{ display: "none" }} />
            </tr>
          ))}</tbody>
        </table></div>
        {Number(g.tables["4B(1) ITC reversed: rules 38, 42, 43 and section 17(5)"].cgst) + Number(g.tables["4B(1) ITC reversed: rules 38, 42, 43 and section 17(5)"].igst) > 0 && (
          <div className="sheet-foot small" style={{ display: "block" }}>GST on purchase bills is shown in 4A as the portal lists it, and the part you cannot claim (5% without ITC, blocked items, reversals) is taken back in 4B(1). Only 4C is credit you actually use.</div>
        )}
        {g.notes.length > 0 && <div className="sheet-foot" style={{ display: "block" }}>{g.notes.map((n: string, i: number) => <p key={i} className="small" style={{ margin: "2px 0" }}>{n}</p>)}</div>}
      </div>
      <div className="sheet">
        <div className="sheet-head"><h2 className="h2">6.1 How the tax is paid</h2><span className="figure-big" style={{ fontSize: 28 }}><Money v={p.cash_total} /></span></div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table"><table className="ruled">
          <thead><tr><th scope="col">Tax</th><th scope="col" className="num">Payable</th><th scope="col" className="num">From IGST credit</th><th scope="col" className="num">From CGST credit</th><th scope="col" className="num">From SGST credit</th><th scope="col" className="num">In cash</th></tr></thead>
          <tbody>{heads.map((h) => (
            <tr key={h}><td>{h.toUpperCase()}</td><td className="num"><Money v={p.liability[h]} /></td>
              <td className="num"><Money v={p.itc_used.igst?.[h] || 0} /></td><td className="num"><Money v={p.itc_used.cgst?.[h] || 0} /></td><td className="num"><Money v={p.itc_used.sgst?.[h] || p.itc_used.cess?.[h] || 0} /></td>
              <td className="num strong"><Money v={p.cash[h]} /></td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={5}>Interest and late fee</td><td className="num"><Money v={Number(p.interest) + Number(p.late_fee)} /></td></tr></tfoot>
        </table></div>
        <div className="sheet-foot small muted" style={{ display: "block" }}>
          Credit is used in the order the law sets: IGST credit first, then CGST and SGST. CGST credit cannot pay SGST. Tax on reverse charge purchases is always paid in cash.
          {Object.values(p.closing_credit).some((v: any) => Number(v) > 0) && <> Credit left over for next month: <b><Money v={Object.values(p.closing_credit).reduce((a: number, b: any) => a + Number(b), 0)} /></b>.</>}
        </div>
      </div>
      {g.deferred_docs.length > 0 && (
        <div className="note warn"><p><b>Credit held back:</b> {g.deferred_docs.length} bill(s) are not in GSTR-2B yet, so their GST is not claimed this month: {g.deferred_docs.map((x: any) => `${x.number} (${x.supplier})`).join(", ")}. Ask the supplier to file, then claim it in a later month.</p></div>
      )}
    </div>
  );
}

const RULES: Record<string, string> = { rule42: "Rule 42: inputs used for exempt and taxable supplies", rule43: "Rule 43: capital goods", sec17_5: "Section 17(5): blocked credit", rule37: "Rule 37: supplier not paid in 180 days", others: "Other" };

function Itc({ period, locked, onChange }: { period: string; locked: boolean; onChange: () => void }) {
  const recon = useApi<any>(`/itc/recon/${period}`, [period]);
  const adj = useApi<any[]>(`/itc/adjustments?period=${period}`, [period]);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  if (recon.error) return <ErrorNote error={recon.error} />;
  if (!recon.data) return <Loading text="Matching bills" />;
  const r = recon.data;
  const L: Record<string, string> = { matched: "Matched", probable: "Probably matched", mismatch: "Amounts differ", missing_in_2b: "Not in GSTR-2B", missing_in_books: "Not in your books" };
  const rows = r.rows.filter((x: any) => !filter || x.status === filter);
  return (
    <div className="stack">
      {!r.has_2b ? (
        <div className="note carbon">
          <p><b>Import this month's <Term k="gstr2b">GSTR-2B</Term> to check your credit.</b> On the GST portal open Returns, GSTR-2B, choose {periodLabel(period)} and download the JSON or Excel. Then bring it in here. Until then, credit is taken from your bills as entered.</p>
          <Link className="btn primary small" to={`/import?kind=gstr2b&period=${period}`}>Import GSTR-2B</Link>
        </div>
      ) : (
        <div className="sheet">
          <div className="sheet-head">
            <h2 className="h2">Your bills against GSTR-2B</h2>
            <Link className="linkbtn small" to={`/import?kind=gstr2b&period=${period}`}>Import a newer GSTR-2B</Link>
          </div>
          <div className="sheet-pad btn-row" style={{ gap: 8 }}>
            <button className={`btn small ${filter ? "quiet" : ""}`} aria-pressed={!filter} onClick={() => setFilter("")}>All {r.rows.length}</button>
            {Object.entries(r.summary).map(([k, v]: [string, any]) => v.count > 0 && (
              <button key={k} className={`btn small ${filter === k ? "" : "quiet"}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{L[k]} {v.count}</button>
            ))}
          </div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table"><table className="ruled cards">
            <thead><tr><th scope="col">Supplier</th><th scope="col">Bill No.</th><th scope="col">Status</th><th scope="col" className="num">GST in books</th><th scope="col" className="num">GST in 2B</th><th scope="col">What to do</th></tr></thead>
            <tbody>{rows.map((x: any, i: number) => (
              <tr key={i}>
                <td className="cell-main">{x.supplier_name || x.supplier_gstin}<div className="tiny muted">{x.supplier_gstin}</div></td>
                <td className="hide-sm">{x.purchase_id ? <Link to={`/purchases/${x.purchase_id}`}>{x.number}</Link> : x.portal_number}{x.number && x.portal_number && x.number !== x.portal_number ? <div className="tiny muted">2B: {x.portal_number}</div> : null}</td>
                <td className="cell-main"><StatusTag s={x.status} /></td>
                <td className="num hide-sm">{x.books_tax !== null ? <Money v={x.books_tax} /> : ""}</td>
                <td className="num cell-amt">{x.portal_tax !== null ? <Money v={x.portal_tax} /> : ""}</td>
                <td className="small hide-sm">{x.status === "missing_in_2b" ? "Ask the supplier to file their GSTR-1. Credit waits until it shows." : x.note}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div className="sheet">
        <div className="sheet-head"><h2 className="h2">Credit reversed or reclaimed</h2>{!locked && <button className="btn small" onClick={() => setAdding(true)}>Add an adjustment</button>}</div>
        {adj.data && adj.data.length === 0 && <div className="sheet-pad muted small">None this period. Your accountant may ask for a reversal under rule 42 or 43, or when a supplier is not paid within 180 days.</div>}
        {adj.data && adj.data.length > 0 && (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table"><table className="ruled">
            <thead><tr><th scope="col">Type</th><th scope="col">Reason</th><th scope="col" className="num">IGST</th><th scope="col" className="num">CGST</th><th scope="col" className="num">SGST</th><th scope="col">Note</th><th scope="col"><span className="sr">Remove</span></th></tr></thead>
            <tbody>{adj.data.map((a) => (
              <tr key={a.id}><td>{a.kind === "reversal" ? "Reversal" : "Reclaim"}</td><td>{RULES[a.rule] || a.rule}</td><td className="num"><Money v={a.igst} /></td><td className="num"><Money v={a.cgst} /></td><td className="num"><Money v={a.sgst} /></td><td>{a.note}</td>
                <td>{!locked && <button className="iconbtn" aria-label="Remove adjustment" onClick={async () => { try { await api(`/itc/adjustments/${a.id}`, { method: "DELETE" }); adj.reload(); onChange(); } catch (e) { toast((e as Error).message, true); } }}><ITrash /></button>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {adding && <AdjModal period={period} onClose={() => setAdding(false)} onDone={() => { setAdding(false); adj.reload(); onChange(); }} />}
    </div>
  );
}

function AdjModal({ period, onClose, onDone }: { period: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ kind: "reversal", rule: "rule42", igst: "", cgst: "", sgst: "", cess: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    try {
      await api("/itc/adjustments", { body: { ...f, period, igst: f.igst || 0, cgst: f.cgst || 0, sgst: f.sgst || 0, cess: f.cess || 0 } });
      onDone();
    } catch (x) { setErr((x as Error).message); }
  };
  return (
    <Modal title="Adjust input tax credit" onClose={onClose} foot={<><button className="btn quiet" onClick={onClose}>Close</button><button className="btn primary" onClick={() => submit()}>Save</button></>}>
      <form onSubmit={submit} className="form-grid">
        <Field className="col-6" label="Type" htmlFor="ak"><select id="ak" className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="reversal">Reverse credit (reduce)</option><option value="reclaim">Reclaim earlier reversal</option></select></Field>
        <Field className="col-6" label="Reason" htmlFor="ar"><select id="ar" className="select" value={f.rule} onChange={(e) => setF({ ...f, rule: e.target.value })}>{Object.entries(RULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {["igst", "cgst", "sgst", "cess"].map((h) => <Field key={h} className="col-3" label={h.toUpperCase()} htmlFor={`a-${h}`}><input id={`a-${h}`} className="input right" inputMode="decimal" value={(f as any)[h]} onChange={(e) => setF({ ...f, [h]: e.target.value })} placeholder="0.00" /></Field>)}
        <Field className="col-12" label="Note" htmlFor="an" error={err}><input id="an" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="As advised by the accountant" /></Field>
        <button type="submit" className="sr">Save</button>
      </form>
    </Modal>
  );
}

function FileTab({ d, period, reload }: { d: any; period: string; reload: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const rp = d.period_record;
  const owner = user?.role === "owner";
  const [filed, setFiled] = useState<null | "gstr1" | "gstr3b">(null);
  const [unlock, setUnlock] = useState(false);
  const [reason, setReason] = useState("");
  const [pay, setPay] = useState(() => ({ paid_igst: rp?.paid_igst || "", paid_cgst: rp?.paid_cgst || "", paid_sgst: rp?.paid_sgst || "", paid_cess: rp?.paid_cess || "", interest: rp?.interest || "", late_fee: rp?.late_fee || "", challan_ref: rp?.challan_ref || "", paid_on: rp?.paid_on || "" }));
  const approve = async () => {
    try { await api(`/returns/${period}/approve`, { method: "POST" }); toast("Approved. Now file on the GST portal"); reload(); } catch (e) { toast((e as Error).message, true); }
  };
  const savePay = async (e: FormEvent) => {
    e.preventDefault();
    const b: any = { ...pay };
    for (const k of ["paid_igst", "paid_cgst", "paid_sgst", "paid_cess", "interest", "late_fee"]) b[k] = b[k] || 0;
    b.paid_on = b.paid_on || null;
    try { await api(`/returns/${period}/payment`, { body: b }); toast("Payment saved"); reload(); } catch (x) { toast((x as Error).message, true); }
  };
  const cash = d.gstr3b.payment.cash;
  return (
    <div className="stack">
      {d.locked && (
        <div className="note ok">
          <p><b>Both returns are filed and this period is locked.</b> Bills dated in it cannot be changed. To correct a sale, open it and save a correction; it goes into the current month as an amendment.</p>
          {owner && <button className="linkbtn" onClick={() => setUnlock(true)}><ILock width={14} height={14} style={{ display: "inline" }} /> Unlock this period</button>}
        </div>
      )}
      <div className="sheet"><div className="sheet-pad" style={{ paddingTop: 8, paddingBottom: 8, overflow: "hidden" }}><ol className="steps">
        <li className={rp?.approved_at ? "done" : "next"}>
          <span className="box">1</span>
          <span><b>Owner approves the figures</b><small>{rp?.approved_at ? `Approved ${date(rp.approved_at)}` : "Check the GSTR-1 and GSTR-3B tabs first. Problems marked Fix must be cleared."}</small></span>
          {!rp?.approved_at && (owner ? <button className="btn small primary" onClick={approve}>Approve</button> : <span className="tag">Owner only</span>)}
        </li>
        <li className={d.gstr1_status === "filed" ? "done" : ""}>
          <span className="box">2</span>
          <span><b>Upload GSTR-1 on the portal</b><small>gst.gov.in, Returns Dashboard, {periodLabel(period)}, GSTR-1, Prepare offline, Upload the JSON. Then file with EVC or DSC.</small></span>
          <button className="btn small quiet" onClick={() => download(`/returns/${period}/gstr1.json`, "gstr1.json").catch((e) => toast(e.message, true))}><IDownload />JSON</button>
        </li>
        <li className={rp?.paid_on ? "done" : ""}>
          <span className="box">3</span>
          <span><b>Pay the tax</b><small>Create a challan (PMT-06) for IGST <Money v={cash.igst} />, CGST <Money v={cash.cgst} />, SGST <Money v={cash.sgst} />, then record it below.</small></span>
          <span />
        </li>
        <li className={d.gstr3b_status === "filed" ? "done" : ""}>
          <span className="box">4</span>
          <span><b>File GSTR-3B</b><small>Enter the figures from the GSTR-3B tab (or upload its JSON in the offline tool), offset the liability, file.</small></span>
          <button className="btn small quiet" onClick={() => download(`/returns/${period}/gstr3b.pdf`, "gstr3b.pdf").catch((e) => toast(e.message, true))}><IDownload />PDF</button>
        </li>
      </ol></div></div>
      {!d.gsp?.configured && <p className="small muted">Direct filing from this app is off: it needs a contract with a licensed GST Suvidha Provider. Filing through the portal works the same.</p>}

      <div className="grid-2">
        <form className="sheet" onSubmit={savePay} aria-labelledby="payh">
          <div className="sheet-head"><h2 className="h2" id="payh">Tax paid</h2></div>
          <fieldset disabled={d.locked} className="sheet-pad form-grid" style={{ border: 0, margin: 0 }}>
            {["paid_igst", "paid_cgst", "paid_sgst", "paid_cess", "interest", "late_fee"].map((k) => (
              <Field key={k} className="col-4" label={{ paid_igst: "IGST", paid_cgst: "CGST", paid_sgst: "SGST", paid_cess: "Cess", interest: "Interest", late_fee: "Late fee" }[k]!} htmlFor={k}>
                <input id={k} className="input right" inputMode="decimal" value={(pay as any)[k]} onChange={(e) => setPay({ ...pay, [k]: e.target.value })} placeholder="0.00" />
              </Field>
            ))}
            <Field className="col-6" label="Challan CPIN / CIN" htmlFor="ch"><input id="ch" className="input" value={pay.challan_ref} onChange={(e) => setPay({ ...pay, challan_ref: e.target.value })} /></Field>
            <Field className="col-6" label="Paid on" htmlFor="po"><input id="po" type="date" className="input" value={pay.paid_on || ""} max={today()} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} /></Field>
            <div className="col-12"><button className="btn">Save payment</button></div>
          </fieldset>
        </form>
        <section className="sheet" aria-labelledby="arnh">
          <div className="sheet-head"><h2 className="h2" id="arnh">Filed returns and <Term k="arn">ARN</Term></h2></div>
          <div className="sheet-pad stack">
            {(["gstr1", "gstr3b"] as const).map((r) => (
              <div key={r} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div><b>{r === "gstr1" ? "GSTR-1" : "GSTR-3B"}</b> <StatusTag s={d[`${r}_status`]} />
                  {d[`${r}_arn`] && <div className="small">ARN {d[`${r}_arn`]} · {date(d[`${r}_filed_on`])}</div>}</div>
                {d[`${r}_status`] !== "filed" && <button className="btn small" disabled={!rp?.approved_at} onClick={() => setFiled(r)}>Save ARN</button>}
              </div>
            ))}
            <hr className="rule" />
            <div className="small strong">Acknowledgements and challans</div>
            {rp ? <Attachments entityType="return" entityId={rp.id} category="acknowledgement" readOnly={!owner && d.locked} /> : <p className="small muted">You can attach the portal's acknowledgement after approving.</p>}
          </div>
        </section>
      </div>
      {filed && <FiledModal ret={filed} period={period} onClose={() => setFiled(null)} onDone={() => { setFiled(null); reload(); }} />}
      {unlock && (
        <Confirm title="Unlock a filed period?" danger okLabel="Unlock" onClose={() => setUnlock(false)}
          onOk={async () => { try { await api(`/returns/${period}/unlock`, { body: { reason } }); setUnlock(false); reload(); } catch (e) { toast((e as Error).message, true); } }}
          text={<><p>Filed returns cannot be changed on the portal. Unlock only if your accountant asks, for example to fix a typo in your own records. The reason is kept in the audit log.</p>
            <Field label="Reason" htmlFor="ur"><input id="ur" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></>} />
      )}
    </div>
  );
}

function FiledModal({ ret, period, onClose, onDone }: { ret: string; period: string; onClose: () => void; onDone: () => void }) {
  const [arn, setArn] = useState("");
  const [on, setOn] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { await api(`/returns/${period}/filed`, { body: { ret, arn, filed_on: on } }); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={`${ret === "gstr1" ? "GSTR-1" : "GSTR-3B"} filed`} onClose={onClose} foot={<><button className="btn quiet" onClick={onClose}>Close</button><button className="btn primary" onClick={save} disabled={!arn}>Save</button></>}>
      <div className="stack">
        <p className="muted">After filing, the portal shows an ARN like AA3311260123456. Copy it here as proof of filing. When both returns are saved, the period locks.</p>
        <Field label="ARN" htmlFor="arn" error={err}><input id="arn" className="input" value={arn} onChange={(e) => setArn(e.target.value.toUpperCase().trim())} maxLength={20} autoComplete="off" /></Field>
        <Field label="Filed on" htmlFor="fon"><input id="fon" type="date" className="input" value={on} max={today()} onChange={(e) => setOn(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, download } from "../lib/api";
import { useAuth } from "../lib/auth";
import { KIND_LABEL, dateTime } from "../lib/format";
import { gstinProblem } from "../lib/gstin";
import { useApi, useDebounced, useTitle } from "../lib/hooks";
import { IDownload, IPlus, ISearch } from "../components/icons";
import { ErrorNote, Field, Loading, Modal, Seg, Term, useToast } from "../components/ui";

const TABS = [
  { key: "business", label: "Business & GST" },
  { key: "rates", label: "Tax rates" },
  { key: "hsn", label: "HSN / SAC codes" },
  { key: "users", label: "Users", owner: true },
  { key: "audit", label: "Audit log", owner: true },
  { key: "account", label: "My account" },
];

export function Settings() {
  useTitle("Settings");
  const { user } = useAuth();
  const owner = user?.role === "owner";
  const [sp, setSp] = useSearchParams();
  const tabs = TABS.filter((t) => !t.owner || owner);
  const tab = tabs.find((t) => t.key === sp.get("tab"))?.key || "business";
  const pick = (k: string) => setSp((p) => { const n = new URLSearchParams(p); n.set("tab", k); n.delete("page"); return n; }, { replace: true });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">Settings</h1>
          <p className="lede muted">Your business details, GST rates and codes, and who can use the book.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-controls={`panel-${t.key}`} aria-selected={tab === t.key} onClick={() => pick(t.key)}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "business" && <Business />}
        {tab === "rates" && <Rates />}
        {tab === "hsn" && <Hsn />}
        {tab === "users" && owner && <Users />}
        {tab === "audit" && owner && <Audit />}
        {tab === "account" && <Account />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ copyable link */
function LinkBox({ token, id }: { token: string; id: string }) {
  const toast = useToast();
  const link = `${location.origin}/reset?token=${encodeURIComponent(token)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast("Link copied"); }
    catch { (document.getElementById(id) as HTMLInputElement | null)?.select(); toast("Select the link and copy it", true); }
  };
  return (
    <div className="stack">
      <Field label="Link to send" htmlFor={id} hint="Send this link on WhatsApp. It works once. The person opens it and chooses their own password.">
        <input id={id} className="input boxed" readOnly value={link} onFocus={(e) => e.target.select()} />
      </Field>
      <div className="btn-row"><button type="button" className="btn primary small" onClick={copy}>Copy link</button></div>
    </div>
  );
}

/* ------------------------------------------------------------------ business */
const BLANK_BIZ = {
  legal_name: "", trade_name: "", gstin: "", pan: "", address: "", state_code: "33", jurisdiction: "", registration_type: "regular",
  filing_frequency: "monthly", fy_start_year: 2026, phone: "", email: "", proprietor: "", invoice_prefix: "", b2cl_limit: "100000",
  no_itc_scheme: true, round_off: true, default_price_mode: "exclusive",
};
type Biz = typeof BLANK_BIZ;

function Business() {
  const { user, meta, business, reloadMeta } = useAuth();
  const toast = useToast();
  const owner = user?.role === "owner";
  const [f, setF] = useState<Biz>(BLANK_BIZ);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (business) setF(Object.fromEntries(Object.keys(BLANK_BIZ).map((k) => [k, business[k] ?? (BLANK_BIZ as any)[k]])) as Biz);
  }, [business]);
  if (!meta || !business) return <Loading />;
  const set = <K extends keyof Biz>(k: K, v: Biz[K]) => setF((x) => ({ ...x, [k]: v }));
  const codes = meta.states.map((s) => s.code);
  const gErr = gstinProblem(f.gstin, codes);
  const stateMismatch = !gErr && f.gstin.trim().length === 15 && f.gstin.trim().slice(0, 2) !== f.state_code;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (gErr) { toast(gErr, true); return; }
    setBusy(true);
    try {
      await api("/business", { method: "PUT", body: { ...f, gstin: f.gstin.trim().toUpperCase(), fy_start_year: Number(f.fy_start_year) || 2026, b2cl_limit: f.b2cl_limit || "0" } });
      await reloadMeta();
      toast("Business details saved");
    } catch (err) { toast((err as Error).message, true); }
    finally { setBusy(false); }
  };
  const ro = !owner;
  return (
    <form className="sheet" onSubmit={save} aria-labelledby="biz-h">
      <div className="sheet-head"><h2 className="h2" id="biz-h">Business and GST details</h2></div>
      <div className="sheet-pad">
        {ro && <div className="note carbon" style={{ marginBottom: 18 }}><p>Only the owner can change these details. You can read them here.</p></div>}
        <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="form-grid">
            <Field className="col-6" label="Legal name" htmlFor="b-legal" hint="As on your GST certificate"><input id="b-legal" className="input" value={f.legal_name} onChange={(e) => set("legal_name", e.target.value)} /></Field>
            <Field className="col-6" label="Trade name" htmlFor="b-trade" hint="The name printed on your bills"><input id="b-trade" className="input" value={f.trade_name} onChange={(e) => set("trade_name", e.target.value)} /></Field>
            <Field className="col-6" label="GSTIN" htmlFor="b-gstin" term="gstin" error={gErr || (stateMismatch ? "The state below does not match the first two digits" : null)}>
              <input id="b-gstin" className="input" value={f.gstin} maxLength={15} autoCapitalize="characters" spellCheck={false} aria-invalid={!!gErr}
                onChange={(e) => {
                  const g = e.target.value.toUpperCase();
                  setF((x) => ({ ...x, gstin: g, state_code: g.length >= 2 && codes.includes(g.slice(0, 2)) ? g.slice(0, 2) : x.state_code, pan: g.length === 15 && !x.pan ? g.slice(2, 12) : x.pan }));
                }} />
            </Field>
            <Field className="col-6" label="PAN" htmlFor="b-pan" hint="Filled from the GSTIN if left empty"><input id="b-pan" className="input" value={f.pan} maxLength={10} onChange={(e) => set("pan", e.target.value.toUpperCase())} /></Field>
            <Field className="col-12" label="Address" htmlFor="b-addr"><textarea id="b-addr" className="textarea" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field className="col-6" label="State" htmlFor="b-state">
              <select id="b-state" className="select" value={f.state_code} onChange={(e) => set("state_code", e.target.value)}>
                {meta.states.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}
              </select>
            </Field>
            <Field className="col-6" label="Jurisdiction" htmlFor="b-jur" hint="Shown on bills, for example Chennai"><input id="b-jur" className="input" value={f.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)} /></Field>
            <Field className="col-6" label="Registration type" htmlFor="b-reg">
              <select id="b-reg" className="select" value={f.registration_type} onChange={(e) => set("registration_type", e.target.value)}>
                <option value="regular">Regular</option><option value="composition">Composition</option>
              </select>
            </Field>
            <div className="field col-6">
              <span className="label" id="b-freq">How often you file returns</span>
              <Seg label="How often you file returns" value={f.filing_frequency as "monthly" | "quarterly"} onChange={(v) => set("filing_frequency", v)}
                options={[{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }]} />
            </div>
            <Field className="col-4" label="Financial year starts" htmlFor="b-fy" hint="The year of April, for example 2026"><input id="b-fy" className="input" inputMode="numeric" value={f.fy_start_year} onChange={(e) => set("fy_start_year", e.target.value.replace(/\D/g, "") as unknown as number)} /></Field>
            <Field className="col-4" label="Phone" htmlFor="b-phone"><input id="b-phone" className="input" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field className="col-4" label="Email" htmlFor="b-email"><input id="b-email" className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
            <Field className="col-4" label="Proprietor" htmlFor="b-prop"><input id="b-prop" className="input" value={f.proprietor} onChange={(e) => set("proprietor", e.target.value)} /></Field>
            <Field className="col-4" label="Bill number prefix" htmlFor="b-prefix" hint="For example DC/26-27/"><input id="b-prefix" className="input" value={f.invoice_prefix} onChange={(e) => set("invoice_prefix", e.target.value)} /></Field>
            <Field className="col-4" label="B2C large limit" htmlFor="b-b2cl" term="b2cl" hint="Bills above this to other states without GSTIN are listed one by one"><input id="b-b2cl" className="input" inputMode="decimal" value={f.b2cl_limit} onChange={(e) => set("b2cl_limit", e.target.value)} /></Field>
            <div className="field col-6">
              <span className="label">Prices on new bills</span>
              <Seg label="Prices on new bills" value={f.default_price_mode as "exclusive" | "inclusive"} onChange={(v) => set("default_price_mode", v)}
                options={[{ value: "exclusive", label: "Before GST" }, { value: "inclusive", label: "Including GST" }]} />
            </div>
            <div className="col-6">
              <label className="check"><input type="checkbox" checked={f.no_itc_scheme} onChange={(e) => set("no_itc_scheme", e.target.checked)} /><span>I charge <Term k="no_itc">5% without ITC</Term> on catering</span></label>
              <label className="check"><input type="checkbox" checked={f.round_off} onChange={(e) => set("round_off", e.target.checked)} /><span>Round bill totals to the nearest rupee</span></label>
            </div>
          </div>
        </fieldset>
      </div>
      {owner && <div className="sheet-foot"><span className="small muted">Changes apply to new bills. Bills already written keep their details.</span><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save details"}</button></div>}
    </form>
  );
}

/* ------------------------------------------------------------------ tax rates */
function Rates() {
  const { user, meta, reloadMeta } = useAuth();
  const toast = useToast();
  const owner = user?.role === "owner";
  const [rate, setRate] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  if (!meta) return <Loading />;
  const toggle = async (r: { id: number; label: string; active: boolean; rate: string }) => {
    try { await api(`/tax-rates/${r.id}`, { method: "PUT", body: { rate: r.rate, label: r.label, active: !r.active } }); await reloadMeta(); }
    catch (e) { toast((e as Error).message, true); }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await api("/tax-rates", { body: { rate, label, active: true } }); setRate(""); setLabel(""); await reloadMeta(); toast("Rate added"); }
    catch (err) { toast((err as Error).message, true); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div className="note carbon" style={{ marginBottom: 20 }}><p>Rates are set by GST law. Change them only when your accountant tells you.</p></div>
      <section className="sheet" aria-labelledby="rates-h">
        <div className="sheet-head"><h2 className="h2" id="rates-h">GST rates</h2></div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
          <table className="ruled cards">
            <thead><tr><th scope="col">Rate</th><th scope="col">Label</th><th scope="col">In use</th></tr></thead>
            <tbody>
              {meta.rates.map((r) => (
                <tr key={r.id}>
                  <td className="cell-main num"><b>{Number(r.rate)}%</b></td>
                  <td className="hide-sm">{r.label || <span className="muted">No label</span>}</td>
                  <td className="cell-amt">
                    {owner ? <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={r.active} onChange={() => toggle(r)} /><span>{r.active ? "Shown on bills" : "Hidden"}</span></label>
                      : <span className={`tag ${r.active ? "ok" : ""}`}>{r.active ? "Shown on bills" : "Hidden"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {owner && (
        <form className="sheet" onSubmit={add} aria-labelledby="addrate-h">
          <div className="sheet-head"><h2 className="h2" id="addrate-h">Add a rate</h2></div>
          <div className="sheet-pad form-grid">
            <Field className="col-4" label="Rate in %" htmlFor="r-rate"><input id="r-rate" className="input" inputMode="decimal" required value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <Field className="col-8" label="Label" htmlFor="r-label" hint="Optional, for example Restaurant service"><input id="r-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          </div>
          <div className="sheet-foot"><span /><button className="btn primary" disabled={busy || !rate}><IPlus />Add rate</button></div>
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ HSN / SAC */
type HsnRow = { id?: number; code: string; description: string; is_service: boolean; default_rate: string; supply_kind: string; uqc: string; itc_allowed: boolean; notes: string; active: boolean };
const BLANK_HSN: HsnRow = { code: "", description: "", is_service: true, default_rate: "5", supply_kind: "taxable", uqc: "NA", itc_allowed: false, notes: "", active: true };

function Hsn() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const list = useApi<HsnRow[]>(`/hsn?q=${encodeURIComponent(dq.trim())}`, [dq]);
  const [edit, setEdit] = useState<HsnRow | null>(null);
  return (
    <div>
      <div className="toolbar">
        <div className="field grow">
          <label htmlFor="hsn-q">Search codes</label>
          <div className="search"><ISearch /><input id="hsn-q" className="input boxed" placeholder="Code or description" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <button className="btn primary" onClick={() => setEdit({ ...BLANK_HSN })}><IPlus />Add code</button>
      </div>
      {list.error ? <ErrorNote error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : (
        <section className="sheet">
          {list.data.length === 0 ? (
            <div className="empty"><h2 className="h2">{dq ? "No codes match" : "No codes yet"}</h2><p>Add the HSN or SAC codes you use on bills. Outdoor catering is usually SAC 996334.</p></div>
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
              <table className="ruled cards">
                <thead><tr><th scope="col">Code</th><th scope="col">Description</th><th scope="col">Rate</th><th scope="col">Supply type</th><th scope="col">Unit</th><th scope="col">Notes</th><th scope="col"><span className="sr">Edit</span></th></tr></thead>
                <tbody>
                  {list.data.map((h) => (
                    <tr key={h.id}>
                      <td className="cell-main"><b className="num">{h.code}</b>{!h.active && <> <span className="tag">Not in use</span></>}</td>
                      <td className="cell-main">{h.description}</td>
                      <td className="cell-amt num">{Number(h.default_rate)}%</td>
                      <td className="hide-sm">{KIND_LABEL[h.supply_kind] || h.supply_kind}</td>
                      <td className="hide-sm">{h.uqc}</td>
                      <td className="hide-sm small muted">{h.notes}</td>
                      <td className="hide-sm"><button className="linkbtn" onClick={() => setEdit({ ...h, default_rate: String(Number(h.default_rate)) })} aria-label={`Edit ${h.code}`}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {edit && <HsnModal row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

function HsnModal({ row, onClose, onSaved }: { row: HsnRow; onClose: () => void; onSaved: () => void }) {
  const { meta } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<HsnRow>(row);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof HsnRow>(k: K, v: HsnRow[K]) => setF((x) => ({ ...x, [k]: v }));
  const codeErr = f.code && !/^(\d{4}|\d{6}|\d{8})$/.test(f.code.trim()) ? "Use 4, 6 or 8 digits" : null;
  const save = async () => {
    setBusy(true);
    try {
      const { id, ...body } = f;
      await api(id ? `/hsn/${id}` : "/hsn", { method: id ? "PUT" : "POST", body: { ...body, code: f.code.trim() } });
      toast(id ? "Code updated" : "Code added");
      onSaved();
    } catch (e) { toast((e as Error).message, true); }
    finally { setBusy(false); }
  };
  const rates = meta?.rates || [];
  return (
    <Modal title={row.id ? `Edit ${row.code}` : "Add an HSN or SAC code"} onClose={onClose} foot={<>
      <button className="btn quiet" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.code || !!codeErr || !f.description.trim()} onClick={save}>{busy ? "Saving…" : "Save code"}</button>
    </>}>
      <div className="form-grid">
        <Field className="col-6" label="Code" htmlFor="h-code" error={codeErr} term="hsn"><input id="h-code" className="input" inputMode="numeric" value={f.code} onChange={(e) => set("code", e.target.value.replace(/\D/g, ""))} /></Field>
        <Field className="col-6" label="Goods or service" htmlFor="h-svc">
          <select id="h-svc" className="select" value={f.is_service ? "s" : "g"} onChange={(e) => set("is_service", e.target.value === "s")}>
            <option value="s">Service (SAC)</option><option value="g">Goods (HSN)</option>
          </select>
        </Field>
        <Field className="col-12" label="Description" htmlFor="h-desc"><input id="h-desc" className="input" value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field className="col-4" label="Default rate" htmlFor="h-rate">
          <select id="h-rate" className="select" value={f.default_rate} onChange={(e) => set("default_rate", e.target.value)}>
            {rates.map((r) => <option key={r.id} value={String(Number(r.rate))}>{Number(r.rate)}%</option>)}
          </select>
        </Field>
        <Field className="col-4" label="Supply type" htmlFor="h-kind">
          <select id="h-kind" className="select" value={f.supply_kind} onChange={(e) => set("supply_kind", e.target.value)}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field className="col-4" label="Unit (UQC)" htmlFor="h-uqc">
          <select id="h-uqc" className="select" value={f.uqc} onChange={(e) => set("uqc", e.target.value)}>
            {(meta?.uqc || ["NA"]).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field className="col-12" label="Notes" htmlFor="h-notes"><textarea id="h-notes" className="textarea" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <div className="col-12">
          <label className="check"><input type="checkbox" checked={f.itc_allowed} onChange={(e) => set("itc_allowed", e.target.checked)} /><span>Input tax credit can be claimed on this</span></label>
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /><span>In use (shown when writing bills)</span></label>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ users */
type U = { id: number; email: string; name: string; role: "owner" | "accountant"; is_active: boolean; must_change_password: boolean };

function Users() {
  const { user } = useAuth();
  const toast = useToast();
  const users = useApi<U[]>("/users");
  const history = useApi<any[]>("/users/login-history");
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState<{ title: string; token: string } | null>(null);
  const patch = async (u: U, body: Partial<U>) => {
    try { await api(`/users/${u.id}`, { method: "PATCH", body }); users.reload(); toast("Saved"); }
    catch (e) { toast((e as Error).message, true); }
  };
  const resetLink = async (u: U) => {
    try { const r = await api<{ token: string }>(`/users/${u.id}/reset-link`, { method: "POST" }); setLink({ title: `Password reset link for ${u.name || u.email}`, token: r.token }); }
    catch (e) { toast((e as Error).message, true); }
  };
  return (
    <div>
      <section className="sheet" aria-labelledby="users-h">
        <div className="sheet-head">
          <h2 className="h2" id="users-h">People who can use the book</h2>
          <button className="btn primary small" onClick={() => setAdding(true)}><IPlus />Add a person</button>
        </div>
        {users.error ? <div className="sheet-pad"><ErrorNote error={users.error} retry={users.reload} /></div> : !users.data ? <Loading /> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
            <table className="ruled cards">
              <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {users.data.map((u) => {
                  const me = u.id === user?.id;
                  return (
                    <tr key={u.id}>
                      <td className="cell-main"><b>{u.name || u.email}</b>{me && <span className="tiny muted"> (you)</span>}<div className="tiny muted">{u.email}</div></td>
                      <td className="cell-main">
                        <label className="sr" htmlFor={`role-${u.id}`}>Role for {u.email}</label>
                        <select id={`role-${u.id}`} className="select" value={u.role} disabled={me} onChange={(e) => patch(u, { role: e.target.value as U["role"] })}>
                          <option value="owner">Owner</option><option value="accountant">Accountant</option>
                        </select>
                      </td>
                      <td className="cell-amt">
                        <span className={`tag ${u.is_active ? "ok" : "bad"}`}>{u.is_active ? "Active" : "Switched off"}</span>
                        {u.is_active && u.must_change_password && <div className="tiny muted">Has not set a password yet</div>}
                      </td>
                      <td>
                        <div className="btn-row" style={{ gap: 8 }}>
                          {!me && <button className="btn quiet small" onClick={() => patch(u, { is_active: !u.is_active })}>{u.is_active ? "Switch off" : "Switch on"}</button>}
                          <button className="btn quiet small" onClick={() => resetLink(u)}>Password reset link</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="sheet-foot"><span className="small muted">The owner can change settings and see this page. An accountant can write bills and prepare returns.</span></div>
      </section>

      <section className="sheet" aria-labelledby="hist-h">
        <div className="sheet-head"><h2 className="h2" id="hist-h">Sign-in history</h2><span className="small muted">Latest 200</span></div>
        {history.error ? <div className="sheet-pad"><ErrorNote error={history.error} retry={history.reload} /></div> : !history.data ? <Loading /> : history.data.length === 0 ? <div className="empty"><p>No sign-ins recorded yet.</p></div> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
            <table className="ruled cards">
              <thead><tr><th scope="col">Time</th><th scope="col">Email</th><th scope="col">Result</th><th scope="col">Event</th><th scope="col">IP address</th></tr></thead>
              <tbody>
                {history.data.map((h, i) => (
                  <tr key={i}>
                    <td className="cell-main small">{dateTime(h.at)}</td>
                    <td className="cell-main">{h.email}</td>
                    <td className="cell-amt"><span className={`tag ${h.success ? "ok" : "bad"}`}>{h.success ? "Signed in" : "Failed"}</span></td>
                    <td className="hide-sm">{h.event}</td>
                    <td className="hide-sm small muted num">{h.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adding && <AddUser onClose={() => setAdding(false)} onAdded={(token, name) => { setAdding(false); users.reload(); setLink({ title: `Invite link for ${name}`, token }); }} />}
      {link && (
        <Modal title={link.title} onClose={() => setLink(null)} foot={<button className="btn quiet" onClick={() => setLink(null)}>Done</button>}>
          <LinkBox token={link.token} id="share-link" />
        </Modal>
      )}
    </div>
  );
}

function AddUser({ onClose, onAdded }: { onClose: () => void; onAdded: (token: string, name: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", email: "", role: "accountant" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await api<{ invite_token: string }>("/users", { body: f }); onAdded(r.invite_token, f.name || f.email); }
    catch (e) { toast((e as Error).message, true); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Add a person" onClose={onClose} foot={<>
      <button className="btn quiet" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.email.includes("@")} onClick={save}>{busy ? "Adding…" : "Add and get link"}</button>
    </>}>
      <div className="form-grid">
        <Field className="col-12" label="Name" htmlFor="u-name"><input id="u-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field className="col-12" label="Email" htmlFor="u-email" hint="They sign in with this email"><input id="u-email" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field className="col-12" label="Role" htmlFor="u-role">
          <select id="u-role" className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="accountant">Accountant</option><option value="owner">Owner</option>
          </select>
        </Field>
      </div>
      <p className="small muted" style={{ marginTop: 16, marginBottom: 0 }}>After adding, you get a link to send them. They open it and choose a password.</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ audit */
function Audit() {
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const log = useApi<any[]>(`/users/audit?page=${page}`, [page]);
  const [open, setOpen] = useState<any | null>(null);
  const go = (p: number) => setSp((x) => { const n = new URLSearchParams(x); n.set("page", String(p)); return n; });
  return (
    <section className="sheet" aria-labelledby="audit-h">
      <div className="sheet-head"><h2 className="h2" id="audit-h">Every change, newest first</h2><span className="small muted">Page {page}</span></div>
      {log.error ? <div className="sheet-pad"><ErrorNote error={log.error} retry={log.reload} /></div> : !log.data ? <Loading /> : log.data.length === 0 ? (
        <div className="empty"><p>{page > 1 ? "No older changes." : "Nothing has been changed yet."}</p></div>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
          <table className="ruled cards">
            <thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Action</th><th scope="col">What changed</th><th scope="col"><span className="sr">Details</span></th></tr></thead>
            <tbody>
              {log.data.map((r) => (
                <tr key={r.id}>
                  <td className="hide-sm small">{dateTime(r.at)}</td>
                  <td className="hide-sm">{r.user}</td>
                  <td className="cell-amt"><span className="tag">{r.action}</span></td>
                  <td className="cell-main">{r.summary}<div className="tiny muted">{dateTime(r.at)} · {r.user}</div></td>
                  <td className="cell-main">{(r.before || r.after) && <button className="linkbtn small" onClick={() => setOpen(r)}>Show details</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="sheet-foot">
        <button className="btn quiet small" disabled={page <= 1} onClick={() => go(page - 1)}>Newer</button>
        <button className="btn quiet small" disabled={!log.data || log.data.length < 50} onClick={() => go(page + 1)}>Older</button>
      </div>
      {open && (
        <Modal wide title={open.summary || "Change details"} onClose={() => setOpen(null)} foot={<button className="btn quiet" onClick={() => setOpen(null)}>Close</button>}>
          <p className="small muted">{dateTime(open.at)} by {open.user}</p>
          <div className="grid-2">
            <div><h3 className="h3">Before</h3><pre className="tiny" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--paper-2)", padding: 12, margin: "6px 0 0" }}>{open.before ? JSON.stringify(open.before, null, 2) : "Nothing"}</pre></div>
            <div><h3 className="h3">After</h3><pre className="tiny" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--paper-2)", padding: 12, margin: "6px 0 0" }}>{open.after ? JSON.stringify(open.after, null, 2) : "Nothing"}</pre></div>
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ my account */
function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const sessions = useApi<any[]>("/auth/sessions");
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [dl, setDl] = useState(false);
  const change = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await api("/auth/change-password", { body: { current_password: cur, new_password: pw } }); setCur(""); setPw(""); toast("Password changed. Other devices are signed out."); sessions.reload(); }
    catch (err) { toast((err as Error).message, true); }
    finally { setBusy(false); }
  };
  const end = async (id: number) => {
    try { await api(`/auth/sessions/${id}`, { method: "DELETE" }); sessions.reload(); toast("Signed out on that device"); }
    catch (e) { toast((e as Error).message, true); }
  };
  const backup = async () => {
    setDl(true);
    try { await download("/backup", "backup.zip"); } catch (e) { toast((e as Error).message, true); } finally { setDl(false); }
  };
  return (
    <div>
      <form className="sheet" onSubmit={change} aria-labelledby="pw-h">
        <div className="sheet-head"><h2 className="h2" id="pw-h">Change your password</h2><span className="small muted">{user?.email}</span></div>
        <div className="sheet-pad form-grid">
          <Field className="col-6" label="Current password" htmlFor="pw-cur"><input id="pw-cur" className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field className="col-6" label="New password" htmlFor="pw-new" hint="At least 10 characters"><input id="pw-new" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        </div>
        <div className="sheet-foot"><span className="small muted">You stay signed in here. Other devices are signed out.</span><button className="btn primary" disabled={busy || !cur || pw.length < 10}>{busy ? "Saving…" : "Change password"}</button></div>
      </form>

      <section className="sheet" aria-labelledby="ses-h">
        <div className="sheet-head"><h2 className="h2" id="ses-h">Where you are signed in</h2></div>
        {sessions.error ? <div className="sheet-pad"><ErrorNote error={sessions.error} retry={sessions.reload} /></div> : !sessions.data ? <Loading /> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
            <table className="ruled cards">
              <thead><tr><th scope="col">Device</th><th scope="col">Last used</th><th scope="col">IP address</th><th scope="col"><span className="sr">Action</span></th></tr></thead>
              <tbody>
                {sessions.data.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-main small">{deviceName(s.user_agent)}{s.current && <> <span className="tag ok">This device</span></>}</td>
                    <td className="cell-main small muted">{dateTime(s.last_seen)}</td>
                    <td className="hide-sm small muted num">{s.ip}</td>
                    <td className="cell-amt">{!s.current && <button className="btn quiet small" onClick={() => end(s.id)}>Sign out there</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {user?.role === "owner" && (
        <section className="sheet" aria-labelledby="bk-h">
          <div className="sheet-head"><h2 className="h2" id="bk-h">Backup</h2></div>
          <div className="sheet-pad">
            <p>Download a copy of everything: bills, purchases, returns and uploaded files. Keep it on a pen drive or in your email.</p>
            <p className="small muted">The database host also keeps automatic backups. This copy is extra safety that you hold yourself.</p>
            <button className="btn primary" disabled={dl} onClick={backup}><IDownload />{dl ? "Preparing…" : "Download full backup"}</button>
          </div>
        </section>
      )}
    </div>
  );
}

function deviceName(ua?: string) {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua) ? "Android phone" : /iPhone|iPad/i.test(ua) ? "iPhone or iPad" : /Windows/i.test(ua) ? "Windows computer" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux computer" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${br} on ${os}` : os;
}

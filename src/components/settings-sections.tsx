"use client";

import { useState } from "react";
import { api, errorText } from "./api";
import { useApp } from "./shell";
import { Check, Err, Field, Loading, Ok, rupeesInput, useLoad } from "./ui";
import { fyLabel } from "@/lib/gst/periods";

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    setOk(null);
    try {
      await fn();
      setOk(msg);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  return { error, ok, run };
}

interface Biz {
  legalName: string; tradeName: string; gstin: string; pan: string; address: string; stateCode: string; jurisdiction: string;
  registrationType: "regular" | "composition"; filingFrequency: "monthly" | "quarterly"; fyStartYear: number; phone: string; email: string;
  invoicePrefix: string; b2clLimit: number; noItcScheme: boolean; roundOff: boolean; defaultPriceMode: "exclusive" | "inclusive";
}

export function BusinessSection() {
  const { me, meta, refreshMeta } = useApp();
  const { data } = useLoad<{ business: Biz }>("/api/business");
  const [f, setF] = useState<(Omit<Biz, "b2clLimit"> & { b2clLimit: string }) | null>(null);
  const a = useAction();
  if (!data) return <Loading />;
  const v = f ?? { ...data.business, b2clLimit: rupeesInput(data.business.b2clLimit) };
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setF({ ...v, [k]: val });
  const owner = me.role === "owner";
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 3 + i);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => api("/api/business", { method: "PUT", body: v }), "Business settings saved.")) refreshMeta(); }}>
      <fieldset disabled={!owner}>
        <div className="grid">
          <Field label="Legal name"><input required value={v.legalName} onChange={(e) => set("legalName", e.target.value)} /></Field>
          <Field label="Trade name"><input value={v.tradeName} onChange={(e) => set("tradeName", e.target.value)} /></Field>
          <Field label="GSTIN"><input value={v.gstin} maxLength={15} onChange={(e) => set("gstin", e.target.value.toUpperCase())} /></Field>
          <Field label="PAN" hint="Filled from GSTIN when empty."><input value={v.pan} maxLength={10} onChange={(e) => set("pan", e.target.value.toUpperCase())} /></Field>
          <Field label="State"><select value={v.stateCode} onChange={(e) => set("stateCode", e.target.value)}>{meta.states.filter((s) => s.code !== "96").map((s) => <option key={s.code} value={s.code}>{s.code} – {s.name}</option>)}</select></Field>
          <Field label="Jurisdiction"><input value={v.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)} /></Field>
          <Field label="Registration"><select value={v.registrationType} onChange={(e) => set("registrationType", e.target.value as Biz["registrationType"])}><option value="regular">Regular</option><option value="composition">Composition</option></select></Field>
          <Field label="Files returns"><select value={v.filingFrequency} onChange={(e) => set("filingFrequency", e.target.value as Biz["filingFrequency"])}><option value="monthly">Monthly</option><option value="quarterly">Quarterly (QRMP)</option></select></Field>
          <Field label="Current financial year"><select value={v.fyStartYear} onChange={(e) => set("fyStartYear", Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select></Field>
          <Field label="Phone"><input value={v.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><input value={v.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Invoice number prefix"><input value={v.invoicePrefix} maxLength={10} onChange={(e) => set("invoicePrefix", e.target.value)} /></Field>
          <Field label="B2C large limit (₹)"><input value={v.b2clLimit} onChange={(e) => set("b2clLimit", e.target.value)} /></Field>
          <Field label="Default prices"><select value={v.defaultPriceMode} onChange={(e) => set("defaultPriceMode", e.target.value as Biz["defaultPriceMode"])}><option value="exclusive">Before GST</option><option value="inclusive">Including GST</option></select></Field>
        </div>
        <Field label="Address"><textarea value={v.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Check label="Round invoice totals to the nearest rupee" checked={v.roundOff} onChange={(x) => set("roundOff", x)} />
        <Check label="We pay GST at 5% without input tax credit (no ITC on any bill)" checked={v.noItcScheme} onChange={(x) => set("noItcScheme", x)} />
      </fieldset>
      <Err error={a.error} /><Ok message={a.ok} />
      {owner ? <button className="primary">Save business settings</button> : <p className="muted">Only the owner can change these.</p>}
    </form>
  );
}

export function PasswordSection() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const a = useAction();
  const sessions = useLoad<{ sessions: Array<{ id: number; lastSeen: string; ip: string | null; userAgent: string | null; current: boolean }> }>("/api/auth/sessions");
  return (
    <>
      <form className="narrow" onSubmit={async (e) => {
        e.preventDefault();
        if (f.next !== f.confirm) return a.run(async () => { throw new Error("The two new passwords do not match"); }, "");
        if (await a.run(() => api("/api/auth/change-password", { body: { current: f.current, next: f.next } }), "Password changed. Other sessions were signed out.")) {
          setF({ current: "", next: "", confirm: "" });
          sessions.reload();
        }
      }}>
        <Field label="Current password"><input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password" hint="At least 10 characters, with letters and numbers."><input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <Err error={a.error} /><Ok message={a.ok} />
        <button>Change password</button>
      </form>
      <h3>Signed-in sessions</h3>
      {sessions.data ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Last seen</th><th>IP</th><th>Browser</th><th></th></tr></thead>
          <tbody>{sessions.data.sessions.map((s) => (
            <tr key={s.id}><td>{new Date(s.lastSeen).toLocaleString("en-IN")}</td><td>{s.ip}</td><td><small>{s.userAgent}</small></td>
              <td>{s.current ? "This session" : <button className="link" onClick={async () => { await api(`/api/auth/sessions/${s.id}`, { method: "DELETE" }); sessions.reload(); }}>Sign out</button>}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <Loading />}
    </>
  );
}

export function RatesSection() {
  const { me, refreshMeta } = useApp();
  const { data, reload } = useLoad<{ rates: Array<{ id: number; rateBp: number; label: string; active: boolean }> }>("/api/tax-rates");
  const [pct, setPct] = useState("");
  const a = useAction();
  const owner = me.role === "owner";
  if (!data) return <Loading />;
  return (
    <>
      <div className="table-wrap" style={{ maxWidth: 420 }}><table>
        <thead><tr><th>Rate</th><th>Active</th></tr></thead>
        <tbody>{data.rates.map((r) => (
          <tr key={r.id}><td>{r.label}</td><td>
            <input type="checkbox" aria-label={`Active ${r.label}`} checked={r.active} disabled={!owner}
              onChange={async (e) => { await a.run(() => api(`/api/tax-rates/${r.id}`, { method: "PUT", body: { rateBp: r.rateBp, label: r.label, active: e.target.checked } }), "Saved."); reload(); refreshMeta(); }} />
          </td></tr>
        ))}</tbody>
      </table></div>
      {owner ? (
        <div className="filters">
          <Field label="New rate (%)"><input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
          <button onClick={async () => {
            const bp = Math.round(Number(pct) * 100);
            if (await a.run(() => api("/api/tax-rates", { body: { rateBp: bp, label: `${bp / 100}%` } }), "Rate added.")) { setPct(""); reload(); refreshMeta(); }
          }}>Add rate</button>
        </div>
      ) : null}
      <Err error={a.error} /><Ok message={a.ok} />
    </>
  );
}

interface Hsn { id: number; code: string; description: string; isService: boolean; defaultRateBp: number; supplyKind: string; uqc: string; itcAllowed: boolean; notes: string; active: boolean }

export function HsnSection() {
  const { me, meta } = useApp();
  const { data, reload } = useLoad<{ hsn: Hsn[] }>("/api/hsn");
  const [edit, setEdit] = useState<(Omit<Hsn, "id"> & { id?: number }) | null>(null);
  const a = useAction();
  const owner = me.role === "owner";
  if (!data) return <Loading />;
  return (
    <>
      <div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>Description</th><th>Rate</th><th>Kind</th><th>UQC</th><th>Active</th><th></th></tr></thead>
        <tbody>{data.hsn.map((h) => (
          <tr key={h.id}><td>{h.code}</td><td>{h.description}</td><td>{h.defaultRateBp / 100}%</td><td>{h.supplyKind}</td><td>{h.uqc}</td><td>{h.active ? "Yes" : "No"}</td>
            <td>{owner ? <button className="link" onClick={() => setEdit({ ...h })}>Edit</button> : null}</td></tr>
        ))}</tbody>
      </table></div>
      {owner && !edit ? <button onClick={() => setEdit({ code: "", description: "", isService: false, defaultRateBp: 500, supplyKind: "taxable", uqc: "NOS", itcAllowed: true, notes: "", active: true })}>Add HSN/SAC</button> : null}
      {edit ? (
        <form className="box" onSubmit={async (e) => {
          e.preventDefault();
          const { id, ...body } = edit;
          if (await a.run(() => (id ? api(`/api/hsn/${id}`, { method: "PUT", body }) : api("/api/hsn", { body })), "Saved.")) { setEdit(null); reload(); }
        }}>
          <div className="grid">
            <Field label="Code"><input required value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.trim() })} /></Field>
            <Field label="Description"><input required value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Default GST rate"><select value={edit.defaultRateBp} onChange={(e) => setEdit({ ...edit, defaultRateBp: Number(e.target.value) })}>{meta.rates.map((r) => <option key={r.rateBp} value={r.rateBp}>{r.label}</option>)}</select></Field>
            <Field label="Kind"><select value={edit.supplyKind} onChange={(e) => setEdit({ ...edit, supplyKind: e.target.value })}>{meta.supplyKinds.map((k) => <option key={k}>{k}</option>)}</select></Field>
            <Field label="UQC"><select value={edit.uqc} onChange={(e) => setEdit({ ...edit, uqc: e.target.value })}>{meta.uqc.map((u) => <option key={u}>{u}</option>)}</select></Field>
          </div>
          <Check label="Service (SAC)" checked={edit.isService} onChange={(x) => setEdit({ ...edit, isService: x })} />
          <Check label="Active" checked={edit.active} onChange={(x) => setEdit({ ...edit, active: x })} />
          <div className="actions"><button className="primary">Save</button><button type="button" onClick={() => setEdit(null)}>Close</button></div>
        </form>
      ) : null}
      <Err error={a.error} /><Ok message={a.ok} />
    </>
  );
}

interface User { id: number; email: string; name: string; role: "owner" | "accountant"; isActive: boolean; mustChangePassword: boolean }

export function UsersSection() {
  const { me } = useApp();
  const { data, reload } = useLoad<{ users: User[] }>("/api/users");
  const [f, setF] = useState({ name: "", email: "", role: "accountant" });
  const [link, setLink] = useState<string | null>(null);
  const a = useAction();
  if (!data) return <Loading />;
  const patch = (u: User, body: Partial<User>) => a.run(() => api(`/api/users/${u.id}`, { method: "PATCH", body }), "Saved.").then(reload);
  return (
    <>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead>
        <tbody>{data.users.map((u) => (
          <tr key={u.id}><td>{u.name}</td><td>{u.email}</td>
            <td><select aria-label={`Role of ${u.email}`} value={u.role} onChange={(e) => patch(u, { role: e.target.value as User["role"] })}><option value="owner">Owner</option><option value="accountant">Accountant</option></select></td>
            <td><input type="checkbox" aria-label={`Active ${u.email}`} checked={u.isActive} disabled={u.id === me.id} onChange={(e) => patch(u, { isActive: e.target.checked })} /></td>
            <td><button className="link" onClick={async () => {
              setLink(null);
              await a.run(async () => { const r = await api<{ link: { url: string } }>(`/api/users/${u.id}/reset-link`, { method: "POST" }); setLink(r.link.url); }, `Reset link for ${u.email} (valid 72 hours):`);
            }}>Reset link</button></td></tr>
        ))}</tbody>
      </table></div>
      <form className="filters" onSubmit={async (e) => {
        e.preventDefault();
        setLink(null);
        await a.run(async () => { const r = await api<{ link: { url: string } }>("/api/users", { body: f }); setLink(r.link.url); setF({ name: "", email: "", role: "accountant" }); reload(); }, "User added. Send them this link to set a password (valid 72 hours):");
      }}>
        <Field label="Name"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="accountant">Accountant</option><option value="owner">Owner</option></select></Field>
        <button>Add user</button>
      </form>
      <Err error={a.error} /><Ok message={a.ok} />
      {link ? <p><input readOnly value={link} onFocus={(e) => e.target.select()} /></p> : null}
    </>
  );
}

export function LogSection() {
  const audit = useLoad<{ audit: Array<{ id: number; at: string; userEmail: string | null; action: string; entityType: string; entityId: string | null; summary: string }> }>("/api/users/audit");
  const logins = useLoad<{ history: Array<{ id: number; at: string; email: string; success: boolean; event: string; ip: string | null }> }>("/api/users/login-history");
  return (
    <>
      <h3>Audit log (latest 100)</h3>
      {audit.data ? (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Summary</th></tr></thead>
          <tbody>{audit.data.audit.map((r) => <tr key={r.id}><td>{new Date(r.at).toLocaleString("en-IN")}</td><td>{r.userEmail}</td><td>{r.action}</td><td>{r.entityType} {r.entityId}</td><td>{r.summary}</td></tr>)}</tbody>
        </table></div>
      ) : <Err error={audit.error} />}
      <h3>Sign-in history</h3>
      {logins.data ? (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Email</th><th>Event</th><th>OK</th><th>IP</th></tr></thead>
          <tbody>{logins.data.history.map((r) => <tr key={r.id}><td>{new Date(r.at).toLocaleString("en-IN")}</td><td>{r.email}</td><td>{r.event}</td><td>{r.success ? "Yes" : "No"}</td><td>{r.ip}</td></tr>)}</tbody>
        </table></div>
      ) : <Err error={logins.error} />}
    </>
  );
}

"use client";

import { useState } from "react";
import { api, errorText } from "@/components/api";
import { useApp } from "@/components/shell";
import { Check, Err, Field, Loading, Ok, qs, useLoad } from "@/components/ui";

interface Party { id: number; kind: "customer" | "supplier"; name: string; gstin: string; address: string; stateCode: string; phone: string; email: string; active: boolean }
const blank = (kind: Party["kind"], stateCode: string): Omit<Party, "id"> => ({ kind, name: "", gstin: "", address: "", stateCode, phone: "", email: "", active: true });

export default function PartiesPage() {
  const { meta } = useApp();
  const [kind, setKind] = useState<Party["kind"]>("customer");
  const [q, setQ] = useState("");
  const { data, error, reload } = useLoad<{ parties: Party[] }>(`/api/parties${qs({ kind, q })}`);
  const [edit, setEdit] = useState<(Omit<Party, "id"> & { id?: number }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setErr(null);
    try {
      const { id, ...body } = edit;
      if (id) await api(`/api/parties/${id}`, { method: "PUT", body });
      else await api("/api/parties", { body });
      setOk(`Saved ${edit.name}.`);
      setEdit(null);
      reload();
    } catch (x) {
      setErr(errorText(x));
    }
  };
  const onGstin = (v: string) => {
    const g = v.toUpperCase().replace(/\s+/g, "");
    setEdit((x) => x && ({ ...x, gstin: g, stateCode: /^\d{2}/.test(g) && meta.states.some((s) => s.code === g.slice(0, 2)) ? g.slice(0, 2) : x.stateCode }));
  };

  return (
    <>
      <h1>Customers and suppliers</h1>
      <div className="filters">
        <Field label="Show"><select value={kind} onChange={(e) => setKind(e.target.value as Party["kind"])}><option value="customer">Customers</option><option value="supplier">Suppliers</option></select></Field>
        <Field label="Search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or GSTIN" /></Field>
        <button onClick={() => { setEdit(blank(kind, meta.business.stateCode)); setOk(null); }}>Add {kind}</button>
      </div>
      <Ok message={ok} />
      {edit ? (
        <form className="box" onSubmit={save}>
          <h2>{edit.id ? `Edit ${edit.name}` : `New ${edit.kind}`}</h2>
          <div className="grid">
            <Field label="Name"><input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="GSTIN" hint="Leave empty if unregistered."><input value={edit.gstin} maxLength={15} onChange={(e) => onGstin(e.target.value)} /></Field>
            <Field label="State"><select value={edit.stateCode} onChange={(e) => setEdit({ ...edit, stateCode: e.target.value })}>{meta.states.map((s) => <option key={s.code} value={s.code}>{s.code} – {s.name}</option>)}</select></Field>
            <Field label="Phone"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Email"><input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          </div>
          <Field label="Address"><textarea value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Check label="Active" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
          <Err error={err} />
          <div className="actions"><button className="primary">Save</button><button type="button" onClick={() => setEdit(null)}>Close</button></div>
        </form>
      ) : null}
      <Err error={error} />
      {!data ? <Loading /> : data.parties.length === 0 ? <p className="muted">No {kind}s yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>GSTIN</th><th>State</th><th>Phone</th><th>Active</th><th></th></tr></thead>
          <tbody>{data.parties.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.gstin || "Unregistered"}</td><td>{p.stateCode}</td><td>{p.phone}</td><td>{p.active ? "Yes" : "No"}</td>
              <td><button className="link" onClick={() => { setEdit({ ...p }); setOk(null); }}>Edit</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

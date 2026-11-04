import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { stateName, useAuth } from "../lib/auth";
import { gstinProblem } from "../lib/gstin";
import { useApi, useDebounced, useTitle } from "../lib/hooks";
import { IPlus, ISearch } from "../components/icons";
import { ErrorNote, Field, Loading, Modal, useToast } from "../components/ui";

type Kind = "customer" | "supplier";
type Party = { id?: number; kind: Kind; name: string; gstin: string; address: string; state_code: string; phone: string; email: string; active: boolean };

export function Parties() {
  useTitle("Customers and suppliers");
  const { meta } = useAuth();
  const [sp, setSp] = useSearchParams();
  const kind: Kind = sp.get("kind") === "supplier" ? "supplier" : "customer";
  const [q, setQ] = useState("");
  const [showOff, setShowOff] = useState(false);
  const dq = useDebounced(q);
  const list = useApi<Party[]>(`/parties?kind=${kind}&q=${encodeURIComponent(dq.trim())}${showOff ? "&include_inactive=true" : ""}`, [kind, dq, showOff]);
  const [edit, setEdit] = useState<Party | null>(null);
  const word = kind === "customer" ? "customer" : "supplier";
  const blank = (): Party => ({ kind, name: "", gstin: "", address: "", state_code: "", phone: "", email: "", active: true });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">Customers and suppliers</h1>
          <p className="lede muted">The people you bill and the people who bill you. Saved details fill in by themselves when you write a bill.</p>
        </div>
        <button className="btn primary" onClick={() => setEdit(blank())}><IPlus />Add {word}</button>
      </div>

      <div className="tabs" role="tablist" aria-label="Who to show">
        {(["customer", "supplier"] as Kind[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setSp({ kind: k }, { replace: true })}>{k === "customer" ? "Customers" : "Suppliers"}</button>
        ))}
      </div>

      <div className="toolbar">
        <div className="field grow">
          <label htmlFor="p-q">Search {word}s</label>
          <div className="search"><ISearch /><input id="p-q" className="input boxed" placeholder="Name, GSTIN or phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <label className="check"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /><span>Show switched off</span></label>
      </div>

      {list.error ? <ErrorNote error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : (
        <section className="sheet" role="tabpanel" aria-label={kind === "customer" ? "Customers" : "Suppliers"}>
          {list.data.length === 0 ? (
            dq ? (
              <div className="empty"><h2 className="h2">No {word}s match</h2><p>Check the spelling, or search by phone number or GSTIN.</p></div>
            ) : (
              <div className="empty">
                <h2 className="h2">No {word}s yet</h2>
                <p>Add them one by one, or bring the whole list from Excel. They are also added when you write a bill for someone new.</p>
                <div className="btn-row" style={{ justifyContent: "center" }}>
                  <button className="btn primary" onClick={() => setEdit(blank())}><IPlus />Add {word}</button>
                  <Link className="btn quiet" to="/import">Import from Excel</Link>
                </div>
              </div>
            )
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
              <table className="ruled cards">
                <thead><tr><th scope="col">Name</th><th scope="col">GSTIN</th><th scope="col">State</th><th scope="col">Phone</th></tr></thead>
                <tbody>
                  {list.data.map((p) => (
                    <tr key={p.id}>
                      <td className="cell-main">
                        <button className="linkbtn" style={{ textAlign: "left" }} onClick={() => setEdit({ ...p })}>{p.name}</button>
                        {!p.active && <> <span className="tag">Switched off</span></>}
                        <div className="tiny muted">{p.gstin || "No GSTIN"}</div>
                      </td>
                      <td className="hide-sm num">{p.gstin || <span className="muted">None</span>}</td>
                      <td className="cell-amt">{stateName(meta, p.state_code)}</td>
                      <td className="hide-sm num">{p.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {edit && <PartyModal party={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

function PartyModal({ party, onClose, onSaved }: { party: Party; onClose: () => void; onSaved: () => void }) {
  const { meta } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<Party>(party);
  const [busy, setBusy] = useState(false);
  const codes = meta?.states.map((s) => s.code) || [];
  const gErr = gstinProblem(f.gstin, codes);
  const word = f.kind === "customer" ? "customer" : "supplier";
  const set = <K extends keyof Party>(k: K, v: Party[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (gErr) { toast(gErr, true); return; }
    setBusy(true);
    try {
      const { id, ...body } = f;
      await api(id ? `/parties/${id}` : "/parties", { method: id ? "PUT" : "POST", body: { ...body, gstin: f.gstin.trim().toUpperCase() } });
      toast(id ? `${f.name} updated` : `${f.name} added`);
      onSaved();
    } catch (e) { toast((e as Error).message, true); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={party.id ? `Edit ${party.name}` : `Add a ${word}`} onClose={onClose} foot={<>
      <button className="btn quiet" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.name.trim() || !!gErr} onClick={save}>{busy ? "Saving…" : `Save ${word}`}</button>
    </>}>
      <div className="form-grid">
        <Field className="col-12" label="Name" htmlFor="pt-name"><input id="pt-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field className="col-12" label="GSTIN" htmlFor="pt-gstin" term="gstin" error={gErr} hint="Leave empty if they are not registered for GST">
          <input id="pt-gstin" className="input" value={f.gstin} maxLength={15} autoCapitalize="characters" spellCheck={false} aria-invalid={!!gErr}
            onChange={(e) => {
              const g = e.target.value.toUpperCase();
              setF((x) => ({ ...x, gstin: g, state_code: g.length >= 2 && codes.includes(g.slice(0, 2)) ? g.slice(0, 2) : x.state_code }));
            }} />
        </Field>
        <Field className="col-12" label="Address" htmlFor="pt-addr"><textarea id="pt-addr" className="textarea" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field className="col-12" label="State" htmlFor="pt-state" hint={f.gstin.length >= 2 ? "Taken from the first two digits of the GSTIN" : "Leave as your own state if they are local"}>
          <select id="pt-state" className="select" value={f.state_code} onChange={(e) => set("state_code", e.target.value)}>
            <option value="">Same as my business</option>
            {meta?.states.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}
          </select>
        </Field>
        <Field className="col-6" label="Phone" htmlFor="pt-phone"><input id="pt-phone" className="input" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field className="col-6" label="Email" htmlFor="pt-email"><input id="pt-email" className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <div className="col-12">
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /><span>Active. Switch off to hide them from new bills. Old bills stay as they are.</span></label>
        </div>
      </div>
    </Modal>
  );
}

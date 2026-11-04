import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { useApi, useDebounced, useTitle } from "../lib/hooks";
import { IClip, ISearch, ITrash } from "../components/icons";
import { Confirm, ErrorNote, Field, Loading, useToast } from "../components/ui";

const CATEGORIES: Record<string, string> = {
  sales_invoice: "Sale bill",
  purchase_invoice: "Purchase bill",
  supplier_bill: "Supplier bill",
  credit_note: "Credit note",
  debit_note: "Debit note",
  acknowledgement: "Filing acknowledgement",
  challan: "Tax payment challan",
  other: "Other",
};

type Doc = { id: number; filename: string; category: string; entity_type: string; entity_id: number | null; note: string; uploaded_at: string; size: number; linked_to: string };

function size(n: number) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function Documents() {
  useTitle("Documents");
  const toast = useToast();
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const params = new URLSearchParams();
  if (cat) params.set("category", cat);
  if (dq.trim()) params.set("q", dq.trim());
  const list = useApi<Doc[]>(`/documents${params.toString() ? `?${params}` : ""}`, [cat, dq]);

  const [upCat, setUpCat] = useState("other");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [del, setDel] = useState<Doc | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", upCat);
      fd.append("note", note);
      try { await api("/documents", { form: fd }); ok++; } catch (e) { toast(`${file.name}: ${(e as Error).message}`, true); }
    }
    setBusy(false);
    if (ok) { toast(ok === 1 ? "File uploaded" : `${ok} files uploaded`); setNote(""); list.reload(); }
  };

  const remove = async () => {
    if (!del) return;
    try { await api(`/documents/${del.id}`, { method: "DELETE" }); toast(`${del.filename} removed`); setDel(null); list.reload(); }
    catch (e) { toast((e as Error).message, true); }
  };

  const linked = (d: Doc) => {
    if (!d.entity_type || !d.linked_to) return <span className="muted">Not linked</span>;
    if (d.entity_type === "sales" && d.entity_id) return <Link className="linkbtn" style={{ fontWeight: 400 }} to={`/sales/${d.entity_id}`}>{d.linked_to}</Link>;
    if (d.entity_type === "purchase" && d.entity_id) return <Link className="linkbtn" style={{ fontWeight: 400 }} to={`/purchases/${d.entity_id}`}>{d.linked_to}</Link>;
    return <span>{d.linked_to}</span>;
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">Documents</h1>
          <p className="lede muted">Every file you have uploaded: bill photos, PDFs, filing acknowledgements and challans. Keep them here for the GST officer and your accountant.</p>
        </div>
      </div>

      <section className="sheet" aria-labelledby="up-h">
        <div className="sheet-head"><h2 className="h2" id="up-h">Upload a file</h2></div>
        <div className="sheet-pad stack">
          <div className="note carbon"><p>A bill photo is best attached from the bill itself. Open the bill under <Link to="/sales">Sales</Link> or <Link to="/purchases">Purchases</Link> and use "Attach photo or PDF". Then it stays linked to that bill.</p></div>
          <div className="form-grid">
            <Field className="col-6" label="What is it?" htmlFor="up-cat">
              <select id="up-cat" className="select" value={upCat} onChange={(e) => setUpCat(e.target.value)}>
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field className="col-6" label="Note" htmlFor="up-note" hint="Optional, for example March rent receipt"><input id="up-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <label className={`drop ${over ? "over" : ""}`} aria-busy={busy}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) upload(e.dataTransfer.files); }}>
            <input type="file" multiple className="sr" accept="image/*,.pdf,.xlsx,.xls,.csv,.json,.zip,.doc,.docx,.txt" disabled={busy}
              onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            <b>{busy ? "Uploading…" : "Choose files or drop them here"}</b>
            <span className="small muted">PDF, photo, Excel, CSV, JSON or ZIP</span>
          </label>
        </div>
      </section>

      <div className="spacer" />

      <div className="toolbar">
        <div className="field grow">
          <label htmlFor="d-q">Search</label>
          <div className="search"><ISearch /><input id="d-q" className="input boxed" placeholder="File name or note" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="field">
          <label htmlFor="d-cat">Type</label>
          <select id="d-cat" className="select boxed" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {list.error ? <ErrorNote error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : (
        <section className="sheet" aria-label="Uploaded files">
          {list.data.length === 0 ? (
            <div className="empty">
              <h2 className="h2">{cat || dq ? "No files match" : "No files yet"}</h2>
              <p>{cat || dq ? "Try another type or search word." : "Files you attach to bills and returns also show up here."}</p>
            </div>
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
              <table className="ruled cards">
                <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Linked to</th><th scope="col">Uploaded</th><th scope="col"><span className="sr">Remove</span></th></tr></thead>
                <tbody>
                  {list.data.map((d) => (
                    <tr key={d.id}>
                      <td className="cell-main">
                        <a className="linkbtn" style={{ wordBreak: "break-all" }} href={`/api/documents/${d.id}/download`} target="_blank" rel="noreferrer">
                          <IClip width={14} height={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} aria-hidden="true" />{d.filename}
                        </a>
                        {d.note && <div className="tiny muted">{d.note}</div>}
                        <div className="tiny muted">{CATEGORIES[d.category] || d.category} · {date(d.uploaded_at)}</div>
                      </td>
                      <td className="hide-sm">{CATEGORIES[d.category] || d.category}</td>
                      <td className="cell-main small">{linked(d)}</td>
                      <td className="hide-sm small">{date(d.uploaded_at)}<div className="tiny muted">{size(d.size)}</div></td>
                      <td className="cell-amt"><button className="iconbtn" aria-label={`Remove ${d.filename}`} onClick={() => setDel(d)}><ITrash /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {del && (
        <Confirm danger title="Remove this file?" okLabel="Remove file" onClose={() => setDel(null)} onOk={remove}
          text={<p><b>{del.filename}</b> will be deleted for good.{del.linked_to ? ` It will no longer be attached to ${del.linked_to}.` : ""} Keep a copy if the GST office may ask for it.</p>} />
      )}
    </div>
  );
}

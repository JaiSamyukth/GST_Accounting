"use client";

import { useRef, useState } from "react";
import { api, errorText } from "./api";
import { useApp } from "./shell";
import { Err, useLoad } from "./ui";

interface Doc { id: number; filename: string; sizeBytes: number; kind: string; createdAt: string }

const KIND_LABEL: Record<string, string> = { bill_photo: "Bill photo", supplier_pdf: "Supplier PDF", acknowledgement: "Acknowledgement", other: "Other" };

function size(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Plain attachment list with a native file input. */
export function Attachments({ entityType, entityId, defaultKind = "bill_photo" }: { entityType: string; entityId: string; defaultKind?: string }) {
  const { me, meta } = useApp();
  const { data, error, reload } = useLoad<{ documents: Doc[] }>(`/api/documents?entity_type=${entityType}&entity_id=${encodeURIComponent(entityId)}`);
  const [kind, setKind] = useState(defaultKind);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr("Choose a file first");
    if (file.size > 10 * 1024 * 1024) return setErr("File is larger than 10 MB");
    const form = new FormData();
    form.set("entity_type", entityType);
    form.set("entity_id", entityId);
    form.set("kind", kind);
    form.set("file", file);
    setBusy(true);
    setErr(null);
    try {
      await api("/api/documents", { form });
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Doc) => {
    if (!confirm(`Delete ${d.filename}? This cannot be undone.`)) return;
    try {
      await api(`/api/documents/${d.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };

  return (
    <div className="box">
      <h3>Attachments</h3>
      <Err error={error || err} />
      {data && data.documents.length === 0 ? <p className="muted">No files attached.</p> : null}
      {data && data.documents.length > 0 ? (
        <div className="table-wrap"><table>
          <thead><tr><th>File</th><th>Kind</th><th className="num">Size</th><th>Uploaded</th><th></th></tr></thead>
          <tbody>{data.documents.map((d) => (
            <tr key={d.id}>
              <td><a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{d.filename}</a></td>
              <td>{KIND_LABEL[d.kind] ?? d.kind}</td>
              <td className="num">{size(d.sizeBytes)}</td>
              <td>{new Date(d.createdAt).toLocaleDateString("en-IN")}</td>
              <td>{me.role === "owner" ? <button className="link" onClick={() => remove(d)}>Delete</button> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : null}
      <div className="filters">
        <div className="field"><label>File (PDF, JPEG or PNG, up to 10 MB)<input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" /></label></div>
        <div className="field"><label>Kind<select value={kind} onChange={(e) => setKind(e.target.value)}>{meta.documentKinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</select></label></div>
        <button type="button" onClick={upload} disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
      </div>
    </div>
  );
}

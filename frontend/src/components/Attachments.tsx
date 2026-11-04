import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/hooks";
import { IClip, ITrash } from "./icons";
import { useToast } from "./ui";

export function Attachments({ entityType, entityId, category, queued, setQueued, readOnly }: {
  entityType: string; entityId?: number; category: string; queued?: File[]; setQueued?: (f: File[]) => void; readOnly?: boolean;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const list = useApi<any[]>(entityId ? `/documents?entity_type=${entityType}&entity_id=${entityId}` : null, [entityId]);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!entityId) { setQueued?.([...(queued || []), ...Array.from(files)]); return; }
    setBusy(true);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("entity_type", entityType);
      fd.append("entity_id", String(entityId));
      fd.append("category", category);
      try { await api("/documents", { form: fd }); } catch (e) { toast((e as Error).message, true); }
    }
    setBusy(false);
    list.reload();
  };
  const remove = async (id: number) => {
    try { await api(`/documents/${id}`, { method: "DELETE" }); list.reload(); } catch (e) { toast((e as Error).message, true); }
  };
  const docs = list.data || [];
  return (
    <div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
        {docs.map((d) => (
          <li key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--rule-2)" }}>
            <IClip width={16} height={16} />
            <a href={`/api/documents/${d.id}/download`} target="_blank" rel="noreferrer" className="linkbtn" style={{ fontWeight: 400, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{d.filename}</a>
            {!readOnly && <button className="iconbtn" aria-label={`Remove ${d.filename}`} onClick={() => remove(d.id)}><ITrash /></button>}
          </li>
        ))}
        {(queued || []).map((f, i) => (
          <li key={`q${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--rule-2)" }}>
            <IClip width={16} height={16} /><span style={{ flex: 1 }}>{f.name}</span><span className="tiny muted">attaches on save</span>
            <button className="iconbtn" aria-label={`Remove ${f.name}`} onClick={() => setQueued?.((queued || []).filter((_, j) => j !== i))}><ITrash /></button>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <>
          <input ref={input} type="file" multiple accept="image/*,.pdf,.xlsx,.xls,.csv" className="sr" id={`att-${entityType}`} aria-label="Attach a file" tabIndex={-1} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <button type="button" className="btn quiet small" disabled={busy} onClick={() => input.current?.click()}><IClip />{busy ? "Uploading…" : "Attach photo or PDF of the bill"}</button>
        </>
      )}
    </div>
  );
}

export async function uploadQueued(files: File[], entityType: string, entityId: number, category: string) {
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("entity_type", entityType);
    fd.append("entity_id", String(entityId));
    fd.append("category", category);
    await api("/documents", { form: fd }).catch(() => {});
  }
}

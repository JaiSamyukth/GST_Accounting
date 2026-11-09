"use client";

import { useRef, useState } from "react";
import { api, errorText } from "@/components/api";
import { useApp } from "@/components/shell";
import { Err, Field, Loading, Ok, qs, useLoad } from "@/components/ui";
import { fyLabel } from "@/lib/gst/periods";

interface FieldDef { key: string; label: string; required?: boolean }
interface Kind { kind: string; label: string; fields: FieldDef[] }
interface Preview {
  kind: string; fields: FieldDef[]; headers: string[]; mapping: Record<string, number>;
  totalRows: number; validRows: number; errorRows: number; fileErrors: string[]; documentCount: number; updateCount: number;
  rows: Array<{ row: number; cells: string[]; errors: string[] }>;
}
interface Batch { id: number; kind: string; filename: string; status: string; totalRows: number; validRows: number; errorRows: number; createdAt: string }

const UPDATABLE = ["customers", "suppliers", "hsn"];
const DATED = ["sales", "notes", "purchases", "payments"];

function ExportBox({ kinds }: { kinds: Kind[] }) {
  const { meta } = useApp();
  const [kind, setKind] = useState("sales");
  const [mode, setMode] = useState<"fy" | "period">("fy");
  const [fy, setFy] = useState(meta.fy.startYear);
  const [period, setPeriod] = useState(meta.currentPeriod);
  const q = DATED.includes(kind) ? qs(mode === "fy" ? { fy } : { period }) : "";
  return (
    <div className="box">
      <h2 style={{ marginTop: 0 }}>Export</h2>
      <p>Download your data in the same columns as the import templates. Edit it in Excel and import it back, or move it to another installation.</p>
      <div className="filters">
        <Field label="What">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}</select>
        </Field>
        {DATED.includes(kind) ? (
          <>
            <Field label="For"><select value={mode} onChange={(e) => setMode(e.target.value as "fy" | "period")}><option value="fy">A financial year</option><option value="period">A return period</option></select></Field>
            {mode === "fy" ? (
              <Field label="Financial year"><select value={fy} onChange={(e) => setFy(Number(e.target.value))}>{[meta.fy.startYear + 1, meta.fy.startYear, meta.fy.startYear - 1, meta.fy.startYear - 2].map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select></Field>
            ) : (
              <Field label="Period"><select value={period} onChange={(e) => setPeriod(e.target.value)}>{meta.periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></Field>
            )}
          </>
        ) : null}
        <p>Download: <a href={`/api/exports/${kind}.xlsx${q}`}>Excel</a> · <a href={`/api/exports/${kind}.csv${q}`}>CSV</a></p>
      </div>
      <p className="muted">Cancelled documents are left out; an amended invoice is exported as its latest version. For a complete copy of everything, use Settings → Backup.</p>
    </div>
  );
}

export default function ImportPage() {
  const kinds = useLoad<{ kinds: Kind[] }>("/api/imports/kinds");
  const history = useLoad<{ batches: Batch[] }>("/api/imports");
  const [kind, setKind] = useState("sales");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [update, setUpdate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = (m: Record<string, number> | null) => {
    const file = fileRef.current?.files?.[0];
    if (!file) throw new Error("Choose a file first");
    const f = new FormData();
    f.set("kind", kind);
    f.set("file", file);
    if (m) f.set("mapping", JSON.stringify(m));
    if (update && UPDATABLE.includes(kind)) f.set("update", "1");
    return f;
  };

  const check = async (m: Record<string, number> | null) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const p = await api<Preview>("/api/imports/preview", { form: form(m) });
      setPreview(p);
      setMapping(p.mapping);
    } catch (e) {
      setError(errorText(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const downloadErrors = async () => {
    try {
      const res = await fetch("/api/imports/error-report", { method: "POST", body: form(mapping), headers: { "X-Requested-With": "fetch" } });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not build the report");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${kind}-import-errors.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const commit = async () => {
    if (!preview || !confirm(`Import ${preview.documentCount} record(s) from ${preview.validRows} row(s)? Rows with errors are skipped.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/imports/commit", { form: form(mapping) });
      setOk(`Imported ${preview.documentCount} record(s). You can undo this below.`);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      history.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async (b: Batch) => {
    if (!confirm(`Undo import #${b.id} (${b.filename})? Everything it created will be deleted.`)) return;
    try {
      await api(`/api/imports/${b.id}/rollback`, { method: "POST" });
      setOk(`Import #${b.id} undone.`);
      history.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!kinds.data) return <Loading />;
  const k = kinds.data.kinds.find((x) => x.kind === kind)!;
  const rows = preview ? preview.rows.filter((r) => !onlyErrors || r.errors.length) : [];

  return (
    <>
      <h1>Import and export</h1>
      <p>Bring in sales, notes, purchases, customers, suppliers, HSN codes or tax payments from a spreadsheet. Download a template, fill it in, then upload. Nothing is saved until you click Import.</p>
      <div className="filters">
        <Field label="What are you importing?">
          <select value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); setMapping(null); }}>
            {kinds.data.kinds.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
          </select>
        </Field>
        <p>Template: <a href={`/api/imports/template/${kind}.xlsx`}>Excel</a> · <a href={`/api/imports/template/${kind}.csv`}>CSV</a></p>
      </div>
      <details>
        <summary>Columns for {k.label.toLowerCase()}</summary>
        <ul className="plain">{k.fields.map((f) => <li key={f.key}><code>{f.key}</code> – {f.label}{f.required ? " (required)" : ""}</li>)}</ul>
        <p className="muted">Column names need not match exactly; common names such as &quot;Invoice No&quot; or &quot;GST %&quot; are recognised. Items of one invoice go on separate rows with the same number.</p>
      </details>
      <div className="filters">
        <div className="field"><label>File (.xlsx or .csv, up to 4 MB / 20,000 rows)<input ref={fileRef} type="file" accept=".csv,.xlsx" onChange={() => { setPreview(null); setMapping(null); }} /></label></div>
        <button className="primary" disabled={busy} onClick={() => check(null)}>{busy ? "Checking…" : "Check file"}</button>
      </div>
      {UPDATABLE.includes(kind) ? (
        <label><input type="checkbox" checked={update} onChange={(e) => { setUpdate(e.target.checked); setPreview(null); }} />
          Update existing {kind === "hsn" ? "codes (matched by code)" : `${kind} (matched by name)`} instead of skipping them</label>
      ) : null}
      <Err error={error} />
      <Ok message={ok} />

      {preview ? (
        <>
          <h2>Check</h2>
          {preview.fileErrors.map((e) => <div key={e} className="error">{e}</div>)}
          <p>
            {preview.totalRows} row(s): <b>{preview.validRows} ready</b> ({preview.documentCount} record(s){preview.updateCount ? `, ${preview.updateCount} of them updates` : ""}), <b>{preview.errorRows} with errors</b>.
          </p>
          <h3>Columns</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Field</th><th>Column in your file</th></tr></thead>
            <tbody>{preview.fields.map((f) => (
              <tr key={f.key}>
                <td>{f.label}{f.required ? " *" : ""}</td>
                <td>
                  <select aria-label={`Column for ${f.label}`} value={mapping?.[f.key] ?? -1} onChange={(e) => setMapping({ ...(mapping ?? {}), [f.key]: Number(e.target.value) })}>
                    <option value={-1}>— not in file —</option>
                    {preview.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="actions">
            <button onClick={() => check(mapping)} disabled={busy}>Check again with these columns</button>
            {preview.errorRows ? <button onClick={downloadErrors}>Download error report</button> : null}
            <button className="primary" onClick={commit} disabled={busy || !preview.documentCount || preview.fileErrors.length > 0}>
              Import {preview.documentCount} record(s)
            </button>
          </div>
          <h3>Rows {preview.totalRows > preview.rows.length ? `(first ${preview.rows.length})` : ""}</h3>
          <label><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />Show only rows with errors</label>
          <div className="table-wrap"><table>
            <thead><tr><th>Row</th>{preview.headers.map((h, i) => <th key={i}>{h}</th>)}<th>Problem</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.row}><td>{r.row}</td>{r.cells.map((c, i) => <td key={i}>{c}</td>)}<td>{r.errors.length ? <b>{r.errors.join("; ")}</b> : "OK"}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      ) : null}

      <ExportBox kinds={kinds.data.kinds} />

      <h2>Past imports</h2>
      {history.data && history.data.batches.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>When</th><th>Kind</th><th>File</th><th className="num">Rows imported</th><th className="num">Rows skipped</th><th>Status</th><th></th></tr></thead>
          <tbody>{history.data.batches.map((b) => (
            <tr key={b.id}><td>{b.id}</td><td>{new Date(b.createdAt).toLocaleString("en-IN")}</td><td>{b.kind}</td><td>{b.filename}</td>
              <td className="num">{b.validRows}</td><td className="num">{b.errorRows}</td><td>{b.status === "rolled_back" ? "Undone" : "Imported"}</td>
              <td>{b.status === "committed" ? <button className="link" onClick={() => undo(b)}>Undo</button> : null}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted">No imports yet.</p>}
    </>
  );
}

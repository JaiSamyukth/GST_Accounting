import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, download } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, periodLabel } from "../lib/format";
import { useApi, useTitle } from "../lib/hooks";
import { IDownload, IImport, IUndo } from "../components/icons";
import { Confirm, ErrorNote, Field, Loading, StatusTag, useToast } from "../components/ui";

const WHERE: Record<string, string> = { sales: "/sales", notes: "/sales", purchases: "/purchases", customers: "/parties", suppliers: "/parties?tab=suppliers", hsn: "/settings?tab=hsn", payments: "/returns", gstr2b: "/returns" };
const ABOUT: Record<string, string> = {
  sales: "Old sale bills from Excel or a GSTR-1 JSON. One row per line item.",
  notes: "Credit and debit notes against earlier bills.",
  purchases: "Supplier bills. One row per line item.",
  customers: "Your list of customers with GSTIN and phone.",
  suppliers: "Your list of suppliers.",
  hsn: "HSN/SAC codes with rates and units.",
  payments: "Tax paid per month: challan, amounts, interest.",
  gstr2b: "The GSTR-2B from the GST portal (JSON, Excel or ZIP), to check your credit.",
};
const STEPS = ["Choose", "Upload", "Match columns", "Check", "Done"];

export function Import() {
  useTitle("Import from Excel");
  const [sp] = useSearchParams();
  const { meta } = useAuth();
  const toast = useToast();
  const kinds = useApi<any[]>("/imports/kinds");
  const history = useApi<any[]>("/imports");
  const [kind, setKind] = useState<string>(sp.get("kind") || "");
  const [step, setStep] = useState(sp.get("kind") ? 1 : 0);
  const [file, setFile] = useState<File | null>(null);
  const [period, setPeriod] = useState(sp.get("period") || meta?.current_period || "");
  const [preview, setPreview] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [over, setOver] = useState(false);
  const [undo, setUndo] = useState<any>(null);
  const [onlyBad, setOnlyBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const k = kinds.data?.find((x) => x.key === kind);

  useEffect(() => { head.current?.focus(); }, [step]);

  const form = (m = mapping) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file!);
    fd.append("mapping", JSON.stringify(m));
    fd.append("options", JSON.stringify(kind === "gstr2b" ? { period } : { fy: meta?.current_fy }));
    return fd;
  };
  const runPreview = async (m?: Record<string, string>, next?: number) => {
    setBusy(true);
    setErr(null);
    try {
      const p = await api("/imports/preview", { form: form(m) });
      setPreview(p);
      setMapping(p.mapping);
      if (next !== undefined) setStep(next);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api("/imports/commit", { form: form() });
      setResult(r);
      setStep(4);
      history.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const errorReport = async () => {
    try {
      const res = await fetch("/api/imports/error-report", { method: "POST", body: form(), headers: { "X-Requested-With": "fetch" }, credentials: "same-origin" });
      if (!res.ok) throw new Error("Could not make the list");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = "import-problems.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { toast((e as Error).message, true); }
  };
  const reset = () => { setStep(0); setKind(""); setFile(null); setPreview(null); setMapping({}); setResult(null); setErr(null); };
  const pickFile = (f?: File | null) => { if (f) { setFile(f); setPreview(null); setMapping({}); setErr(null); } };
  const rows = useMemo(() => (preview?.rows || []).filter((r: any) => !onlyBad || r.errors.length), [preview, onlyBad]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">Import from Excel</h1>
          <p className="lede muted">Bring in old records or the GSTR-2B. Nothing is saved until you have seen every row, and any import can be undone.</p>
        </div>
      </div>

      <ol className="btn-row" aria-label="Import steps" style={{ listStyle: "none", padding: 0, margin: "0 0 18px", gap: 6 }}>
        {STEPS.map((s, i) => (
          <li key={s} className={`tag ${i === step ? "carbon" : i < step ? "ok" : ""}`} aria-current={i === step ? "step" : undefined}>{i + 1}. {s}</li>
        ))}
      </ol>
      {err && <div className="note bad" role="alert" style={{ marginBottom: 16 }}><p>{err}</p></div>}

      <div className="sheet">
        {step === 0 && (
          <>
            <div className="sheet-head"><h2 className="h2" ref={head} tabIndex={-1}>What are you importing?</h2></div>
            {!kinds.data ? <Loading /> : (
              <div className="sheet-pad grid-2" style={{ gap: 14 }}>
                {kinds.data.map((x) => (
                  <div key={x.key} style={{ border: "1.5px solid var(--rule)", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div><b className="h3">{x.label}</b><p className="small muted" style={{ margin: "4px 0 0" }}>{ABOUT[x.key]}</p></div>
                    <div className="btn-row" style={{ marginTop: "auto", gap: 8 }}>
                      <button className="btn small primary" onClick={() => { setKind(x.key); setStep(1); }}>Import {x.label.toLowerCase()}</button>
                      <button className="linkbtn small" onClick={() => download(`/imports/template/${x.key}.xlsx`, "template.xlsx").catch((e) => toast(e.message, true))}>Excel template</button>
                      <button className="linkbtn small" onClick={() => download(`/imports/template/${x.key}.csv`, "template.csv").catch((e) => toast(e.message, true))}>CSV</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {step === 1 && k && (
          <>
            <div className="sheet-head"><h2 className="h2" ref={head} tabIndex={-1}>Upload {k.label.toLowerCase()}</h2><button className="linkbtn small" onClick={reset}>Change</button></div>
            <div className="sheet-pad stack">
              {kind === "gstr2b" && (
                <Field label="GSTR-2B for" htmlFor="p2b" hint="The month the GSTR-2B belongs to. A JSON from the portal sets this itself.">
                  <select id="p2b" className="select boxed" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ maxWidth: 260 }}>
                    {[...(meta?.periods || []), ...(meta?.previous_periods || [])].filter((p) => !p.key.includes("Q")).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    {[...(meta?.periods || [])].filter((p) => p.key.includes("Q")).map((p) => <option key={p.key} value={p.key}>{periodLabel(p.key)}</option>)}
                  </select>
                </Field>
              )}
              <label className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files?.[0]); }}>
                <input ref={input} type="file" className="sr" accept=".csv,.xls,.xlsx,.json,.zip,.txt" onChange={(e) => pickFile(e.target.files?.[0])} />
                <IImport width={28} height={28} style={{ margin: "0 auto 8px" }} />
                <b>{file ? file.name : "Choose a file or drop it here"}</b>
                <span className="small muted">CSV, XLS, XLSX, JSON or ZIP, up to 20 MB</span>
              </label>
              <p className="small muted" style={{ margin: 0 }}>Column names do not have to match. You will match them in the next step. Not sure how to lay it out? <button className="linkbtn" onClick={() => download(`/imports/template/${kind}.xlsx`, "template.xlsx")}>Download the template</button>.</p>
            </div>
            <div className="sheet-foot"><button className="btn quiet" onClick={reset}>Back</button><button className="btn primary" disabled={!file || busy} onClick={() => runPreview({}, 2)}>{busy ? "Reading…" : "Next: match columns"}</button></div>
          </>
        )}

        {step === 2 && preview && (
          <>
            <div className="sheet-head"><h2 className="h2" ref={head} tabIndex={-1}>Match your columns</h2><span className="small muted">{preview.total_rows} rows in {file?.name} ({preview.format})</span></div>
            <div className="sheet-pad">
              <p className="muted">We matched what we could. Check each line, and pick the column from your file for anything marked required.</p>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Table"><table className="ruled">
                <thead><tr><th scope="col">In the app</th><th scope="col">Column in your file</th></tr></thead>
                <tbody>{preview.fields.map((fl: any) => (
                  <tr key={fl.key}>
                    <td><label htmlFor={`m-${fl.key}`}>{fl.label}</label> {fl.required && <span className="tag warn">Required</span>}</td>
                    <td>
                      <select id={`m-${fl.key}`} className="select boxed" value={mapping[fl.key] || ""} onChange={(e) => setMapping({ ...mapping, [fl.key]: e.target.value })} style={{ maxWidth: 320 }}
                        aria-invalid={fl.required && !mapping[fl.key]}>
                        <option value="">{fl.required ? "Choose a column" : "Not in my file"}</option>
                        {preview.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      {preview.auto_mapping[fl.key] && preview.auto_mapping[fl.key] === mapping[fl.key] && <span className="tiny muted" style={{ marginLeft: 8 }}>matched</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
            <div className="sheet-foot"><button className="btn quiet" onClick={() => setStep(1)}>Back</button>
              <button className="btn primary" disabled={busy || preview.fields.some((fl: any) => fl.required && !mapping[fl.key])} onClick={() => runPreview(mapping, 3)}>{busy ? "Checking…" : "Next: check rows"}</button></div>
          </>
        )}

        {step === 3 && preview && (
          <>
            <div className="sheet-head"><h2 className="h2" ref={head} tabIndex={-1}>Check before importing</h2>
              <div className="btn-row" style={{ gap: 8 }}><span className="tag ok">{preview.valid_rows} rows ready</span>{preview.invalid_rows > 0 && <span className="tag bad">{preview.invalid_rows} rows with problems</span>}</div></div>
            <div className="sheet-pad stack">
              {preview.invalid_rows > 0 ? (
                <div className="note warn"><p>Rows with problems will be skipped. If one line of a bill has a problem, the whole bill is skipped so nothing is half imported. Fix them in your file and import again, or import the good rows now.</p>
                  <div className="btn-row"><button className="btn small quiet" onClick={errorReport}><IDownload />Download the problem list</button>
                    <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} />Show only problems</label></div></div>
              ) : <div className="note ok"><p>Every row passed the checks: GSTIN, dates, rates, tax amounts and duplicates.</p></div>}
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Table" style={{ maxHeight: 420 }}><table className="ruled">
                <thead><tr><th scope="col">Row</th><th scope="col">Result</th>{preview.fields.filter((fl: any) => mapping[fl.key]).slice(0, 7).map((fl: any) => <th key={fl.key} scope="col">{fl.label}</th>)}</tr></thead>
                <tbody>{rows.map((r: any) => (
                  <tr key={r.row} style={r.errors.length ? { background: "var(--stamp-2)" } : undefined}>
                    <td>{r.row}</td>
                    <td>{r.errors.length ? <span className="bad-ink small">{r.errors.join(". ")}</span> : r.warnings.length ? <span className="small">{r.warnings.join(". ")}</span> : <span className="tag ok">OK</span>}</td>
                    {preview.fields.filter((fl: any) => mapping[fl.key]).slice(0, 7).map((fl: any) => <td key={fl.key} className="small">{String(r.values[fl.key] ?? "")}</td>)}
                  </tr>
                ))}</tbody>
              </table></div>
              {preview.total_rows > preview.rows.length && <p className="tiny muted">Showing {preview.rows.length} of {preview.total_rows} rows (all problem rows are shown).</p>}
            </div>
            <div className="sheet-foot"><button className="btn quiet" onClick={() => setStep(2)}>Back to columns</button>
              <button className="btn primary" disabled={busy || preview.valid_rows === 0} onClick={commit}>{busy ? "Importing…" : `Import ${preview.valid_rows} rows`}</button></div>
          </>
        )}

        {step === 4 && result && (
          <>
            <div className="sheet-head"><h2 className="h2" ref={head} tabIndex={-1}>Imported</h2><span className="stamp ok">Done</span></div>
            <div className="sheet-pad">
              <p>{result.rows_imported} rows imported from {result.filename}{result.rows_skipped ? `, ${result.rows_skipped} skipped` : ""}.</p>
              <div className="btn-row">
                <Link className="btn primary" to={kind === "gstr2b" ? `/returns/${period}?tab=itc` : WHERE[kind]}>{kind === "gstr2b" ? "See the match" : "See them"}</Link>
                <button className="btn quiet" onClick={reset}>Import another file</button>
                <button className="btn danger small" onClick={() => setUndo(result)}><IUndo />Undo this import</button>
              </div>
            </div>
          </>
        )}
      </div>

      <section className="sheet" style={{ marginTop: 28 }} aria-labelledby="hist">
        <div className="sheet-head"><h2 className="h2" id="hist">Earlier imports</h2></div>
        {history.error ? <div className="sheet-pad"><ErrorNote error={history.error} /></div> : !history.data ? <Loading /> : history.data.length === 0 ? <div className="sheet-pad muted">No imports yet.</div> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table"><table className="ruled cards">
            <thead><tr><th scope="col">When</th><th scope="col">File</th><th scope="col">What</th><th scope="col" className="num">Rows</th><th scope="col">Status</th><th scope="col"><span className="sr">Undo</span></th></tr></thead>
            <tbody>{history.data.map((b) => (
              <tr key={b.id}>
                <td className="hide-sm">{dateTime(b.created_at)}</td>
                <td className="cell-main">{b.filename}<div className="tiny muted">{kinds.data?.find((x) => x.key === b.kind)?.label} · {dateTime(b.created_at)}</div></td>
                <td className="hide-sm">{kinds.data?.find((x) => x.key === b.kind)?.label}</td>
                <td className="num hide-sm">{b.rows_imported} of {b.rows_total}</td>
                <td className="cell-amt"><StatusTag s={b.status} /></td>
                <td className="hide-sm">{b.status === "committed" && <button className="linkbtn small" onClick={() => setUndo(b)}>Undo</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {undo && <Confirm title="Undo this import?" danger okLabel="Undo import" onClose={() => setUndo(null)}
        onOk={async () => { try { await api(`/imports/${undo.id}/rollback`, { method: "POST" }); toast("Import undone"); setUndo(null); history.reload(); if (result?.id === undo.id) reset(); } catch (e) { toast((e as Error).message, true); setUndo(null); } }}
        text={<p>Everything this import added ({undo.rows_imported} rows from {undo.filename}) is removed. Records you entered by hand are not touched.</p>} />}
    </div>
  );
}

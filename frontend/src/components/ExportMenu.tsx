import { useState } from "react";
import { download } from "../lib/api";
import { IDownload } from "./icons";
import { useToast } from "./ui";

export function ExportMenu({ path, name, formats = ["xlsx", "csv", "pdf", "json"], label = "Download" }: { path: string; name: string; formats?: string[]; label?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const go = async (fmt: string) => {
    setBusy(fmt);
    try {
      await download(`${path}${path.includes("?") ? "&" : "?"}fmt=${fmt}`, `${name}.${fmt}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };
  const L: Record<string, string> = { xlsx: "Excel", csv: "CSV", pdf: "PDF", json: "JSON" };
  return (
    <div className="btn-row" role="group" aria-label={label} style={{ gap: 8 }}>
      <span className="small muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IDownload width={16} height={16} />{label}</span>
      {formats.map((f) => (
        <button key={f} className="btn quiet small" disabled={!!busy} onClick={() => go(f)} aria-label={`${label} as ${L[f]}`}>{busy === f ? "…" : L[f]}</button>
      ))}
    </div>
  );
}

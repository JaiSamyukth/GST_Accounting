"use client";

import { useState } from "react";
import { DataTable } from "@/components/data-table";
import { useApp } from "@/components/shell";
import { Err, Field, Loading, qs, useLoad } from "@/components/ui";
import type { Table } from "@/lib/export/table";
import { fyLabel } from "@/lib/gst/periods";

export default function ReportsPage() {
  const { meta } = useApp();
  const list = useLoad<{ reports: Array<{ kind: string; title: string }> }>("/api/reports");
  const [kind, setKind] = useState("sales-register");
  const [mode, setMode] = useState<"fy" | "period" | "dates">("period");
  const [fy, setFy] = useState(meta.fy.startYear);
  const [period, setPeriod] = useState(meta.currentPeriod);
  const [from, setFrom] = useState(meta.today.slice(0, 8) + "01");
  const [to, setTo] = useState(meta.today);
  const filter = mode === "fy" ? { fy } : mode === "period" ? { period } : { from, to };
  const q = qs(filter);
  const { data, error } = useLoad<{ table: Table; filter: { from: string; to: string } }>(`/api/reports/${kind}${q}`);

  return (
    <>
      <h1>Reports</h1>
      <div className="filters">
        <Field label="Report">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {(list.data?.reports ?? []).map((r) => <option key={r.kind} value={r.kind}>{r.title}</option>)}
          </select>
        </Field>
        <Field label="For">
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="period">A return period</option><option value="fy">A financial year</option><option value="dates">Dates</option>
          </select>
        </Field>
        {mode === "fy" ? (
          <Field label="Financial year">
            <select value={fy} onChange={(e) => setFy(Number(e.target.value))}>
              {[meta.fy.startYear + 1, meta.fy.startYear, meta.fy.startYear - 1, meta.fy.startYear - 2].map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
            </select>
          </Field>
        ) : null}
        {mode === "period" ? (
          <Field label="Period">
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>{meta.periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          </Field>
        ) : null}
        {mode === "dates" ? <>
          <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </> : null}
      </div>
      <p>Download: {["pdf", "xlsx", "csv", "json"].map((fmt) => <span key={fmt}><a href={`/api/reports/${kind}/export${q}${q ? "&" : "?"}fmt=${fmt}`}>{fmt.toUpperCase()}</a>{" "}</span>)}</p>
      <Err error={error} />
      {!data ? <Loading /> : <>
        <h2>{data.table.title}</h2>
        <p className="muted">{data.filter.from} to {data.filter.to}</p>
        <DataTable table={data.table} showTitle={false} />
      </>}
    </>
  );
}

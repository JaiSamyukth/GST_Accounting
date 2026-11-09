"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/shell";
import { Err, Field, Loading, useLoad } from "@/components/ui";
import { fyLabel } from "@/lib/gst/periods";

interface P { period: string; label: string; gstr1Status: string; gstr3bStatus: string; locked: boolean; due: { gstr1: string; gstr3b: string }; overdue: { gstr1: boolean; gstr3b: boolean }; started: boolean }

export default function ReturnsPage() {
  const { meta } = useApp();
  const [fy, setFy] = useState(meta.fy.startYear);
  const { data, error } = useLoad<{ periods: P[] }>(`/api/returns?fy=${fy}`);
  return (
    <>
      <h1>Returns</h1>
      <div className="filters">
        <Field label="Financial year">
          <select value={fy} onChange={(e) => setFy(Number(e.target.value))}>
            {[meta.fy.startYear + 1, meta.fy.startYear, meta.fy.startYear - 1, meta.fy.startYear - 2].map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
          </select>
        </Field>
      </div>
      <Err error={error} />
      {!data ? <Loading /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Period</th><th>GSTR-1</th><th>Due</th><th>GSTR-3B</th><th>Due</th><th>Locked</th></tr></thead>
          <tbody>{data.periods.map((p) => (
            <tr key={p.period}>
              <td>{p.started ? <Link href={`/returns/${p.period}`}>{p.label}</Link> : <span className="muted">{p.label}</span>}</td>
              <td>{p.gstr1Status}{p.overdue.gstr1 ? <b> – overdue</b> : null}</td><td>{p.due.gstr1}</td>
              <td>{p.gstr3bStatus}{p.overdue.gstr3b ? <b> – overdue</b> : null}</td><td>{p.due.gstr3b}</td>
              <td>{p.locked ? "Yes" : "No"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

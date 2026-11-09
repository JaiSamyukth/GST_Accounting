"use client";

import Link from "next/link";
import { Err, Loading, Money, useLoad } from "@/components/ui";

interface Home {
  period: string; label: string; counts: { sales: number; purchases: number };
  outputTax: number; itc: number; cashPayable: number; due: { gstr1: string; gstr3b: string };
  warnings: string[]; recent: Array<{ at: string; user: string | null; action: string; entityType: string; summary: string }>;
}

export default function HomePage() {
  const { data, error } = useLoad<Home>("/api/home");
  if (error) return <Err error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <h1>This month: {data.label}</h1>
      {data.warnings.map((w) => <div key={w} className="notice">{w}</div>)}
      <div className="stats">
        <div className="stat">Sales entered<b>{data.counts.sales}</b></div>
        <div className="stat">Purchase bills<b>{data.counts.purchases}</b></div>
        <div className="stat">Output tax<b><Money p={data.outputTax} /></b></div>
        <div className="stat">Input tax credit<b><Money p={data.itc} /></b></div>
        <div className="stat">Cash payable (estimate)<b><Money p={data.cashPayable} /></b></div>
      </div>
      <p>GSTR-1 due <b>{data.due.gstr1}</b> · GSTR-3B due <b>{data.due.gstr3b}</b> · <Link href={`/returns/${data.period}`}>Open this period&apos;s returns</Link></p>
      <div className="actions">
        <Link className="button primary" href="/sales/new">New sale</Link>
        <Link className="button" href="/purchases/new">New purchase bill</Link>
      </div>
      <h2>Recent activity</h2>
      {data.recent.length === 0 ? <p className="muted">Nothing yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>{data.recent.map((r, i) => (
            <tr key={i}><td>{new Date(r.at).toLocaleString("en-IN")}</td><td>{r.user ?? ""}</td><td>{r.action} {r.entityType}: {r.summary}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

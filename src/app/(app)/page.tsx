"use client";

import Link from "next/link";
import { useApp } from "@/components/shell";
import { Err, Loading, Money, useLoad } from "@/components/ui";

interface Home {
  period: string; label: string; counts: { sales: number; purchases: number };
  outputTax: number; itc: number; cashPayable: number; due: { gstr1: string; gstr3b: string };
  warnings: string[]; setup: { business: boolean; parties: boolean; sale: boolean };
  recent: Array<{ at: string; user: string | null; action: string; entityType: string; summary: string }>;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function HomePage() {
  const { me } = useApp();
  const { data, error } = useLoad<Home>("/api/home");
  if (error) return <Err error={error} />;
  if (!data) return <Loading />;
  const todo = [
    { done: data.setup.business, text: "Add your business details and GSTIN", href: "/settings" },
    { done: data.setup.parties, text: "Add a customer or supplier", href: "/parties" },
    { done: data.setup.sale, text: "Make your first sale", href: "/sales/new" },
  ];
  const settingUp = todo.some((t) => !t.done);

  return (
    <>
      <h1>Hello, {me.name.split(" ")[0]}</h1>
      {data.warnings.map((w) => <div key={w} className="notice">{w}</div>)}

      {settingUp ? (
        <div className="box">
          <b>Getting started</b>
          <ul className="plain">
            {todo.map((t) => <li key={t.text}>{t.done ? <s>{t.text}</s> : <Link href={t.href}>{t.text}</Link>}{t.done ? " ✓" : ""}</li>)}
          </ul>
          <p className="muted">New here? <Link href="/tutorial">Open the tutorial</Link>.</p>
        </div>
      ) : null}

      <div className="actions">
        <Link className="button primary big" href="/sales/new">New sale</Link>
        <Link className="button big" href="/purchases/new">New purchase bill</Link>
        <Link className="button big" href={`/returns/${data.period}`}>Month-end returns</Link>
      </div>

      <h2>{data.label}</h2>
      <div className="stats">
        <div className="stat">GST on your sales<b><Money p={data.outputTax} /></b><small>{data.counts.sales} sale(s)</small></div>
        <div className="stat">Credit from your bills<b><Money p={data.itc} /></b><small>{data.counts.purchases} bill(s)</small></div>
        <div className="stat">You will likely pay<b>₹ <Money p={data.cashPayable} /></b><small>estimate so far</small></div>
      </div>
      <p>Returns for {data.label} are due: <b>GSTR-1 by {fmtDate(data.due.gstr1)}</b>, <b>GSTR-3B by {fmtDate(data.due.gstr3b)}</b>.</p>

      <details className="more">
        <summary>Recent activity</summary>
        {data.recent.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="plain">
            {data.recent.map((r, i) => <li key={i}>{new Date(r.at).toLocaleString("en-IN")} – {r.summary || `${r.action} ${r.entityType}`}{r.user ? ` (${r.user})` : ""}</li>)}
          </ul>
        )}
      </details>
    </>
  );
}

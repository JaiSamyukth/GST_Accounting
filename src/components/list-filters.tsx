"use client";

import { Field } from "./ui";

export interface Filters { period: string; from: string; to: string; q: string; docType: string; status: string; page: number }
export const emptyFilters = (period: string): Filters => ({ period, from: "", to: "", q: "", docType: "", status: "", page: 1 });

export function ListFilters({ f, set, periods, extra }: {
  f: Filters; set: (f: Filters) => void; periods: Array<{ key: string; label: string }>; extra?: React.ReactNode;
}) {
  const up = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set({ ...f, [k]: e.target.value, page: 1 });
  return (
    <div className="filters">
      <Field label="Period">
        <select value={f.period} onChange={up("period")}>
          <option value="">Custom dates</option>
          {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </Field>
      {!f.period ? (
        <>
          <Field label="From"><input type="date" value={f.from} onChange={up("from")} /></Field>
          <Field label="To"><input type="date" value={f.to} onChange={up("to")} /></Field>
        </>
      ) : null}
      <Field label="Type">
        <select value={f.docType} onChange={up("docType")}>
          <option value="">All</option><option value="invoice">Invoice</option><option value="credit_note">Credit note</option><option value="debit_note">Debit note</option>
        </select>
      </Field>
      <Field label="Status">
        <select value={f.status} onChange={up("status")}><option value="">All</option><option value="active">Active</option><option value="cancelled">Cancelled</option></select>
      </Field>
      {extra}
      <Field label="Search"><input value={f.q} onChange={up("q")} placeholder="Number, name or GSTIN" /></Field>
    </div>
  );
}

export function Pager({ page, pageSize, total, go }: { page: number; pageSize: number; total: number; go: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="actions">
      <button disabled={page <= 1} onClick={() => go(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button disabled={page >= pages} onClick={() => go(page + 1)}>Next</button>
    </div>
  );
}

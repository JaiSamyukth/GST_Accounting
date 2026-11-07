"use client";

import { useCallback, useEffect, useState } from "react";
import { formatINR } from "@/lib/money";
import { api, errorText } from "./api";

export function Money({ p }: { p: number | null | undefined }) {
  return <>{p == null ? "" : formatINR(p)}</>;
}

export function Err({ error }: { error: string | null | undefined }) {
  return error ? <div className="error" role="alert">{error}</div> : null;
}

export function Ok({ message }: { message: string | null | undefined }) {
  return message ? <div className="ok" role="status">{message}</div> : null;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>
        {label}
        {children}
      </label>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="check">
      <label>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    </div>
  );
}

/** Load JSON from a GET endpoint; `reload()` re-fetches. */
export function useLoad<T>(path: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: "", data: null, error: null });
  const key = path ? `${path}#${tick}` : "";
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path)
      .then((d) => { if (live) setState({ key, data: d, error: null }); })
      .catch((e) => { if (live) setState((s) => ({ key, data: s.data, error: errorText(e) })); });
    return () => { live = false; };
  }, [path, key]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // Keep showing the previous data while a reload is in flight.
  return { data: state.data, error: state.key === key ? state.error : null, loading: !!path && state.key !== key, reload };
}

export function Loading({ what = "Loading…" }: { what?: string }) {
  return <p className="muted">{what}</p>;
}

export function rupeesInput(p: number): string {
  return (p / 100).toFixed(2);
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const DOC_LABEL: Record<string, string> = { invoice: "Invoice", credit_note: "Credit note", debit_note: "Debit note" };

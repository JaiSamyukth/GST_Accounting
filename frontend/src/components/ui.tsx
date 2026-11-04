import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IX } from "./icons";
import { rupees } from "../lib/format";
import { GLOSSARY } from "../lib/glossary";

/* ------------------------------------------------------------------ toast */
type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, bad }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), bad ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.bad ? "bad" : ""}`}>
            <span>{t.text}</span>
            <button aria-label="Dismiss" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ modal */
export function Modal({ title, onClose, children, foot, wide }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    (first || ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, [tabindex='0']"));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, [onClose]);
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 className="h2" id={id}>{title}</h2>
          <button className="iconbtn" data-close aria-label="Close" onClick={onClose}><IX /></button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ title, text, okLabel = "Yes, continue", danger, onOk, onClose }: { title: string; text: ReactNode; okLabel?: string; danger?: boolean; onOk: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} foot={<>
      <button className="btn quiet" onClick={onClose}>Go back</button>
      <button className={`btn ${danger ? "danger" : "primary"}`} disabled={busy} onClick={async () => { setBusy(true); try { await onOk(); } finally { setBusy(false); } }}>{okLabel}</button>
    </>}>
      <div className="prose">{text}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ fields */
export function Field({ label, hint, error, children, className = "", htmlFor, term }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string; term?: string }) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={htmlFor}>{label}{term && <Term k={term} icon />}</label>
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Money({ v, className = "", sign }: { v: unknown; className?: string; sign?: boolean }) {
  return <span className={`num ${className}`}>{rupees(v, { sign })}</span>;
}

export function Leaders({ rows }: { rows: { label: ReactNode; value: ReactNode; grand?: boolean; strong?: boolean }[] }) {
  return (
    <ul className="leaders">
      {rows.map((r, i) => (
        <li key={i} className={r.grand ? "grand" : ""}>
          <span className={r.strong || r.grand ? "strong" : ""}>{r.label}</span>
          <span className="dots" aria-hidden="true" />
          <span className={`val ${r.grand ? "total" : r.strong ? "strong" : ""}`}>{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Loading({ text = "Opening the book" }: { text?: string }) {
  return <div className="loading" role="status">{text}…</div>;
}

export function ErrorNote({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="note bad" role="alert">
      <p>{error}</p>
      {retry && <button className="linkbtn" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ glossary term with a plain explanation */
export function Term({ k, children, icon }: { k: string; children?: ReactNode; icon?: boolean }) {
  const g = GLOSSARY[k];
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 32);
    setPos({ left: Math.max(16, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - w - 16)), top: r.bottom + window.scrollY + 8 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!(e.target as Node)?.isConnected || !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!g) return <>{children}</>;
  return (
    <>
      <button type="button" ref={btn} className={icon ? "iconbtn term-i" : "term"} aria-expanded={open} aria-describedby={open ? id : undefined}
        aria-label={icon ? `What is ${g.term}?` : undefined} onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        style={icon ? { width: 24, height: 24, fontSize: 13, fontWeight: 700, border: "1.5px solid var(--ink-3)", borderRadius: "50%", color: "var(--ink-2)" } : undefined}>
        {icon ? "?" : children ?? g.term}
      </button>
      {open && createPortal(<div className="term-pop" role="tooltip" id={id} style={pos}><b>{g.term}</b>{g.text}</div>, document.body)}
    </>
  );
}

export function StatusTag({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    open: ["", "Not filed"], approved: ["warn", "Approved"], filed: ["ok", "Filed"],
    matched: ["ok", "Matched"], probable: ["warn", "Probably matched"], mismatch: ["bad", "Amounts differ"],
    missing_in_2b: ["bad", "Not in GSTR-2B"], missing_in_books: ["warn", "Not in your books"], pending: ["", "Not checked"],
    committed: ["ok", "Imported"], rolled_back: ["", "Undone"], active: ["ok", "Active"], cancelled: ["bad", "Cancelled"], amended: ["warn", "Amended"],
  };
  const [cls, label] = map[s] || ["", s];
  return <span className={`tag ${cls}`}>{label}</span>;
}

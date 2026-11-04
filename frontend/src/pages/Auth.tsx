import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTitle } from "../lib/hooks";
import { Field } from "../components/ui";

function AuthSheet({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="carbon-wrap">
        <div className="carbon-copy" aria-hidden="true" />
        <div className="sheet">
          <div className="auth-head">
            <div className="tiny muted">Dev Caters · 513, Vasan Nagar, Trichy</div>
            <h1 className="h1" style={{ marginTop: 10 }}>{title}</h1>
            <p>{sub}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

export function Login() {
  useTitle("Sign in");
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/auth/login", { body: { email, password: pw } });
      await refresh();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthSheet title="GST books" sub="Sign in to record bills and prepare this month's returns.">
      <form onSubmit={submit} noValidate>
        <Field label="Email" htmlFor="em"><input id="em" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password" htmlFor="pw" error={err}><input id="pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required aria-invalid={!!err} /></Field>
        <button className="btn primary block" disabled={busy || !email || !pw}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="small muted" style={{ margin: 0 }}>Forgot the password? Ask the owner to send you a reset link from Settings, Users.</p>
      </form>
    </AuthSheet>
  );
}

export function Setup() {
  useTitle("Set up");
  const { refresh } = useAuth();
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/auth/setup", { body: f });
      await refresh();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthSheet title="First, the owner's account" sub="This is done once. You can add your accountant later from Settings.">
      <form onSubmit={submit}>
        <Field label="Your name" htmlFor="n"><input id="n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required /></Field>
        <Field label="Email" htmlFor="e"><input id="e" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" required /></Field>
        <Field label="Password" htmlFor="p" hint="At least 10 characters, with letters and numbers" error={err}>
          <input id="p" className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" required />
        </Field>
        <button className="btn primary block" disabled={busy}>{busy ? "Creating…" : "Create account and open the books"}</button>
      </form>
    </AuthSheet>
  );
}

export function ResetPassword() {
  useTitle("Set a new password");
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [pw, setPw] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/auth/reset", { body: { token, new_password: pw } });
      setDone(true);
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <AuthSheet title="Set your password" sub="Choose a password you will remember. At least 10 characters, with letters and numbers.">
      {done ? (
        <div style={{ padding: "22px 28px 28px" }}>
          <p>Your password is set.</p>
          <a className="btn primary" href="/">Sign in</a>
        </div>
      ) : (
        <form onSubmit={submit}>
          <Field label="New password" htmlFor="np" error={err}><input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <button className="btn primary block" disabled={!token || pw.length < 10}>Save password</button>
          {!token && <p className="small bad-ink">This link is incomplete. Ask the owner for a new one.</p>}
        </form>
      )}
    </AuthSheet>
  );
}

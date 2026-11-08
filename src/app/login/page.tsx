"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorText } from "@/components/api";
import { Err, Field } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ hasUsers: boolean; user: unknown }>("/api/auth/status").then((s) => {
      if (!s.hasUsers) router.replace("/setup");
      else if (s.user) router.replace("/");
    }).catch(() => undefined);
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { email, password } });
      router.replace("/");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <Field label="Email"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Err error={error} />
        <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="muted">Forgot your password? Ask the owner for a reset link.</p>
    </main>
  );
}

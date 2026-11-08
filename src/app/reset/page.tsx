"use client";

import Link from "next/link";
import { useState } from "react";
import { api, errorText } from "@/components/api";
import { Err, Field } from "@/components/ui";

export default function ResetPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords do not match");
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    try {
      await api("/api/auth/reset", { body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (done) return <main className="narrow"><h1>Password set</h1><p><Link href="/login">Sign in</Link> with your new password.</p></main>;
  return (
    <main className="narrow">
      <h1>Set a new password</h1>
      <form onSubmit={submit}>
        <Field label="New password" hint="At least 10 characters, with letters and numbers."><input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Confirm password"><input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <Err error={error} />
        <button className="primary">Set password</button>
      </form>
    </main>
  );
}

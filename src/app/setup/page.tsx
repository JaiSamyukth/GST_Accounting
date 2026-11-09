"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorText } from "@/components/api";
import { Err, Field } from "@/components/ui";
import { STATES } from "@/lib/gst/gstin";

export default function SetupPage() {
  const router = useRouter();
  const [f, setF] = useState({ businessName: "", stateCode: "33", name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api<{ hasUsers: boolean }>("/api/auth/status").then((s) => { if (s.hasUsers) router.replace("/login"); }).catch(() => undefined);
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError("The two passwords do not match");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/setup", { body: { businessName: f.businessName, stateCode: f.stateCode, name: f.name, email: f.email, password: f.password } });
      router.replace("/settings");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <h1>Set up</h1>
      <p>Create the owner account. You can fill in GSTIN and other details in Settings next.</p>
      <form onSubmit={submit}>
        <Field label="Business name"><input required value={f.businessName} onChange={set("businessName")} /></Field>
        <Field label="State">
          <select value={f.stateCode} onChange={set("stateCode")}>
            {Object.entries(STATES).filter(([c]) => c !== "96" && c !== "97").map(([c, n]) => <option key={c} value={c}>{c} – {n}</option>)}
          </select>
        </Field>
        <Field label="Your name"><input required value={f.name} onChange={set("name")} /></Field>
        <Field label="Email"><input type="email" autoComplete="username" required value={f.email} onChange={set("email")} /></Field>
        <Field label="Password" hint="At least 10 characters, with letters and numbers."><input type="password" autoComplete="new-password" required value={f.password} onChange={set("password")} /></Field>
        <Field label="Confirm password"><input type="password" autoComplete="new-password" required value={f.confirm} onChange={set("confirm")} /></Field>
        <Err error={error} />
        <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create owner account"}</button>
      </form>
    </main>
  );
}

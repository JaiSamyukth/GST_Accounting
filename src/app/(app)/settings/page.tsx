"use client";

import { BusinessSection, HsnSection, LogSection, PasswordSection, RatesSection, UsersSection } from "@/components/settings-sections";
import { useApp } from "@/components/shell";

export default function SettingsPage() {
  const { me } = useApp();
  const owner = me.role === "owner";
  return (
    <>
      <h1>Settings</h1>
      <p>
        <a href="#business">Business</a> · <a href="#password">Password</a> · <a href="#rates">Tax rates</a> · <a href="#hsn">HSN/SAC</a>
        {owner ? <> · <a href="#users">Users</a> · <a href="#log">Audit log</a> · <a href="#backup">Backup</a></> : null}
      </p>
      <h2 id="business">Business</h2>
      <BusinessSection />
      <h2 id="password">Your password</h2>
      <PasswordSection />
      <h2 id="rates">Tax rates</h2>
      <RatesSection />
      <h2 id="hsn">HSN / SAC codes</h2>
      <HsnSection />
      {owner ? <>
        <h2 id="users">Users</h2>
        <UsersSection />
        <h2 id="log">Audit log and sign-ins</h2>
        <LogSection />
        <h2 id="backup">Backup</h2>
        <p>Download every table as JSON in one ZIP file. Password hashes are not included. Attached files stay in object storage.</p>
        <p><a className="button" href="/api/backup">Download backup</a></p>
      </> : null}
    </>
  );
}

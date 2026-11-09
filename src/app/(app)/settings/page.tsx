"use client";

import Link from "next/link";
import { BusinessSection, HsnSection, LogSection, PasswordSection, RatesSection, RestoreSection, UsersSection } from "@/components/settings-sections";
import { useApp } from "@/components/shell";

function Section({ id, title, hint, open, children }: { id: string; title: string; hint: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="section" id={id} open={open}>
      <summary>{title}</summary>
      <p className="muted">{hint}</p>
      {children}
    </details>
  );
}

export default function SettingsPage() {
  const { me } = useApp();
  const owner = me.role === "owner";
  // Open the section named in the address (e.g. /settings#password from a notice).
  const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  return (
    <>
      <h1>Settings</h1>
      <div className="box">
        <b>New to the app, or need a reminder?</b>
        <p>The tutorial walks through everything step by step: setting up, sales, bills and filing returns.</p>
        <Link className="button primary" href="/tutorial">Open the tutorial</Link>
      </div>
      <Section id="business" title="Business details" hint="Your name, GSTIN, state and how often you file. Fill this in first." open={!hash || hash === "business"}>
        <BusinessSection />
      </Section>
      <Section id="password" title="Your password and sign-ins" hint="Change your password, or sign out other devices." open={hash === "password"}>
        <PasswordSection />
      </Section>
      {owner ? (
        <Section id="users" title="Users" hint="Give your accountant their own sign-in." open={hash === "users"}>
          <UsersSection />
        </Section>
      ) : null}
      {owner ? (
        <Section id="backup" title="Backup and restore" hint="Download a copy of everything after each month's filing." open={hash === "backup"}>
          <p><a className="button" href="/api/backup">Download backup</a></p>
          <h3>Restore</h3>
          <p>Moving to a new database, or recovering after a loss? Set up a fresh installation, sign in as the owner, then restore the backup here.
            It only works while the new installation has no sales, purchases, customers or returns. User accounts are not restored.
            Attached files are not inside the backup: point the new installation at the same storage bucket and they reappear.</p>
          <RestoreSection />
        </Section>
      ) : null}
      <Section id="rates" title="GST rates" hint="The rates offered on bills. Usually nothing to change here." open={hash === "rates"}>
        <RatesSection />
      </Section>
      <Section id="hsn" title="HSN / SAC codes" hint="Codes suggested when you type on a bill. Common catering codes are already added." open={hash === "hsn"}>
        <HsnSection />
      </Section>
      {owner ? (
        <Section id="log" title="Activity log" hint="Every change, who made it and when; and every sign-in." open={hash === "log"}>
          <LogSection />
        </Section>
      ) : null}
    </>
  );
}

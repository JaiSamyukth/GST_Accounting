"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

export interface Me { id: number; email: string; name: string; role: "owner" | "accountant"; mustChangePassword: boolean }
export interface Meta {
  states: Array<{ code: string; name: string }>;
  supplyKinds: string[];
  rates: Array<{ id: number; rateBp: number; label: string }>;
  uqc: string[];
  categories: Array<{ key: string; label: string; blocked: boolean }>;
  documentKinds: string[];
  itcRules: Array<{ key: string; label: string }>;
  business: { legalName: string; tradeName: string; gstin: string; stateCode: string; filingFrequency: "monthly" | "quarterly"; defaultPriceMode: "exclusive" | "inclusive"; noItcScheme: boolean; fyStartYear: number };
  fy: { startYear: number; label: string };
  periods: Array<{ key: string; label: string }>;
  currentPeriod: string;
  today: string;
}

const Ctx = createContext<{ me: Me; meta: Meta; refreshMeta: () => void } | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside Shell");
  return c;
}

const NAV = [
  ["/", "This month"], ["/sales", "Sales"], ["/purchases", "Purchases"], ["/returns", "Returns"],
  ["/reports", "Reports"], ["/import", "Import"], ["/parties", "Parties"], ["/settings", "Settings"],
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const s = await api<{ hasUsers: boolean; user: Me | null }>("/api/auth/status");
        if (!s.hasUsers) return router.replace("/setup");
        if (!s.user) return router.replace("/login");
        const m = await api<Meta>("/api/meta");
        if (live) {
          setMe(s.user);
          setMeta(m);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { live = false; };
  }, [router, tick]);

  if (error) return <main><div className="error">Could not load the app: {error}</div><button onClick={() => location.reload()}>Try again</button></main>;
  if (!me || !meta) return <main><p className="muted">Loading…</p></main>;

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  };
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  return (
    <Ctx.Provider value={{ me, meta, refreshMeta: () => setTick((t) => t + 1) }}>
      <div className="topbar">
        <span className="name">{meta.business.tradeName || meta.business.legalName || "GST-Invoice"}</span>
        <span className="muted">{me.name} ({me.role})</span>
        <button className="link" onClick={signOut}>Sign out</button>
      </div>
      <nav className="nav" aria-label="Main">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className={active(href) ? "active" : undefined}>{label}</Link>
        ))}
      </nav>
      <main>
        {me.mustChangePassword && path !== "/settings" ? (
          <div className="notice">Please set a new password in <Link href="/settings#password">Settings</Link>.</div>
        ) : null}
        {children}
      </main>
    </Ctx.Provider>
  );
}

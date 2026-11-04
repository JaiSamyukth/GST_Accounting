import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export type User = { id: number; email: string; name: string; role: "owner" | "accountant"; must_change_password: boolean; tutorial_done: boolean };
type Meta = { states: { code: string; name: string }[]; uqc: string[]; rates: { id: number; rate: string; label: string; active: boolean }[]; current_fy: string; current_period: string; periods: { key: string; label: string }[]; previous_periods: { key: string; label: string }[] };
type Ctx = { user: User | null; meta: Meta | null; business: any; needsSetup: boolean; ready: boolean; refresh: () => Promise<void>; setUser: (u: User | null) => void; reloadMeta: () => Promise<void> };

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [business, setBusiness] = useState<any>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [ready, setReady] = useState(false);

  const reloadMeta = useCallback(async () => {
    const [m, b] = await Promise.all([api<Meta>("/meta"), api("/business")]);
    setMeta(m);
    setBusiness(b);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api<{ needs_setup: boolean; user: User | null }>("/auth/status");
      setNeedsSetup(s.needs_setup);
      if (s.needs_setup || !s.user) { setUser(null); return; }
      setUser(s.user);
      await reloadMeta();
    } finally {
      setReady(true);
    }
  }, [reloadMeta]);

  useEffect(() => {
    refresh();
    const out = () => setUser(null);
    window.addEventListener("dc:signed-out", out);
    return () => window.removeEventListener("dc:signed-out", out);
  }, [refresh]);

  return <AuthCtx.Provider value={{ user, meta, business, needsSetup, ready, refresh, setUser, reloadMeta }}>{children}</AuthCtx.Provider>;
}

export const stateName = (meta: Meta | null, code?: string) => meta?.states.find((s) => s.code === code)?.name || code || "";

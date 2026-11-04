import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { IBook, IDocs, IHelp, IHome, IImport, IMore, IPeople, IPurchase, IReports, IReturns, ISales, ISettings } from "./icons";
import { Modal } from "./ui";
import { Tour } from "./Tour";

const PRIMARY = [
  { to: "/", label: "This month", short: "Home", icon: IHome, tour: "home" },
  { to: "/sales", label: "Sales", short: "Sales", icon: ISales, tour: "sales" },
  { to: "/purchases", label: "Purchases", short: "Purchases", icon: IPurchase, tour: "purchases" },
  { to: "/returns", label: "GST returns", short: "Returns", icon: IReturns, tour: "returns" },
];
const SECONDARY = [
  { to: "/reports", label: "Reports", icon: IReports, tour: "reports" },
  { to: "/import", label: "Import from Excel", icon: IImport, tour: "import" },
  { to: "/documents", label: "Documents", icon: IDocs },
  { to: "/parties", label: "Customers & suppliers", icon: IPeople },
  { to: "/settings", label: "Settings", icon: ISettings },
  { to: "/guide", label: "Guide & help", icon: IHelp, tour: "guide" },
];

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Dev Caters GST books, home">
      <span className="brand-mark" aria-hidden="true"><i /><i>D</i></span>
      <span><b>DEV CATERS</b><small>GST books</small></span>
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const [more, setMore] = useState(false);
  const [tour, setTour] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setMore(false), [loc.pathname]);
  useEffect(() => {
    if (user && !user.tutorial_done) {
      const t = setTimeout(() => setTour(true), 600);
      return () => clearTimeout(t);
    }
  }, [user]);
  useEffect(() => {
    const start = () => { nav("/"); setTimeout(() => setTour(true), 300); };
    window.addEventListener("dc:tour", start);
    return () => window.removeEventListener("dc:tour", start);
  }, [nav]);
  const isMore = SECONDARY.some((s) => loc.pathname.startsWith(s.to));
  const signOut = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    nav("/");
  };
  return (
    <div className="shell">
      <a href="#main" className="skip">Skip to content</a>
      <header className="topbar">
        <Brand />
        <Link to="/guide" className="iconbtn" style={{ color: "#fff" }} aria-label="Guide and help"><IHelp /></Link>
      </header>
      <nav className="rail" aria-label="Main">
        <Brand />
        {PRIMARY.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} className="nav-link" data-tour={n.tour}>
            <n.icon />{n.label}
          </NavLink>
        ))}
        <div className="nav-sep">More</div>
        {SECONDARY.map((n) => (
          <NavLink key={n.to} to={n.to} className="nav-link" data-tour={n.tour}>
            <n.icon />{n.label}
          </NavLink>
        ))}
        <div className="rail-foot">
          <div>{user?.name} · {user?.role === "owner" ? "Owner" : "Accountant"}</div>
          <button onClick={() => setTour(true)}>Show me around</button> · <button onClick={signOut}>Sign out</button>
        </div>
      </nav>
      <main id="main" className="main" tabIndex={-1}>{children}</main>
      <nav className="tabbar" aria-label="Main">
        {PRIMARY.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} data-tour={`m-${n.tour}`}><n.icon />{n.short}</NavLink>
        ))}
        <button onClick={() => setMore(true)} aria-current={isMore ? "page" : undefined} aria-haspopup="dialog"><IMore />More</button>
      </nav>
      {more && (
        <Modal title="More" onClose={() => setMore(false)}>
          <div style={{ display: "grid", gap: 4 }}>
            {SECONDARY.map((n) => (
              <NavLink key={n.to} to={n.to} className="nav-link" style={{ color: "var(--ink)" }}><n.icon />{n.label}</NavLink>
            ))}
            <button className="nav-link" style={{ color: "var(--ink)", background: "none", border: 0, cursor: "pointer" }} onClick={() => { setMore(false); setTour(true); }}><IBook />Show me around</button>
            <button className="nav-link" style={{ color: "var(--ink)", background: "none", border: 0, cursor: "pointer" }} onClick={signOut}>Sign out ({user?.name})</button>
          </div>
        </Modal>
      )}
      {tour && <Tour onClose={() => setTour(false)} />}
    </div>
  );
}

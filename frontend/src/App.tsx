import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Loading } from "./components/ui";
import { useAuth } from "./lib/auth";
import { Login, ResetPassword, Setup } from "./pages/Auth";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";

const SalesList = lazy(() => import("./pages/Sales").then((m) => ({ default: m.SalesList })));
const PurchaseList = lazy(() => import("./pages/Purchases").then((m) => ({ default: m.PurchaseList })));
const DocEditor = lazy(() => import("./pages/DocEditor").then((m) => ({ default: m.DocEditor })));
const Returns = lazy(() => import("./pages/Returns").then((m) => ({ default: m.Returns })));
const ReturnPeriod = lazy(() => import("./pages/ReturnPeriod").then((m) => ({ default: m.ReturnPeriod })));
const Reports = lazy(() => import("./pages/Reports").then((m) => ({ default: m.Reports })));
const Import = lazy(() => import("./pages/Import").then((m) => ({ default: m.Import })));
const Documents = lazy(() => import("./pages/Documents").then((m) => ({ default: m.Documents })));
const Parties = lazy(() => import("./pages/Parties").then((m) => ({ default: m.Parties })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Guide = lazy(() => import("./pages/Guide").then((m) => ({ default: m.Guide })));

export function App() {
  const { user, ready, needsSetup } = useAuth();
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [loc.pathname]);

  if (!ready) return <div className="auth"><Loading /></div>;
  if (loc.pathname.startsWith("/reset")) return <ResetPassword />;
  if (needsSetup) return <Setup />;
  if (!user) return <Login />;
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sales" element={<SalesList />} />
          <Route path="/sales/new" element={<DocEditor kind="sales" />} />
          <Route path="/sales/:id" element={<DocEditor kind="sales" />} />
          <Route path="/purchases" element={<PurchaseList />} />
          <Route path="/purchases/new" element={<DocEditor kind="purchase" />} />
          <Route path="/purchases/:id" element={<DocEditor kind="purchase" />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/returns/:period" element={<ReturnPeriod />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/import" element={<Import />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/parties" element={<Parties />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}

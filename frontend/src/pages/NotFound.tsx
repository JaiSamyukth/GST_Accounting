import { Link } from "react-router-dom";
import { useTitle } from "../lib/hooks";

export function NotFound() {
  useTitle("Page not found");
  return (
    <div className="page">
      <div className="carbon-wrap" style={{ maxWidth: 560, margin: "40px auto" }}>
        <div className="carbon-copy" aria-hidden="true" />
        <div className="sheet sheet-pad" style={{ textAlign: "center", padding: "48px 24px" }}>
          <span className="stamp">Page torn out</span>
          <h1 className="h1" style={{ margin: "22px 0 10px" }}>This page is not in the book</h1>
          <p className="muted">The link may be old, or the record was removed. Your entries are safe.</p>
          <div className="btn-row" style={{ justifyContent: "center", marginTop: 20 }}>
            <Link className="btn primary" to="/">Go to this month</Link>
            <Link className="btn quiet" to="/sales">Open sales</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

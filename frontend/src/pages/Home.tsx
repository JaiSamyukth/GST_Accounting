import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { date, daysUntil, dateTime } from "../lib/format";
import { useApi, useTitle } from "../lib/hooks";
import { IPlus, IPurchase } from "../components/icons";
import { ErrorNote, Leaders, Loading, Money, Term } from "../components/ui";
import { Steps } from "../components/Steps";

function Due({ label, iso, filed }: { label: string; iso: string; filed: boolean }) {
  const d = daysUntil(iso);
  if (filed) return <span className="tag ok">{label} filed</span>;
  const cls = d < 0 ? "bad" : d <= 5 ? "warn" : "";
  const when = d < 0 ? `${-d} days late` : d === 0 ? "due today" : `due ${date(iso)}, ${d} days`;
  return <span className={`tag ${cls}`}>{label} {when}</span>;
}

export function Home() {
  const { user, meta } = useAuth();
  const period = meta?.current_period || "";
  const home = useApi<any>(period ? `/home?period=${period}` : null, [period]);
  const ov = useApi<any>(period ? `/returns/${period}` : null, [period]);
  useTitle("This month");
  if (home.error) return <div className="page"><ErrorNote error={home.error} retry={home.reload} /></div>;
  if (!home.data) return <Loading />;
  const h = home.data;
  const first = user?.name?.split(" ")[0];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="muted" style={{ margin: 0 }}>Vanakkam{first ? `, ${first}` : ""}. Here is the month so far.</p>
          <h1 className="h1" style={{ marginTop: 4 }}>{h.label}</h1>
        </div>
        <div className="btn-row">
          <Due label="GSTR-1" iso={h.gstr1_due} filed={h.gstr1_status === "filed"} />
          <Due label="GSTR-3B" iso={h.gstr3b_due} filed={h.gstr3b_status === "filed"} />
        </div>
      </div>

      {h.setup_missing.length > 0 && (
        <div className="note carbon" style={{ marginBottom: 20 }}>
          <p><b>One thing first:</b> add your {h.setup_missing.join(" and ")} in <Link to="/settings">Settings</Link>. Returns cannot be prepared without it.</p>
        </div>
      )}
      {h.pending_previous && (
        <div className="note warn" style={{ marginBottom: 20 }}>
          <p><b>{h.pending_previous.label} is not filed yet.</b> GSTR-1 {daysUntil(h.pending_previous.gstr1_due) < 0 ? "was" : "is"} due {date(h.pending_previous.gstr1_due)} and GSTR-3B {date(h.pending_previous.gstr3b_due)}. <Link to={`/returns/${h.pending_previous.period}`}>Finish {h.pending_previous.label}</Link></p>
        </div>
      )}

      <div className="quick">
        <Link to="/sales/new" data-tour="new-sale">
          <span className="ico" aria-hidden="true"><IPlus /></span>
          <span><b>Write a sale bill</b><span>A page of the order book, for a customer</span></span>
        </Link>
        <Link to="/purchases/new">
          <span className="ico" aria-hidden="true"><IPurchase /></span>
          <span><b>Enter a purchase bill</b><span>Provisions, gas, plates, any supplier bill</span></span>
        </Link>
      </div>

      <div className="month-grid">
        <section className="sheet" aria-labelledby="fig">
          <div className="sheet-head"><h2 className="h2" id="fig">The month in figures</h2><Link className="linkbtn small" to="/reports">All reports</Link></div>
          <div className="sheet-pad">
            <Leaders rows={[
              { label: <Link to="/sales" className="linkbtn" style={{ fontWeight: 400 }}>Sales this month, {h.sales_count} {h.sales_count === 1 ? "bill" : "bills"}</Link>, value: <Money v={h.sales_total} /> },
              { label: <Link to="/purchases" className="linkbtn" style={{ fontWeight: 400 }}>Purchases this month, {h.purchase_count} {h.purchase_count === 1 ? "bill" : "bills"}</Link>, value: <Money v={h.purchase_total} /> },
              { label: "GST charged on sales", value: <Money v={h.output_tax} /> },
              { label: <>Less <Term k="itc">input tax credit</Term></>, value: <Money v={-h.eligible_itc} /> },
              { label: "GST to pay in cash", value: <Money v={h.net_payable} />, grand: true },
            ]} />
            <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
              Pay it by {date(h.gstr3b_due)} with <Term k="gstr3b">GSTR-3B</Term>.
              {!h.has_2b && <> Credit is taken from your bills until the month's <Term k="gstr2b">GSTR-2B</Term> is imported.</>}
            </p>
          </div>
        </section>

        <section className="sheet" aria-labelledby="todo">
          <div className="sheet-head"><h2 className="h2" id="todo">Closing {h.label.split(" ")[0]}</h2><Link className="linkbtn small" to={`/returns/${h.period}`}>Open returns</Link></div>
          <div className="sheet-pad" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {ov.data ? <Steps steps={ov.data.steps} period={h.period} /> : ov.error ? <ErrorNote error={ov.error} /> : <Loading text="Checking the month" />}
          </div>
        </section>
      </div>

      {h.recent.length > 0 && (
        <section className="sheet" style={{ marginTop: 24 }} aria-labelledby="rec">
          <div className="sheet-head"><h2 className="h2" id="rec">Recently written</h2></div>
          <ul style={{ listStyle: "none", margin: 0, padding: "4px 24px 12px" }}>
            {h.recent.map((r: any, i: number) => (
              <li key={i} style={{ display: "flex", gap: 12, justifyContent: "space-between", padding: "10px 0", borderBottom: i < h.recent.length - 1 ? "1px solid var(--rule-2)" : 0, flexWrap: "wrap" }}>
                <span>{r.entity_type === "sales" ? <Link className="linkbtn" style={{ fontWeight: 400 }} to={`/sales/${r.entity_id}`}>{r.summary}</Link>
                  : r.entity_type === "purchase" ? <Link className="linkbtn" style={{ fontWeight: 400 }} to={`/purchases/${r.entity_id}`}>{r.summary}</Link> : r.summary}</span>
                <span className="small muted">{dateTime(r.at)} · {r.user}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

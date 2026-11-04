import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { date } from "../lib/format";
import { useApi, useTitle } from "../lib/hooks";
import { ErrorNote, Loading, Money, StatusTag, Term } from "../components/ui";

export function Returns() {
  useTitle("GST returns");
  const { meta, business } = useAuth();
  const nav = useNavigate();
  const fy = meta?.current_fy || "";
  const prev = fy ? `${parseInt(fy.slice(0, 4), 10) - 1}-${fy.slice(2, 4)}` : "";
  const [year, setYear] = useState(fy);
  const { data, error, reload } = useApi<any[]>(year ? `/returns?fy=${year}` : null, [year]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">GST returns</h1>
          <p className="lede muted">One line per {business?.filing_frequency === "quarterly" ? "quarter" : "month"}. Open a month to check <Term k="gstr1">GSTR-1</Term> and <Term k="gstr3b">GSTR-3B</Term>, download the files for the GST portal and save the <Term k="arn">ARN</Term>.</p>
        </div>
        <div className="field">
          <label htmlFor="fy">Financial year</label>
          <select id="fy" className="select boxed" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value={fy}>{fy} (this year)</option><option value={prev}>{prev}</option>
          </select>
        </div>
      </div>
      {error ? <ErrorNote error={error} retry={reload} /> : !data ? <Loading /> : (
        <div className="sheet">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
            <table className="ruled cards">
              <thead>
                <tr><th scope="col">Period</th><th scope="col">GSTR-1</th><th scope="col">GSTR-3B</th><th scope="col" className="num">GST on sales</th><th scope="col" className="num">Credit</th><th scope="col" className="num">Pay in cash</th></tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.period} className="clickable" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) nav(`/returns/${p.period}`); }}>
                    <td className="cell-main"><Link className="rowlink" to={`/returns/${p.period}`}>{p.label}</Link>{p.locked && <span className="tag ok" style={{ marginLeft: 8 }}>Locked</span>}
                      <div className="tiny muted">{p.sales_count} sales · {p.purchase_count} bills</div></td>
                    <td className="cell-main"><StatusTag s={p.gstr1_status} /> <span className="tiny muted">{p.gstr1_status === "filed" ? `ARN ${p.gstr1_arn}` : `due ${date(p.gstr1_due)}`}</span></td>
                    <td className="hide-sm"><StatusTag s={p.gstr3b_status} /> <span className="tiny muted">{p.gstr3b_status === "filed" ? `ARN ${p.gstr3b_arn}` : `due ${date(p.gstr3b_due)}`}</span>
                      {p.overdue && <span className="tag bad" style={{ marginLeft: 6 }}>Late</span>}</td>
                    <td className="num hide-sm"><Money v={p.output_tax} /></td>
                    <td className="num hide-sm"><Money v={p.eligible_itc} /></td>
                    <td className="num cell-amt"><Money v={p.net_payable} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.length === 0 && <div className="empty"><h2 className="h2">No periods yet</h2><p>This financial year has not started.</p></div>}
        </div>
      )}
    </div>
  );
}

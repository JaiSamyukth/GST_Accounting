import { useAuth } from "../lib/auth";
import { periodLabel } from "../lib/format";

/** Month/quarter/FY/all selector. Value forms: "2026-10", "2026-Q3", "fy:2026-27", "all", "range". */
export function PeriodPicker({ value, onChange, id = "per", allowAll = true, label = "Period" }: { value: string; onChange: (v: string) => void; id?: string; allowAll?: boolean; label?: string }) {
  const { meta } = useAuth();
  if (!meta) return null;
  const fy = meta.current_fy;
  const prevFy = `${parseInt(fy.slice(0, 4), 10) - 1}-${fy.slice(2, 4)}`;
  const now = meta.periods.filter((p) => p.key <= meta.current_period);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select boxed" value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label={`This year (${fy})`}>
          {now.slice().reverse().map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value={`fy:${fy}`}>Whole year {fy}</option>
        </optgroup>
        <optgroup label="Quarters">
          {[1, 2, 3, 4].map((q) => <option key={q} value={`${fy.slice(0, 4)}-Q${q}`}>{periodLabel(`${fy.slice(0, 4)}-Q${q}`)}</option>)}
          {[1, 2, 3, 4].map((q) => <option key={`p${q}`} value={`${prevFy.slice(0, 4)}-Q${q}`}>{periodLabel(`${prevFy.slice(0, 4)}-Q${q}`)}</option>)}
        </optgroup>
        <optgroup label={`Last year (${prevFy})`}>
          {meta.previous_periods.slice().reverse().map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value={`fy:${prevFy}`}>Whole year {prevFy}</option>
        </optgroup>
        {allowAll && <option value="all">All dates</option>}
        <option value="range">Pick dates…</option>
      </select>
    </div>
  );
}

export function periodQuery(value: string, from?: string, to?: string) {
  if (value === "all") return "";
  if (value === "range") return `from=${from || ""}&to=${to || ""}`;
  if (value.startsWith("fy:")) return `fy=${value.slice(3)}`;
  return `period=${value}`;
}

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** ₹1,23,450.00 */
export function rupees(v: unknown, opts: { sign?: boolean; whole?: boolean } = {}) {
  const n = num(v);
  const s = (opts.whole ? inr0 : inr).format(Math.abs(n));
  return `${n < 0 ? "−" : opts.sign && n > 0 ? "+" : ""}₹${s}`;
}

export function amount(v: unknown) {
  return inr.format(num(v));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function date(v?: string | null) {
  if (!v) return "";
  const [y, m, d] = v.slice(0, 10).split("-");
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

export function dateTime(v?: string | null) {
  if (!v) return "";
  const t = new Date(v);
  return `${t.getDate()} ${MONTHS[t.getMonth()]}, ${t.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
}

export function today() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function periodLabel(key: string) {
  const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m) return `${FULL[parseInt(m[2], 10) - 1]} ${m[1]}`;
  const q = /^(\d{4})-Q(\d)$/.exec(key);
  if (q) {
    const start = 4 + (parseInt(q[2], 10) - 1) * 3;
    const y = parseInt(q[1], 10) + (start > 12 ? 1 : 0);
    const sm = ((start - 1) % 12) + 1;
    return `${MONTHS[sm - 1]} to ${MONTHS[sm + 1]} ${y}`;
  }
  return key;
}

export function daysUntil(iso: string) {
  const t = new Date(today() + "T00:00:00");
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export const DOC_LABEL: Record<string, string> = { invoice: "Invoice", credit_note: "Credit note", debit_note: "Debit note" };
export const SECTION_LABEL: Record<string, string> = {
  b2b: "B2B", b2cl: "B2C large", b2cs: "B2C", exp: "Export", cdnr: "Note (B2B)", cdnur: "Note (B2C large)",
};
export const KIND_LABEL: Record<string, string> = { taxable: "Taxable", exempt: "Exempt", nil: "Nil rated", non_gst: "Non-GST", zero_rated: "Zero rated" };

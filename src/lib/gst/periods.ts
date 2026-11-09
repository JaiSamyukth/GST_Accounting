// Period keys: monthly "YYYY-MM"; quarterly "YYYY-Qn" where YYYY is the FY start year
// (FY starts in April): 2026-Q1 = Apr–Jun 2026, 2026-Q4 = Jan–Mar 2027.

export type Frequency = "monthly" | "quarterly";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(d: string): { y: number; m: number; day: number } {
  if (!ISO_DATE_RE.test(d)) throw new Error(`invalid date: ${d}`);
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) {
    throw new Error(`invalid date: ${d}`);
  }
  return { y, m, day };
}

export function isIsoDate(d: string): boolean {
  try {
    parseIsoDate(d);
    return true;
  } catch {
    return false;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** FY start year for a date: 2027-02-10 -> 2026. */
export function fyStartYear(date: string): number {
  const { y, m } = parseIsoDate(date);
  return m >= 4 ? y : y - 1;
}

/** "2026-27" */
export function fyLabel(startYear: number): string {
  return `${startYear}-${pad((startYear + 1) % 100)}`;
}

export function fyRange(startYear: number): { from: string; to: string } {
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

export function periodOf(date: string, freq: Frequency): string {
  const { y, m } = parseIsoDate(date);
  if (freq === "monthly") return `${y}-${pad(m)}`;
  const fy = m >= 4 ? y : y - 1;
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  return `${fy}-Q${q}`;
}

export const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const QUARTER_KEY_RE = /^(\d{4})-Q([1-4])$/;

export function isPeriodKey(key: string): boolean {
  return MONTH_KEY_RE.test(key) || QUARTER_KEY_RE.test(key);
}

export function periodFrequency(key: string): Frequency {
  if (MONTH_KEY_RE.test(key)) return "monthly";
  if (QUARTER_KEY_RE.test(key)) return "quarterly";
  throw new Error(`invalid period: ${key}`);
}

export interface PeriodRange {
  key: string;
  from: string;
  to: string;
  label: string;
  fy: string;
  /** Portal return period MMYYYY (last month of the period). */
  fp: string;
}

export function periodRange(key: string): PeriodRange {
  const mm = MONTH_KEY_RE.exec(key);
  if (mm) {
    const y = Number(mm[1]);
    const m = Number(mm[2]);
    return {
      key,
      from: `${y}-${pad(m)}-01`,
      to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`,
      label: `${MONTHS[m - 1]} ${y}`,
      fy: fyLabel(m >= 4 ? y : y - 1),
      fp: `${pad(m)}${y}`,
    };
  }
  const qm = QUARTER_KEY_RE.exec(key);
  if (qm) {
    const fy = Number(qm[1]);
    const q = Number(qm[2]);
    const startM = q === 4 ? 1 : 4 + (q - 1) * 3;
    const y = q === 4 ? fy + 1 : fy;
    const endM = startM + 2;
    return {
      key,
      from: `${y}-${pad(startM)}-01`,
      to: `${y}-${pad(endM)}-${pad(lastDay(y, endM))}`,
      label: `Q${q} ${fyLabel(fy)} (${MONTHS[startM - 1]}–${MONTHS[endM - 1]} ${y})`,
      fy: fyLabel(fy),
      fp: `${pad(endM)}${y}`,
    };
  }
  throw new Error(`invalid period: ${key}`);
}

export function periodsForFy(startYear: number, freq: Frequency): string[] {
  if (freq === "quarterly") return [1, 2, 3, 4].map((q) => `${startYear}-Q${q}`);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? startYear : startYear + 1;
    out.push(`${y}-${pad(m)}`);
  }
  return out;
}

export function previousPeriod(key: string): string {
  const mm = MONTH_KEY_RE.exec(key);
  if (mm) {
    const y = Number(mm[1]);
    const m = Number(mm[2]);
    return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  }
  const qm = QUARTER_KEY_RE.exec(key);
  if (qm) {
    const fy = Number(qm[1]);
    const q = Number(qm[2]);
    return q === 1 ? `${fy - 1}-Q4` : `${fy}-Q${q - 1}`;
  }
  throw new Error(`invalid period: ${key}`);
}

/** Due dates: GSTR-1 on the 11th (13th quarterly), GSTR-3B on the 20th (22nd quarterly) of the next month. */
export function dueDates(key: string): { gstr1: string; gstr3b: string } {
  const r = periodRange(key);
  const { y, m } = parseIsoDate(r.to);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const quarterly = periodFrequency(key) === "quarterly";
  return {
    gstr1: `${ny}-${pad(nm)}-${quarterly ? "13" : "11"}`,
    gstr3b: `${ny}-${pad(nm)}-${quarterly ? "22" : "20"}`,
  };
}

/** "2026-11-07" -> "07-11-2026" (portal format). */
export function portalDate(date: string): string {
  const { y, m, day } = parseIsoDate(date);
  return `${pad(day)}-${pad(m)}-${y}`;
}

export function todayIso(now: Date = new Date()): string {
  // India Standard Time, UTC+5:30, no DST.
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

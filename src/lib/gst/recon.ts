// Match purchase bills in the books against GSTR-2B rows. Pure.

export type ReconStatus = "matched" | "mismatch" | "probable" | "missing_in_2b" | "missing_in_books";

export interface ReconDoc {
  id: number;
  supplierGstin: string;
  supplierName: string;
  docType: string;
  number: string;
  date: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface ReconRow {
  status: ReconStatus;
  book: ReconDoc | null;
  twoB: (ReconDoc & { itcAvailable: boolean }) | null;
  /** books minus 2B, per head */
  diff: { taxableValue: number; igst: number; cgst: number; sgst: number; cess: number } | null;
  note: string;
}

/** Tolerance per head, in paise (₹1 by default) for rounding differences. */
export const TOLERANCE = 100;

/** "INV/0012" and "inv-12" both become "INV12". */
export function normaliseNumber(n: string): string {
  return n.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|[A-Z])0+(?=\d)/g, "$1");
}

const HEADS = ["taxableValue", "igst", "cgst", "sgst", "cess"] as const;

function diffOf(a: ReconDoc, b: ReconDoc) {
  return { taxableValue: a.taxableValue - b.taxableValue, igst: a.igst - b.igst, cgst: a.cgst - b.cgst, sgst: a.sgst - b.sgst, cess: a.cess - b.cess };
}

function close(a: ReconDoc, b: ReconDoc, tol: number): boolean {
  return HEADS.every((h) => Math.abs(a[h] - b[h]) <= tol);
}

/** Edit distance, for spotting typos in invoice numbers. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Numbers that look like the same invoice typed differently: same digits, or at most two typos. */
export function similarNumbers(a: string, b: string): boolean {
  const na = normaliseNumber(a);
  const nb = normaliseNumber(b);
  const digits = (s: string) => s.replace(/\D/g, "");
  return (digits(na) !== "" && digits(na) === digits(nb)) || editDistance(na, nb) <= 2;
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

export function reconcile(books: ReconDoc[], twoB: Array<ReconDoc & { itcAvailable: boolean }>, tol = TOLERANCE): ReconRow[] {
  const key = (d: ReconDoc) => `${d.supplierGstin.toUpperCase()}|${d.docType}|${normaliseNumber(d.number)}`;
  const pool = new Map<string, Array<ReconDoc & { itcAvailable: boolean }>>();
  for (const r of twoB) pool.set(key(r), [...(pool.get(key(r)) ?? []), r]);
  const used = new Set<ReconDoc>();
  const out: ReconRow[] = [];
  const pending: ReconDoc[] = [];

  for (const b of books) {
    const cand = (pool.get(key(b)) ?? []).find((r) => !used.has(r));
    if (!cand) {
      pending.push(b);
      continue;
    }
    used.add(cand);
    const ok = close(b, cand, tol);
    const notes: string[] = [];
    if (!ok) notes.push("Amounts differ from GSTR-2B");
    if (!cand.itcAvailable) notes.push("Supplier marked ITC not available");
    out.push({ status: ok ? "matched" : "mismatch", book: b, twoB: cand, diff: diffOf(b, cand), note: notes.join("; ") });
  }

  // Probable: same supplier and type, amounts agree, dates within 10 days, and the numbers look like
  // the same invoice typed differently. Equal amounts alone are not enough to claim ITC on.
  for (const b of pending) {
    const cand = twoB.find((r) => !used.has(r) && r.supplierGstin.toUpperCase() === b.supplierGstin.toUpperCase()
      && r.docType === b.docType && close(b, r, tol) && daysApart(r.date, b.date) <= 10 && similarNumbers(r.number, b.number));
    if (cand) {
      used.add(cand);
      out.push({ status: "probable", book: b, twoB: cand, diff: diffOf(b, cand), note: `Number differs: books ${b.number}, 2B ${cand.number}` });
    } else {
      out.push({ status: "missing_in_2b", book: b, twoB: null, diff: null, note: "Not in GSTR-2B yet: ITC deferred" });
    }
  }
  for (const r of twoB) {
    if (!used.has(r)) out.push({ status: "missing_in_books", book: null, twoB: r, diff: null, note: "In GSTR-2B but not entered in purchases" });
  }
  const order: Record<ReconStatus, number> = { mismatch: 0, missing_in_2b: 1, probable: 2, missing_in_books: 3, matched: 4 };
  return out.sort((a, b) => order[a.status] - order[b.status]);
}

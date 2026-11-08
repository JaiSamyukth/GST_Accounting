// Money is integer paise. Rates are integer basis points (5% = 500 bp).

/** Round numerator/denominator half away from zero (Decimal ROUND_HALF_UP). */
export function roundHalfUp(numerator: bigint | number, denominator: bigint | number = 1n): number {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d === 0n) throw new Error("division by zero");
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return Number(negative ? -q : q);
}

/** Parse a rupee amount ("1,234.5", "12", "-3.25") into paise. Throws on bad input. */
export function paise(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid amount");
    return paise(value.toFixed(6));
  }
  const s = value.replace(/,/g, "").trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`invalid amount: ${value}`);
  const sign = m[1] ? -1n : 1n;
  const whole = BigInt(m[2] || "0");
  const frac = (m[3] ?? "").padEnd(6, "0").slice(0, 6); // micro-rupees
  const micro = whole * 1_000_000n + BigInt(frac);
  return roundHalfUp(sign * micro, 10_000n);
}

/** Parse a fixed-point decimal string into an integer scaled by 10^scale (half-up). */
export function parseScaled(value: string | number, scale: number): number {
  const s = (typeof value === "number" ? value.toFixed(scale + 2) : value).replace(/,/g, "").trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`invalid number: ${value}`);
  const sign = m[1] ? -1n : 1n;
  const extra = 3;
  const frac = (m[3] ?? "").padEnd(scale + extra, "0").slice(0, scale + extra);
  const big = BigInt(m[2] || "0") * 10n ** BigInt(scale + extra) + BigInt(frac);
  return roundHalfUp(sign * big, 10n ** BigInt(extra));
}

/** Format an integer scaled by 10^scale back to a plain decimal string. */
export function formatScaled(value: number, scale: number): string {
  const neg = value < 0;
  const abs = BigInt(Math.abs(value));
  const div = 10n ** BigInt(scale);
  const whole = (abs / div).toString();
  const frac = scale > 0 ? "." + (abs % div).toString().padStart(scale, "0") : "";
  return (neg ? "-" : "") + whole + frac;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(",") + "," + last3;
}

/** 123456 -> "1,234.56"; 12345678900 -> "12,34,56,789.00". */
export function formatINR(p: number): string {
  const neg = p < 0;
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const ps = abs % 100;
  return (neg ? "-" : "") + groupIndian(String(rupees)) + "." + String(ps).padStart(2, "0");
}

/** Paise to a plain rupee number for portal JSON (two decimals). */
export function toRupees(p: number): number {
  return Math.round(p) / 100;
}

/** Paise to a plain "1234.56" string (no grouping) for inputs and CSV. */
export function rupeeString(p: number): string {
  return formatScaled(p, 2);
}

/** Basis points to percent number: 500 -> 5, 25 -> 0.25. */
export function bpToPercent(bp: number): number {
  return bp / 100;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function words99(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}

function words999(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? ONES[h] + " Hundred" : "", r ? words99(r) : ""].filter(Boolean).join(" ");
}

/** Indian-system amount in words: 123456 paise -> "Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only". */
export function amountInWords(p: number): string {
  const abs = Math.abs(p);
  let r = Math.floor(abs / 100);
  const ps = abs % 100;
  const parts: string[] = [];
  const crore = Math.floor(r / 10_000_000);
  r %= 10_000_000;
  const lakh = Math.floor(r / 100_000);
  r %= 100_000;
  const thousand = Math.floor(r / 1000);
  r %= 1000;
  if (crore) parts.push(words999(crore) + " Crore");
  if (lakh) parts.push(words99(lakh) + " Lakh");
  if (thousand) parts.push(words99(thousand) + " Thousand");
  if (r) parts.push(words999(r));
  const rupees = parts.length ? parts.join(" ") : "Zero";
  return `${p < 0 ? "Minus " : ""}Rupees ${rupees}${ps ? " and " + words99(ps) + " Paise" : ""} Only`;
}

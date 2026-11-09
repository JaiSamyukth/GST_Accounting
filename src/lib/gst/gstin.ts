export const STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "96": "Foreign Country", "97": "Other Territory",
};

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** GSTIN check character over the first 14 characters (mod-36 Luhn variant). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]);
    if (v < 0) throw new Error("invalid character");
    const factor = i % 2 === 0 ? 1 : 2;
    const prod = v * factor;
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function normaliseGstin(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}

export interface GstinCheck {
  valid: boolean;
  gstin: string;
  errors: string[];
  stateCode?: string;
  stateName?: string;
  pan?: string;
}

export function checkGstin(input: string): GstinCheck {
  const gstin = normaliseGstin(input);
  const errors: string[] = [];
  if (gstin.length !== 15) errors.push("GSTIN must be 15 characters");
  else if (!GSTIN_RE.test(gstin)) errors.push("GSTIN format is invalid");
  else {
    const state = gstin.slice(0, 2);
    if (!STATES[state] || state === "96" || state === "97") errors.push(`Unknown state code ${state}`);
    if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) errors.push("GSTIN checksum does not match");
  }
  if (errors.length) return { valid: false, gstin, errors };
  const stateCode = gstin.slice(0, 2);
  return { valid: true, gstin, errors, stateCode, stateName: STATES[stateCode], pan: gstin.slice(2, 12) };
}

export function isValidGstin(input: string): boolean {
  return checkGstin(input).valid;
}

export function isValidPan(input: string): boolean {
  return PAN_RE.test(normaliseGstin(input));
}

export function stateFromGstin(gstin: string): string | null {
  const g = normaliseGstin(gstin);
  return /^[0-9]{2}/.test(g) && STATES[g.slice(0, 2)] ? g.slice(0, 2) : null;
}

export function isStateCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(STATES, code);
}

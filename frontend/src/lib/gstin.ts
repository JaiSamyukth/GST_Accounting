const CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function gstinProblem(raw: string, states: string[]): string | null {
  const g = raw.trim().toUpperCase();
  if (!g) return null;
  if (g.length !== 15) return `GSTIN has 15 characters, this has ${g.length}`;
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g)) return "This does not look like a GSTIN";
  if (!states.includes(g.slice(0, 2))) return `${g.slice(0, 2)} is not a state code`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CH.indexOf(g[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  if (CH[(36 - (sum % 36)) % 36] !== g[14]) return "The last character does not match. Check for a typing mistake";
  return null;
}

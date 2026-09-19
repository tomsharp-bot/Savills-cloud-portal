export function baseInitials(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function uniqueInitials(name: string, existing: string[]): string {
  const base = baseInitials(name);
  if (!base) return "";
  const used = new Set((existing || []).map((x) => (x || "").toUpperCase()));
  if (!used.has(base)) return base;
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  for (let n = 2; n <= last.length; n++) {
    const cand = (parts[0][0] + last.slice(0, n)).toUpperCase();
    if (!used.has(cand)) return cand;
  }
  let i = 2;
  while (used.has(base + i)) i++;
  return base + i;
}

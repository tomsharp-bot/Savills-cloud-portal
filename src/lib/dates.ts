export function formatVisitDateDisplay(v: unknown): string {
  if (v == null || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN((v as Date).getTime())) {
    const d = v as Date;
    const day = String(d.getUTCDate()).padStart(2, "0");
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${day}/${m}/${d.getUTCFullYear()}`;
  }
  if (typeof v === "number") {
    // Excel serial date (days since 1899-12-30)
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(v * 86400000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, "0");
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      return `${day}/${m}/${d.getUTCFullYear()}`;
    }
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    const yy = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${dmy[1].padStart(2, "0")}/${dmy[2].padStart(2, "0")}/${yy}`;
  }
  return s;
}

export function visitDateSortKey(v: unknown): string {
  const disp = formatVisitDateDisplay(v);
  const m = disp.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}${m[2]}${m[1]}`;
  return String(v || "");
}

export function nowStamp(): string {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDocDate(iso: Date | string): string {
  try {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    if (isNaN(d.getTime())) return String(iso || "");
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso || "");
  }
}

/**
 * Sort for the Pending Issues list only.
 * Review and create still loads the shared newest-first query. Last 20 and
 * Main Log do not use this.
 *
 * Default is project A to Z, then highest rating, then longest wait.
 * Clicking a column leaves that default and sorts by that column alone.
 * Rating is highest to lowest. Received is longest wait to shortest.
 * Every other column is A to Z. Clicking the same column does not reverse it.
 */
export const PENDING_SORT_COLUMNS = [
  { key: "project", label: "Project", className: "" },
  { key: "address", label: "Address", className: "" },
  { key: "photos", label: "Photos", className: "photo-att-col" },
  { key: "uprn", label: "UPRN", className: "" },
  { key: "surveyor", label: "Surveyor", className: "" },
  { key: "category", label: "Category", className: "" },
  { key: "rating", label: "Rating", className: "" },
  { key: "received", label: "Received", className: "" },
] as const;

export type PendingColumnSort = (typeof PENDING_SORT_COLUMNS)[number]["key"];
export type PendingSort = "default" | PendingColumnSort;

export type PendingSortRow = {
  projectName: string;
  fullAddress: string;
  photoPaths?: unknown;
  uprn: string;
  surveyorName: string;
  category: string;
  rating: string;
  createdAt: Date | string;
};

const COLUMN_KEYS = new Set<string>(PENDING_SORT_COLUMNS.map((col) => col.key));

export function parsePendingSort(value: unknown): PendingSort {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw ?? "").trim();
  return COLUMN_KEYS.has(text) ? (text as PendingColumnSort) : "default";
}

function ratingText(rating: string): string {
  return String(rating || "")
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

/**
 * Higher is more serious. Emergency is above the other qualified highs.
 * Severe risk and significant risk share a band. Unqualified High, Severe,
 * and Category 1 share the next. Medium and Moderate share one, as do Low
 * and Slight. Unknown text ranks lowest.
 */
export function pendingRatingRank(rating: string): number {
  const r = ratingText(rating);
  if (!r) return 0;
  if (r.includes("emergency")) return 50;
  if (r.includes("severe risk") || r.includes("significant")) return 40;
  if (
    r === "high" ||
    r === "severe" ||
    r === "cat 1" ||
    r === "category 1" ||
    r.startsWith("high ") ||
    r.startsWith("severe ")
  ) {
    return 30;
  }
  if (r === "medium" || r === "moderate" || r === "cat 2" || r === "category 2") return 20;
  if (r === "low" || r === "slight") return 10;
  return 0;
}

function compareText(a: string, b: string): number {
  return String(a || "").localeCompare(String(b || ""), "en-GB", { numeric: true, sensitivity: "base" });
}

/** Older cases have waited longer. A missing time sorts as the shortest wait. */
function createdMs(row: PendingSortRow): number {
  const at = row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime();
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}

function compareWait(a: PendingSortRow, b: PendingSortRow): number {
  return createdMs(a) - createdMs(b);
}

/** Same count the Photos column shows. Kept here so this sort does not load the reporter. */
function photoCount(photoPaths: unknown): number {
  if (!Array.isArray(photoPaths)) return 0;
  return photoPaths.filter((item) => String(item || "").trim()).length;
}

function columnText(row: PendingSortRow, key: PendingColumnSort): string {
  switch (key) {
    case "project":
      return row.projectName;
    case "address":
      return row.fullAddress;
    case "uprn":
      return row.uprn;
    case "surveyor":
      return row.surveyorName;
    case "category":
      return row.category;
    default:
      return "";
  }
}

export function comparePendingIssues(a: PendingSortRow, b: PendingSortRow, sort: PendingSort): number {
  if (sort === "default") {
    return (
      compareText(a.projectName, b.projectName) ||
      pendingRatingRank(b.rating) - pendingRatingRank(a.rating) ||
      compareWait(a, b)
    );
  }
  if (sort === "rating") return pendingRatingRank(b.rating) - pendingRatingRank(a.rating);
  if (sort === "received") return compareWait(a, b);
  if (sort === "photos") return photoCount(a.photoPaths) - photoCount(b.photoPaths);
  return compareText(columnText(a, sort), columnText(b, sort));
}

/** Ties keep the incoming order. The pending query is newest first, so ties stay newest first. */
export function sortPendingIssues<T extends PendingSortRow>(rows: readonly T[], sort: PendingSort): T[] {
  return rows.slice().sort((a, b) => comparePendingIssues(a, b, sort));
}

function columnDir(key: PendingColumnSort): "asc" | "desc" {
  return key === "rating" || key === "received" ? "desc" : "asc";
}

function columnTitle(key: PendingColumnSort, label: string, active: boolean): string {
  if (!active) return `Sort by ${label}`;
  if (key === "rating") return "Sorted highest rating first";
  if (key === "received") return "Sorted longest wait first";
  if (key === "photos") return "Sorted fewest photos first";
  return `Sorted by ${label}, A to Z`;
}

export function pendingIssueSortColumns(sort: PendingSort, reporterBase = "/HHSRSreporter") {
  return PENDING_SORT_COLUMNS.map((col) => {
    const active = sort === col.key;
    const dir = columnDir(col.key);
    return {
      key: col.key,
      label: col.label,
      className: col.className,
      active,
      dir: active ? dir : "",
      title: columnTitle(col.key, col.label, active),
      href: `${reporterBase}?sort=${col.key}`,
    };
  });
}

export function pendingSortFoot(sort: PendingSort): string {
  switch (sort) {
    case "rating":
      return "Highest rating first";
    case "received":
      return "Longest wait first";
    case "photos":
      return "Fewest photos first";
    case "project":
      return "Sorted by project, A to Z";
    case "address":
      return "Sorted by address, A to Z";
    case "uprn":
      return "Sorted by UPRN, A to Z";
    case "surveyor":
      return "Sorted by surveyor, A to Z";
    case "category":
      return "Sorted by category, A to Z";
    default:
      return "Project, then highest rating, then longest wait";
  }
}

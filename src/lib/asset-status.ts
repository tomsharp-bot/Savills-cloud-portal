import type { AssetKind } from "@prisma/client";

export const ASSET_STATUSES = [
  "No Visit",
  "No Access",
  "Appt Made Not Kept",
  "Access Refused",
  "Void",
  "Full Survey",
  "Ext-Only",
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export function normalizeAccessType(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export type StatusResult = {
  assetStatus: AssetStatus;
  setSurveyFields: boolean;
};

/**
 * Locked recipe: default No Visit until a Visit Type appears.
 * Access Type then maps to Asset Status. Survey Date / Surveyed By
 * are only filled for Successful → Full Survey.
 */
export function statusFromVisit(accessType: unknown, visitType: unknown): StatusResult {
  if (!String(visitType ?? "").trim()) {
    return { assetStatus: "No Visit", setSurveyFields: false };
  }
  const at = normalizeAccessType(accessType);
  if (at === "no answer" || at === "none" || at === "") {
    return { assetStatus: "No Access", setSurveyFields: false };
  }
  if (at === "failed appointment" || at.startsWith("failed appt") || at.includes("failed appointment")) {
    return { assetStatus: "Appt Made Not Kept", setSurveyFields: false };
  }
  if (at === "refused access" || at === "not convenient") {
    return { assetStatus: "Access Refused", setSurveyFields: false };
  }
  if (at === "void") {
    return { assetStatus: "Void", setSurveyFields: false };
  }
  if (at === "successful") {
    return { assetStatus: "Full Survey", setSurveyFields: true };
  }
  return { assetStatus: "No Access", setSurveyFields: false };
}

export function cellVal(row: Record<string, unknown> | null | undefined, key: string): unknown {
  if (!row) return "";
  if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null) return row[key];
  const want = String(key).trim().toLowerCase();
  for (const k of Object.keys(row)) {
    if (String(k).trim().toLowerCase() === want) return row[k];
  }
  return "";
}

function headerKey(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, "");
}

/**
 * Type/archetype columns used to split stock onto Dwellings / Blocks / Garages.
 * Deliberately excludes address fields such as "Block" (building name) and Combined Address,
 * so “Block A, High Street” does not route a dwelling onto the Blocks tab.
 */
export const STOCK_KIND_HINT_HEADERS = [
  "Survey Design",
  "Archetype",
  "Property Type",
  "Asset Type",
  "Stock Type",
  "Type Of Property",
  "Visit Type",
  "Survey Type",
  "Asset Category",
  "Property Category",
  "Unit Type",
] as const;

/** Auto-route: Garage / Garages / Garage Sites → garage; Block / Blocks / MTVH Blocks → block; else dwelling. */
export function inferStockKind(raw: Record<string, unknown> | null | undefined): AssetKind {
  if (!raw) return "dwelling";
  const want = new Set(STOCK_KIND_HINT_HEADERS.map(headerKey));
  const values: string[] = [];
  for (const k of Object.keys(raw)) {
    if (!want.has(headerKey(k))) continue;
    const v = raw[k];
    if (v == null || v === "") continue;
    values.push(String(v));
  }
  const blob = values.join(" | ").toLowerCase();
  if (/garage/.test(blob)) return "garage";
  if (/\bblocks?\b|communal|maisonette block|low-rise block|walk-up/.test(blob)) return "block";
  return "dwelling";
}

export function surveyTypeForKind(kind: AssetKind): string {
  if (kind === "block") return "Blocks";
  if (kind === "garage") return "Garages";
  return "Condition Only";
}

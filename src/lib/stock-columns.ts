import type { AssetKind } from "@prisma/client";

export const STOCK_LABELS: Record<string, string> = {
  uprn: "UPRN",
  assetStatus: "Asset Status",
  surveyDate: "Survey Date",
  surveyedBy: "Surveyed By",
  visit1: "Visit 1 Date",
  visit2: "Visit 2 Date",
  visit3: "Visit 3 Date",
  number: "Number",
  block: "Block",
  street: "Street",
  area: "Area",
  city: "City",
  postcode: "Postcode",
  archetype: "Archetype",
  yearBuilt: "Year Built",
  patch: "Patch",
  surveyor: "Surveyor",
  surveyType: "Survey Type",
  agency: "Agency",
  siteComments: "Site Comments",
  external: "External",
  omitAsset: "Omit Asset",
  residentName: "Resident Name",
  residentNumber: "Resident Number",
  residentEmail: "Resident Email",
  letterDate1: "Letter Date 1",
  letterDate2: "Letter Date 2",
  x1: "X1",
  x2: "X2",
  x3: "X3",
};

const CORE_COLS = [
  "uprn",
  "assetStatus",
  "surveyDate",
  "surveyedBy",
] as const;

const ADDRESS_COLS = [
  "number",
  "block",
  "street",
  "area",
  "city",
  "postcode",
  "archetype",
  "yearBuilt",
  "patch",
  "surveyor",
  "surveyType",
  "agency",
  "siteComments",
  "external",
  "omitAsset",
] as const;

const VISIT_COLS = ["visit1", "visit2", "visit3"] as const;

/** Dwellings tab only — Admin-only resident / letter / X fields. */
export const DWELLING_ADMIN_COLS = [
  "residentName",
  "residentNumber",
  "residentEmail",
  "letterDate1",
  "letterDate2",
  "x1",
  "x2",
  "x3",
] as const;

/** Hidden from Surveyor and Client on every stock tab. */
export const ADMIN_ONLY_STOCK_COLS = new Set<string>(["omitAsset", ...DWELLING_ADMIN_COLS]);

/** Admin-editable text/date fields (Omit Asset stays a checkbox). */
export const ADMIN_EDIT_STOCK_COLS = new Set<string>(DWELLING_ADMIN_COLS);

export const STOCK_DATE_COLS = new Set(["surveyDate", "visit1", "visit2", "visit3", "letterDate1", "letterDate2"]);

export const STOCK_SELECT_COLS = new Set([
  "assetStatus",
  "surveyDate",
  "surveyedBy",
  "visit1",
  "visit2",
  "visit3",
  "archetype",
  "yearBuilt",
  "patch",
  "surveyor",
  "surveyType",
  "agency",
  "external",
  "letterDate1",
  "letterDate2",
]);

export type StockColumnOpts = {
  /** Default true: include Omit Asset and dwelling resident/letter/X columns. */
  includeAdminOnly?: boolean;
};

export function stockColumns(kind: AssetKind, opts: StockColumnOpts = {}): string[] {
  const includeAdminOnly = opts.includeAdminOnly !== false;
  const cols =
    kind === "dwelling"
      ? [...CORE_COLS, ...VISIT_COLS, ...ADDRESS_COLS, ...DWELLING_ADMIN_COLS]
      : [...CORE_COLS, ...ADDRESS_COLS];
  if (includeAdminOnly) return cols;
  return cols.filter((c) => !ADMIN_ONLY_STOCK_COLS.has(c));
}

export function stockTabTitle(kind: AssetKind): string {
  if (kind === "dwelling") return "Dwellings";
  if (kind === "block") return "Blocks";
  return "Garages";
}

export function parseExportScope(raw: unknown): "all" | AssetKind {
  const v = String(raw || "all");
  if (v === "dwelling" || v === "dwellings") return "dwelling";
  if (v === "block" || v === "blocks") return "block";
  if (v === "garage" || v === "garages") return "garage";
  return "all";
}

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

export const STOCK_DATE_COLS = new Set(["surveyDate", "visit1", "visit2", "visit3"]);

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
]);

export function stockColumns(kind: AssetKind): string[] {
  if (kind === "dwelling") {
    return [...CORE_COLS, ...VISIT_COLS, ...ADDRESS_COLS];
  }
  return [...CORE_COLS, ...ADDRESS_COLS];
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

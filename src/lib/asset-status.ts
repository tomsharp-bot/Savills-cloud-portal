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
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Dropdown options: canonical UI labels first, then any extra values already on rows. */
export function assetStatusFilterOptions(existing: Iterable<string> = []): string[] {
  const seen = new Set<string>(ASSET_STATUSES);
  const extra: string[] = [];
  for (const raw of existing) {
    const v = String(raw ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    extra.push(v);
  }
  extra.sort((a, b) => a.localeCompare(b));
  return [...ASSET_STATUSES, ...extra];
}

function isSuccessfulAccess(at: string): boolean {
  return (
    at === "successful" ||
    at === "success" ||
    at.startsWith("successful ") ||
    at === "completed" ||
    at === "complete" ||
    at === "full survey" ||
    at === "full surveys"
  );
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
  if (at === "no answer" || at === "none" || at === "" || at === "no access") {
    return { assetStatus: "No Access", setSurveyFields: false };
  }
  if (
    at === "failed appointment" ||
    at.startsWith("failed appt") ||
    at.includes("failed appointment") ||
    at === "appt made not kept" ||
    at === "appointment made not kept" ||
    at === "appointment not kept" ||
    at === "appt not kept"
  ) {
    return { assetStatus: "Appt Made Not Kept", setSurveyFields: false };
  }
  if (at === "refused access" || at === "not convenient" || at === "access refused") {
    return { assetStatus: "Access Refused", setSurveyFields: false };
  }
  if (at === "void") {
    return { assetStatus: "Void", setSurveyFields: false };
  }
  if (isSuccessfulAccess(at)) {
    return { assetStatus: "Full Survey", setSurveyFields: true };
  }
  return { assetStatus: "No Access", setSurveyFields: false };
}

export type VisitStatusInput = {
  visitType?: string | null;
  accessType?: string | null;
};

/** Latest typed visit log row drives Asset Status on the stock row. */
export function statusFromVisitLogs(visits: VisitStatusInput[]): StatusResult {
  const withType = visits.filter((v) => String(v.visitType ?? "").trim());
  const lastTyped = withType[withType.length - 1];
  if (!lastTyped) return { assetStatus: "No Visit", setSurveyFields: false };
  return statusFromVisit(lastTyped.accessType, lastTyped.visitType);
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
 * Columns that describe the asset itself (house, flat, block, garage).
 * Address fields such as "Block" (the building name) are not in this list,
 * so “Block A, High Street” does not route a dwelling onto the Blocks tab.
 */
export const STOCK_TYPE_HEADERS = [
  "Archetype",
  "Property Archetype",
  "Dwelling Type",
  "Dwelling Archetype",
  "Property Type",
  "Asset Type",
  "Stock Type",
  "Type Of Property",
  "Building Type",
  "Accommodation Type",
  "Asset Category",
  "Property Category",
  "Unit Type",
] as const;

/**
 * Programme labels. Used only when no asset-type column says what the row is.
 * A file-wide Survey Design of "Blocks" must not drag houses and flats onto Blocks.
 */
export const STOCK_PROGRAMME_HEADERS = ["Survey Design", "Survey Type", "Visit Type"] as const;

/** @deprecated Use STOCK_TYPE_HEADERS and STOCK_PROGRAMME_HEADERS. Kept for callers that listed every hint. */
export const STOCK_KIND_HINT_HEADERS = [...STOCK_TYPE_HEADERS, ...STOCK_PROGRAMME_HEADERS] as const;

const TYPE_HEADER_KEYS = new Set(STOCK_TYPE_HEADERS.map(headerKey));
const PROGRAMME_HEADER_KEYS = new Set(STOCK_PROGRAMME_HEADERS.map(headerKey));

function isTypeHeaderKey(key: string): boolean {
  if (PROGRAMME_HEADER_KEYS.has(key)) return false;
  if (TYPE_HEADER_KEYS.has(key)) return true;
  if (key === "block" || key === "blocks") return false;
  return /(archetype|propertytype|assettype|unittype|dwellingtype|buildingtype|accommodationtype|stocktype)$/.test(key);
}

type KindHit = AssetKind | "commercial";

function normaliseKindText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ");
}

/** House, flat, bungalow, maisonette, bedsit, room, studio — including bung. / mais. */
function isResidentialDwellingLabel(value: string): boolean {
  return /\b(houses?|bungalows?|bung\.?|flats?|maisonettes?|mais\.?|bedsits?|bed sits?|bed-sits?|rooms?|studios?|dwellings?|terraced|terrace|semi-detached|semi detached|detached|hmo)\b/.test(
    value
  );
}

function isBlockLabel(value: string): boolean {
  if (/^blocks?\b/.test(value) || /\bblocks?\s+of\b/.test(value)) return true;
  if (/\b(low-rise|low rise|high-rise|high rise|walk-up|walk up|communal)\s+blocks?\b/.test(value)) return true;
  if (/^(walk-ups?|walk ups?|communal blocks?|mtvh blocks?)$/.test(value)) return true;
  return /\bblocks?\b/.test(value) || /\bwalk-ups?\b/.test(value) || /\bwalk ups?\b/.test(value);
}

function isGarageLabel(value: string): boolean {
  return /\bgarages?\b/.test(value) || /garage\s*sites?/.test(value);
}

function isCommercialLabel(value: string): boolean {
  return /\bcommercial\b/.test(value);
}

/** One cell: garage, block, a residential dwelling, commercial, or nothing we recognise. */
function classifyKindText(raw: string): KindHit | null {
  const value = normaliseKindText(raw);
  if (!value) return null;
  if (isGarageLabel(value)) return "garage";
  if (isCommercialLabel(value)) return "commercial";
  // "Block" / "Block of flats" is the block. "Flat" / "House in a block" is a dwelling.
  if (/^blocks?\b/.test(value) || /\bblocks?\s+of\b/.test(value)) return "block";
  if (isResidentialDwellingLabel(value)) return "dwelling";
  if (isBlockLabel(value)) return "block";
  return null;
}

function firstHit(values: string[]): KindHit | null {
  const hits = values.map(classifyKindText).filter((hit): hit is KindHit => hit != null);
  if (hits.includes("garage")) return "garage";
  if (hits.includes("dwelling")) return "dwelling";
  if (hits.includes("block")) return "block";
  if (hits.includes("commercial")) return "commercial";
  return null;
}

/**
 * Type-column text that is clearly a home (house, flat, bungalow, maisonette, bedsit, room, studio)
 * and not itself a block or garage label.
 * Survey Design / Survey Type and the address Block column are ignored, so this stays true
 * even when Auto routing is wrongly sending those rows to Blocks.
 */
export function rowHasNonBlockResidentialType(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw) return false;
  for (const key of Object.keys(raw)) {
    if (!isTypeHeaderKey(headerKey(key))) continue;
    const cell = raw[key];
    if (cell == null || cell === "") continue;
    const value = normaliseKindText(String(cell));
    if (!value || isGarageLabel(value)) continue;
    if (/^blocks?\b/.test(value) || /\bblocks?\s+of\b/.test(value)) continue;
    if (isResidentialDwellingLabel(value)) return true;
  }
  return false;
}

/**
 * Auto-route.
 * Garage / garage site → garage.
 * Block / Blocks → block.
 * Commercial unit → not a block (there is no commercial stock tab, so it stays a dwelling).
 * House, bungalow, flat, maisonette, bedsit, room, studio, and anything else → dwelling.
 * Asset-type columns win over Survey Design / Survey Type, which are often the same on every row.
 */
export function inferStockKind(raw: Record<string, unknown> | null | undefined): AssetKind {
  if (!raw) return "dwelling";
  const typeValues: string[] = [];
  const programmeValues: string[] = [];
  for (const key of Object.keys(raw)) {
    const norm = headerKey(key);
    const cell = raw[key];
    if (cell == null || cell === "") continue;
    const text = String(cell);
    if (isTypeHeaderKey(norm)) typeValues.push(text);
    else if (PROGRAMME_HEADER_KEYS.has(norm)) programmeValues.push(text);
  }
  const fromType = firstHit(typeValues);
  if (fromType === "garage" || fromType === "block") return fromType;
  // A type column that names a home, a commercial unit, or anything we do not
  // recognise wins over Survey Design / Survey Type. "Cottage" must not become
  // a block just because every row says "Blocks".
  if (fromType === "dwelling" || fromType === "commercial") return "dwelling";
  if (typeValues.some((value) => normaliseKindText(value))) return "dwelling";
  const fromProgramme = firstHit(programmeValues);
  if (fromProgramme === "garage" || fromProgramme === "block") return fromProgramme;
  return "dwelling";
}

/**
 * Spreadsheet labels that mean one of the seven grid statuses.
 * Keys are already passed through assetStatusKey (lower case, punctuation folded).
 * "Full Survey Completed", "Completed", "Survey Complete", and "Ext Only"
 * are the forms a stocklist actually arrives with.
 */
export const ASSET_STATUS_SYNONYMS: Readonly<Record<string, AssetStatus>> = {
  "no visit": "No Visit",
  "no visits": "No Visit",
  "not visited": "No Visit",

  "no access": "No Access",
  "no answer": "No Access",
  none: "No Access",

  "appt made not kept": "Appt Made Not Kept",
  "appointment made not kept": "Appt Made Not Kept",
  "appointment not kept": "Appt Made Not Kept",
  "appt not kept": "Appt Made Not Kept",
  "failed appointment": "Appt Made Not Kept",
  "failed appt": "Appt Made Not Kept",

  "access refused": "Access Refused",
  "refused access": "Access Refused",
  "not convenient": "Access Refused",
  refused: "Access Refused",

  void: "Void",
  "void property": "Void",

  "full survey": "Full Survey",
  "full surveys": "Full Survey",
  "full survey completed": "Full Survey",
  "full survey complete": "Full Survey",
  "full surveys completed": "Full Survey",
  "full surveys complete": "Full Survey",
  "survey complete": "Full Survey",
  "survey completed": "Full Survey",
  completed: "Full Survey",
  complete: "Full Survey",
  successful: "Full Survey",
  success: "Full Survey",

  "ext only": "Ext-Only",
  "external only": "Ext-Only",
  external: "Ext-Only",
  "ext survey": "Ext-Only",
  "external survey": "Ext-Only",
};

/**
 * Case, space, hyphen, and period folded key.
 * "Ext. Only", "ext-only", and "  EXT   ONLY  " all become "ext only".
 * The stocklist SQL and the deploy migration use the same folds.
 */
export function assetStatusKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One of the seven labels, or undefined when the text is blank or not a known synonym. */
export function canonicalAssetStatus(raw: unknown): AssetStatus | undefined {
  const key = assetStatusKey(raw);
  if (!key) return undefined;
  const exact = ASSET_STATUS_SYNONYMS[key];
  if (exact) return exact;
  if (key.startsWith("failed appt") || key.includes("failed appointment")) return "Appt Made Not Kept";
  if (key.startsWith("successful")) return "Full Survey";
  return undefined;
}

/** Completed stock statuses, including the labels a stocklist stores before they are folded. */
export function isFullSurveyStatus(status: unknown): boolean {
  return canonicalAssetStatus(status) === "Full Survey";
}

export function isExtOnlyStatus(status: unknown): boolean {
  return canonicalAssetStatus(status) === "Ext-Only";
}

/**
 * Fold a stocklist Asset Status onto one of the seven grid labels.
 * Matching ignores case, extra spaces, hyphens, and periods.
 * Blank is left unset. Any other non-blank text is kept as typed, trimmed.
 */
export function foldAssetStatus(raw: unknown): string | undefined {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return undefined;
  return canonicalAssetStatus(text) ?? text;
}

export function isCompletedAssetStatus(status: unknown): boolean {
  return isFullSurveyStatus(status) || isExtOnlyStatus(status);
}

export function surveyTypeForKind(kind: AssetKind): string {
  if (kind === "block") return "Blocks";
  if (kind === "garage") return "Garages";
  return "Condition Only";
}

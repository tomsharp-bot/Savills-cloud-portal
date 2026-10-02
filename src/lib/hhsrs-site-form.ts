import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  HHSRS_CATEGORIES,
  HHSRS_LEGACY_CATEGORIES,
  HHSRS_ONWARD_VICO_RATINGS,
  HHSRS_SITE_FORM_NEW_RATINGS,
} from "./hhsrs-categories.js";
import { resolveHhsrsProject } from "./hhsrs-reporter-projects.js";
import {
  defaultSitePhotoStorage,
  prepareSitePhoto,
  putSitePhotoWithRetry,
  siteFormPhotoKey,
  storedNameForPrepared,
  type SitePhotoPutOptions,
  type SitePhotoStorage,
} from "./hhsrs-site-photos.js";

export const HHSRS_SITE_FORM_PATH = "/HHSRS-site-form";
export const HHSRS_MIN_PHOTOS = 1;
export const HHSRS_MAX_PHOTOS = 4;
/** Per-photo cap. 40MB covers typical iPhone HEIC / high-res JPEG. */
export const HHSRS_MAX_FILE_MB = 40;
export const HHSRS_MAX_FILE_BYTES = HHSRS_MAX_FILE_MB * 1024 * 1024;
/** Extra room for text fields so 4 large photos are not rejected as "fields too big". */
export const HHSRS_FORM_FIELD_BYTES = 2 * 1024 * 1024;
/** Whole multipart request: 4 photos + form fields. Used for multer / docs. */
export const HHSRS_MAX_REQUEST_BYTES =
  HHSRS_MAX_PHOTOS * HHSRS_MAX_FILE_BYTES + HHSRS_FORM_FIELD_BYTES;
export const HHSRS_ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif"] as const;
export const HHSRS_ALLOWED_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const hhsrsMulterLimits = {
  fileSize: HHSRS_MAX_FILE_BYTES,
  files: HHSRS_MAX_PHOTOS,
  fields: 40,
  fieldSize: HHSRS_FORM_FIELD_BYTES,
  parts: HHSRS_MAX_PHOTOS + 40,
} as const;

export function hhsrsPhotoSizeError(): string {
  return `Each photo must be ${HHSRS_MAX_FILE_MB}MB or smaller (each photo up to ${HHSRS_MAX_FILE_MB}MB).`;
}

export function hhsrsPhotoHint(): string {
  return `At least ${HHSRS_MIN_PHOTOS} photo required, up to ${HHSRS_MAX_PHOTOS}. Phone photos are gently resized on your device (about 3000px on the long side) so uploads stay workable but detail stays clear for office checks. Each photo up to 25 MB after that.`;
}

/** Why a required client call reference was left blank. */
export const CALL_REF_BLANK_REASONS = ["No answer", "Engaged/busy", "Other"] as const;
export type CallRefBlankReason = (typeof CALL_REF_BLANK_REASONS)[number];

export function isCallRefBlankReason(value: string): value is CallRefBlankReason {
  return (CALL_REF_BLANK_REASONS as readonly string[]).includes(value);
}

export function normalizeUprn(value: string): string {
  return String(value || "").replace(/\s+/g, "").trim();
}

/** Stored on the submission when the surveyor typed the address. Blank means a stock lookup. */
export const ADDRESS_SOURCE_MANUAL = "manual";

/** Basic UK postcode (A9 9AA through AA9A 9AA). Stored uppercase with one space. */
export function normalizeUkPostcode(value: string): string {
  const compact = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (compact.length <= 3) return compact;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`.trim();
}

export function isBasicUkPostcode(value: string): boolean {
  const compact = normalizeUkPostcode(value).replace(/\s+/g, "");
  if (!/^\d[A-Z]{2}$/.test(compact.slice(-3))) return false;
  const outward = compact.slice(0, -3);
  return /^(?:[A-Z]{2}\d[A-Z]|[A-Z]\d[A-Z]|[A-Z]{2}\d{1,2}|[A-Z]\d{1,2})$/.test(outward);
}

export function composeManualFullAddress(line1: string, line2: string, town: string): string {
  return [line1, line2, town]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

/** Copy a typed address into the same fields a stock lookup fills. */
export function applyManualAddress(values: HhsrsFormValues): HhsrsFormValues {
  const addressLine1 = String(values.addressLine1 || "").trim();
  const addressLine2 = String(values.addressLine2 || "").trim();
  const town = String(values.town || "").trim();
  return {
    ...values,
    addressSource: ADDRESS_SOURCE_MANUAL,
    addressLine1,
    addressLine2,
    town,
    fullAddress: composeManualFullAddress(addressLine1, addressLine2, town),
    postcode: normalizeUkPostcode(values.postcode),
    addressConfirmed: true,
  };
}

export type StockLookupRow = {
  uprn: string;
  kind: string;
  number: string;
  block: string;
  street: string;
  area: string;
  city: string;
  postcode: string;
};

export type StockAddressMatch = {
  uprn: string;
  line: string;
  postcode: string;
  /** Kept off the form. Stock label for a later Main Log link; not stored on the submission. */
  asset: string;
  type: "Dwelling" | "Block" | "Garage";
};

export function stockKindLabel(kind: string): StockAddressMatch["type"] {
  if (kind === "block") return "Block";
  if (kind === "garage") return "Garage";
  return "Dwelling";
}

/** One line from stock columns. Skips a repeated area/city (Bude, Bude). */
export function formatStockAddressLine(asset: Pick<StockLookupRow, "number" | "block" | "street" | "area" | "city">): string {
  const city = String(asset.city || "").trim();
  const area = String(asset.area || "").trim();
  const parts = [asset.number, asset.block, asset.street, area && area.toLowerCase() !== city.toLowerCase() ? area : "", city]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const deduped: string[] = [];
  for (const part of parts) {
    if (deduped.length && deduped[deduped.length - 1].toLowerCase() === part.toLowerCase()) continue;
    deduped.push(part);
  }
  return deduped.join(", ");
}

export function stockAssetLabel(asset: Pick<StockLookupRow, "number" | "block" | "kind">): string {
  return String(asset.number || "").trim() || String(asset.block || "").trim() || stockKindLabel(asset.kind);
}

/** Prefer a dwelling when the same UPRN is stored as more than one kind. */
export function stockMatchFromRows(rows: StockLookupRow[]): StockAddressMatch | null {
  if (!rows.length) return null;
  const rank = (kind: string): number => (kind === "dwelling" ? 0 : kind === "block" ? 1 : kind === "garage" ? 2 : 3);
  const best = [...rows].sort((a, b) => rank(a.kind) - rank(b.kind))[0];
  const uprn = normalizeUprn(best.uprn) || String(best.uprn || "").trim();
  return {
    uprn,
    line: formatStockAddressLine(best) || (uprn ? `UPRN ${uprn}` : ""),
    postcode: String(best.postcode || "").trim(),
    asset: stockAssetLabel(best),
    type: stockKindLabel(best.kind),
  };
}

export function composeCallNotes(reason: string, notes: string): string {
  const extra = String(notes || "").trim();
  if (reason === "Other") return extra ? `Other — ${extra}` : "";
  if (!reason) return extra;
  return extra ? `${reason} — ${extra}` : reason;
}

/** Split a stored call note back into the form's reason and extra detail. */
export function splitCallNotes(callNotes: string): { reason: string; note: string } {
  const text = String(callNotes || "").trim();
  if (!text) return { reason: "", note: "" };
  for (const reason of CALL_REF_BLANK_REASONS) {
    if (text === reason) return { reason, note: "" };
    const prefix = `${reason} — `;
    if (text.startsWith(prefix)) return { reason, note: text.slice(prefix.length) };
  }
  return { reason: "", note: text };
}

export function hhsrsPhotoCountError(total: number): string | undefined {
  if (total < HHSRS_MIN_PHOTOS) return `Add at least ${HHSRS_MIN_PHOTOS} photo.`;
  if (total > HHSRS_MAX_PHOTOS) return `Add ${HHSRS_MIN_PHOTOS} to ${HHSRS_MAX_PHOTOS} photos.`;
  return undefined;
}

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type HhsrsPhoto = {
  storedName: string;
  originalName: string;
  mime: string;
  size: number;
};

export type HhsrsFormValues = {
  projectId: string;
  surveyDate: string;
  uprn: string;
  fullAddress: string;
  postcode: string;
  /** Surveyor ticked the stock address after lookup (and again after any edit). */
  addressConfirmed: boolean;
  /** "manual" when this project had no stock and the surveyor typed the address. */
  addressSource: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  surveyorName: string;
  category: string;
  rating: string;
  comment: string;
  suspectedCause: string;
  clientCallReference: string;
  otherDetails: string;
  /**
   * No longer collected on the site form. Always false from this form.
   * Reporter can still set it on the office case.
   */
  cat1Confirmed: boolean;
  /** Draft-only. True when the surveyor could not obtain a required call reference. */
  callUnreached: boolean;
  /** Draft-only. No answer / Engaged/busy / Other. */
  callRefBlankReason: string;
  /** Draft-only. Extra detail. Required when the blank reason is Other. */
  callUnreachedNote: string;
  /** Required on Vico. Empty for every other project. */
  vulnerabilities: string;
  /** MTVH window restrictors (Falling Between Levels). Empty otherwise. */
  restrictorMissingCount: string;
  restrictorLocations: string;
  restrictorMaterial: string;
};

/** Which Extra details blocks apply to a live project name. */
export type SiteFormProjectFlags = {
  calls: boolean;
  onward: boolean;
  saxon: boolean;
  online: boolean;
  /** Vico only. Resident vulnerabilities are required on the site form. */
  vulnerabilities: boolean;
  /** Names that resolve to MTVH. */
  mtvh: boolean;
  ratingScheme: "NEW" | "OLD";
};

export function siteFormProjectFlags(projectName: string): SiteFormProjectFlags {
  const roster = resolveHhsrsProject(projectName).roster;
  return {
    calls: Boolean(roster?.extras.calls),
    onward: Boolean(roster?.extras.onward),
    saxon: Boolean(roster && /^saxon\b/i.test(roster.name)),
    // Cornwall’s office online-form note stays in the Reporter. The site form does not show it.
    online: false,
    vulnerabilities: Boolean(roster?.extras.vulnerabilities),
    mtvh: Boolean(roster && /^MTVH\b/i.test(roster.name)),
    ratingScheme: roster?.ratingScheme === "OLD" ? "OLD" : "NEW",
  };
}

/** New-scheme rating that asks MTVH for a client call reference. */
export const HHSRS_EMERGENCY_RISK_RATING = "High - Emergency risk";

/**
 * Missing window restrictors use the existing hazard Falling Between Levels
 * (falls between levels). There is no separate window-restrictor category.
 */
export const WINDOW_RESTRICTOR_CATEGORY = "Falling Between Levels";

export const WINDOW_RESTRICTOR_LOCATIONS = [
  "Hall",
  "Kitchen",
  "Lounge",
  "Other GF",
  "Landing",
  "Bedroom 1",
  "Bedroom 2",
  "Bedroom 3",
  "Bathroom",
] as const;

export const WINDOW_RESTRICTOR_MATERIALS = ["PVC", "Timber", "Metal"] as const;

/** Always-on for call projects. MTVH only when the rating is High - Emergency risk. */
export function siteFormShowsCallReference(projectName: string, rating: string): boolean {
  const flags = siteFormProjectFlags(projectName);
  if (flags.calls) return true;
  return flags.mtvh && String(rating || "") === HHSRS_EMERGENCY_RISK_RATING;
}

/**
 * The sentence under the call reference ("Required for this project…").
 * Onward, Vico, and any project that always collects a call reference show it
 * only once Extra details is the section on screen. MTVH never shows it, even
 * when an emergency rating opens the call-reference box. A hidden section does not.
 */
export function siteFormShowsExtraDetailsWording(projectName: string, sectionReached: boolean): boolean {
  return Boolean(sectionReached) && siteFormProjectFlags(projectName).calls;
}

export function siteFormShowsWindowRestrictor(projectName: string, category: string): boolean {
  return siteFormProjectFlags(projectName).mtvh && String(category || "") === WINDOW_RESTRICTOR_CATEGORY;
}

export function canonicalRestrictorLocations(value: unknown): string {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(",");
  const allowed = new Set<string>(WINDOW_RESTRICTOR_LOCATIONS);
  const chosen = new Set<string>();
  for (const part of parts) {
    const text = String(part || "").trim();
    if (allowed.has(text)) chosen.add(text);
  }
  return WINDOW_RESTRICTOR_LOCATIONS.filter((loc) => chosen.has(loc)).join(", ");
}

/** Damp and mould is the only category that asks Vico for a suspected cause. */
export function isDampMouldCategory(category: string): boolean {
  const text = String(category || "");
  return /damp/i.test(text) && /mould|mold/i.test(text);
}

/** Vico shows suspected cause only after damp and mould is selected. It is required then. */
export function siteFormShowsSuspectedCause(projectName: string, category: string): boolean {
  return siteFormProjectFlags(projectName).vulnerabilities && isDampMouldCategory(category);
}

export type ReporterCaseDetailExtras = {
  calls: boolean;
  otherDetails: boolean;
  vulnerabilities: boolean;
  cause: boolean;
  restrictors: boolean;
  surveyDate: boolean;
};

function detailFilled(value: unknown): boolean {
  return Boolean(String(value ?? "").trim());
}

/**
 * Which surveyor answers belong on Reporter case details.
 * A project only shows the extra boxes its own site form asks for.
 * A stored MTVH answer still shows if the rating or hazard later changes.
 */
export function reporterCaseDetailExtras(input: {
  projectName?: string | null;
  category?: string | null;
  rating?: string | null;
  surveyDate?: string | null;
  clientCallReference?: string | null;
  callOutcome?: string | null;
  callNotes?: string | null;
  suspectedCause?: string | null;
  restrictorMissingCount?: string | null;
  restrictorLocations?: string | null;
  restrictorMaterial?: string | null;
}): ReporterCaseDetailExtras {
  const projectName = String(input.projectName || "").trim();
  const flags = siteFormProjectFlags(projectName);
  const category = String(input.category || "");
  const rating = String(input.rating || "");
  const callStored =
    detailFilled(input.clientCallReference) || detailFilled(input.callOutcome) || detailFilled(input.callNotes);
  const restrictorStored =
    detailFilled(input.restrictorMissingCount) ||
    detailFilled(input.restrictorLocations) ||
    detailFilled(input.restrictorMaterial);
  const roster = resolveHhsrsProject(projectName).roster;
  return {
    calls: Boolean(projectName) && (flags.calls || (flags.mtvh && (rating === HHSRS_EMERGENCY_RISK_RATING || callStored))),
    otherDetails: Boolean(projectName),
    vulnerabilities: flags.vulnerabilities,
    cause: flags.vulnerabilities && (siteFormShowsSuspectedCause(projectName, category) || detailFilled(input.suspectedCause)),
    restrictors: flags.mtvh && (siteFormShowsWindowRestrictor(projectName, category) || restrictorStored),
    surveyDate: detailFilled(input.surveyDate) || Boolean(roster?.extras.survey_date),
  };
}

/** Extra answers from the site form, and only the boxes that project uses. */
export function surveyorDetailLines(input: {
  projectName?: string | null;
  category?: string | null;
  rating?: string | null;
  surveyDate?: string | null;
  clientCallReference?: string | null;
  callOutcome?: string | null;
  callNotes?: string | null;
  otherDetails?: string | null;
  vulnerabilities?: string | null;
  suspectedCause?: string | null;
  restrictorMissingCount?: string | null;
  restrictorLocations?: string | null;
  restrictorMaterial?: string | null;
}): { label: string; value: string }[] {
  const extras = reporterCaseDetailExtras(input);
  const lines: { label: string; value: string }[] = [];
  const push = (show: boolean, label: string, value: unknown) => {
    if (!show) return;
    lines.push({ label, value: String(value ?? "").trim() });
  };
  push(extras.calls, "Call reference", input.clientCallReference);
  if (extras.calls && (detailFilled(input.callNotes) || detailFilled(input.callOutcome))) {
    push(true, "Call notes", input.callNotes);
  }
  push(extras.vulnerabilities, "Vulnerabilities", input.vulnerabilities);
  push(extras.cause, "Suspected cause", input.suspectedCause);
  push(extras.restrictors, "Window restrictors missing", input.restrictorMissingCount);
  push(extras.restrictors, "Location", input.restrictorLocations);
  push(extras.restrictors, "Window material", input.restrictorMaterial);
  push(extras.otherDetails, "Any other details", input.otherDetails);
  return lines;
}

/** Category dropdown for the surveyor form. Onward and Vico use the old 29. */
export function siteFormCategoryChoices(projectName: string): readonly string[] {
  return siteFormProjectFlags(projectName).ratingScheme === "OLD" ? HHSRS_LEGACY_CATEGORIES : HHSRS_CATEGORIES;
}

/** Rating dropdown for the surveyor form. Onward and Vico use Slight, Moderate, Severe. */
export function siteFormRatingChoices(projectName: string): readonly string[] {
  return siteFormProjectFlags(projectName).ratingScheme === "OLD"
    ? HHSRS_ONWARD_VICO_RATINGS
    : HHSRS_SITE_FORM_NEW_RATINGS;
}

function readFlag(body: Record<string, unknown>, name: string): boolean {
  const raw = body[name];
  return raw === true || raw === "true" || raw === "on" || raw === "yes";
}

/** Map a completed "couldn't get through" answer onto the Reporter call fields. */
export function siteSubmissionCallFields(
  values: Pick<HhsrsFormValues, "clientCallReference" | "callUnreached" | "callRefBlankReason" | "callUnreachedNote">
): { clientCallReference: string; callOutcome: "" | "Attempted"; callNotes: string } {
  const reason = String(values.callRefBlankReason || "").trim();
  if (values.callUnreached && isCallRefBlankReason(reason)) {
    const callNotes = composeCallNotes(reason, values.callUnreachedNote);
    if (reason !== "Other" || String(values.callUnreachedNote || "").trim()) {
      return { clientCallReference: "", callOutcome: "Attempted", callNotes };
    }
  }
  return {
    clientCallReference: String(values.clientCallReference || "").trim(),
    callOutcome: "",
    callNotes: "",
  };
}

export type HhsrsFormData = HhsrsFormValues & {
  projectName: string;
};

export type HhsrsDraft = HhsrsFormData & {
  id: string;
  photos: HhsrsPhoto[];
  createdAt: string;
};

export type HhsrsFieldErrors = Partial<Record<keyof HhsrsFormValues | "photos", string>>;

export function hhsrsUrl(href = ""): string {
  if (!href || href === "/") return HHSRS_SITE_FORM_PATH;
  const pathPart = href.startsWith("/") ? href : `/${href}`;
  if (pathPart === HHSRS_SITE_FORM_PATH || pathPart.startsWith(`${HHSRS_SITE_FORM_PATH}/`)) {
    return pathPart;
  }
  return `${HHSRS_SITE_FORM_PATH}${pathPart}`;
}

export function todayLondonDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

export type ThanksField = { label: string; value: string };
export type ThanksPhoto = { label: string; name: string; url: string };
export type ThanksSummary = {
  reference: string;
  rows: ThanksField[];
  details: string;
  notes: ThanksField[];
  photos: ThanksPhoto[];
};

/** What the surveyor just submitted. Only this issue — never a list of others. */
export function buildThanksSummary(
  row: {
    reference?: string | null;
    projectName: string;
    fullAddress: string;
    postcode: string;
    uprn: string;
    surveyorName: string;
    surveyDate: string;
    category: string;
    rating: string;
    comment: string;
    suspectedCause?: string | null;
    otherDetails?: string | null;
    clientCallReference?: string | null;
    callOutcome?: string | null;
    callNotes?: string | null;
    vulnerabilities?: string | null;
    restrictorMissingCount?: string | null;
    restrictorLocations?: string | null;
    restrictorMaterial?: string | null;
    photoPaths: unknown;
  },
  photoUrl: (fileName: string) => string
): ThanksSummary {
  const address = [row.fullAddress, row.postcode]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .filter((part, index, all) => all.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === index)
    .join(", ");
  const postcode = String(row.postcode || "").trim();
  const addressLine =
    postcode && !address.toLowerCase().includes(postcode.toLowerCase()) ? `${address}, ${postcode}` : address;
  const rows: ThanksField[] = [
    { label: "Project", value: row.projectName },
    { label: "Address", value: addressLine },
    { label: "UPRN", value: row.uprn },
    { label: "Surveyor", value: row.surveyorName },
    { label: "Survey date", value: formatHhsrsSurveyDate(row.surveyDate) },
    { label: "Hazard", value: row.category },
    { label: "Rating", value: row.rating },
  ];
  const notes: ThanksField[] = [];
  const cause = String(row.suspectedCause || "").trim();
  if (cause) notes.push({ label: "Suspected cause", value: cause });
  const vulnerabilities = String(row.vulnerabilities || "").trim();
  if (vulnerabilities) notes.push({ label: "Vulnerabilities", value: vulnerabilities });
  const missingRestrictors = String(row.restrictorMissingCount || "").trim();
  if (missingRestrictors) {
    notes.push({ label: "Window restrictors missing", value: missingRestrictors });
    const locations = String(row.restrictorLocations || "").trim();
    if (locations) notes.push({ label: "Location", value: locations });
    const material = String(row.restrictorMaterial || "").trim();
    if (material) notes.push({ label: "Window material", value: material });
  }
  const other = String(row.otherDetails || "").trim();
  if (other) notes.push({ label: "Other details", value: other });
  const flags = siteFormProjectFlags(row.projectName);
  const callReference = String(row.clientCallReference || "").trim();
  const callOutcome = String(row.callOutcome || "").trim();
  const callNotes = String(row.callNotes || "").trim();
  if (flags.calls || callReference || callOutcome || callNotes) {
    if (callReference) notes.push({ label: "Call reference", value: callReference });
    if (callOutcome) notes.push({ label: "Call outcome", value: callOutcome });
    if (callNotes) notes.push({ label: "Call notes", value: callNotes });
  }
  const paths = Array.isArray(row.photoPaths) ? row.photoPaths.map((item) => String(item || "")) : [];
  const photos: ThanksPhoto[] = paths
    .map((stored) => stored.split("/").filter(Boolean).pop() || "")
    .filter(Boolean)
    .map((name, index) => ({
      label: `Photo ${index + 1}`,
      name,
      url: photoUrl(name),
    }));
  return {
    reference: String(row.reference || "").trim(),
    rows,
    details: String(row.comment || "").trim(),
    notes,
    photos,
  };
}

/** UK display (DD/MM/YYYY). Stored and submitted survey dates stay YYYY-MM-DD. */
export function formatHhsrsSurveyDate(value: string): string {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || "");
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function emptyHhsrsValues(): HhsrsFormValues {
  return {
    projectId: "",
    surveyDate: todayLondonDate(),
    uprn: "",
    fullAddress: "",
    postcode: "",
    addressConfirmed: false,
    addressSource: "",
    addressLine1: "",
    addressLine2: "",
    town: "",
    surveyorName: "",
    category: "",
    rating: "",
    comment: "",
    suspectedCause: "",
    clientCallReference: "",
    otherDetails: "",
    cat1Confirmed: false,
    callUnreached: false,
    callRefBlankReason: "",
    callUnreachedNote: "",
    vulnerabilities: "",
    restrictorMissingCount: "",
    restrictorLocations: "",
    restrictorMaterial: "",
  };
}

export function readHhsrsValues(body: Record<string, unknown>): HhsrsFormValues {
  const field = (name: keyof HhsrsFormValues): string => String(body[name] ?? "").trim();
  let callRefBlankReason = field("callRefBlankReason");
  let callUnreachedNote = field("callUnreachedNote");
  if (!callRefBlankReason && isCallRefBlankReason(callUnreachedNote)) {
    callRefBlankReason = callUnreachedNote;
    callUnreachedNote = "";
  }
  return {
    projectId: field("projectId"),
    surveyDate: field("surveyDate") || todayLondonDate(),
    uprn: normalizeUprn(field("uprn")),
    fullAddress: field("fullAddress"),
    postcode: field("postcode"),
    addressConfirmed: readFlag(body, "addressConfirmed"),
    addressSource: field("addressSource") === ADDRESS_SOURCE_MANUAL ? ADDRESS_SOURCE_MANUAL : "",
    addressLine1: field("addressLine1"),
    addressLine2: field("addressLine2"),
    town: field("town"),
    surveyorName: field("surveyorName"),
    category: field("category"),
    rating: field("rating"),
    comment: field("comment"),
    suspectedCause: field("suspectedCause"),
    clientCallReference: field("clientCallReference"),
    otherDetails: field("otherDetails"),
    cat1Confirmed: false,
    callUnreached: readFlag(body, "callUnreached"),
    callRefBlankReason,
    callUnreachedNote,
    vulnerabilities: field("vulnerabilities"),
    restrictorMissingCount: field("restrictorMissingCount"),
    restrictorLocations: canonicalRestrictorLocations(body.restrictorLocations),
    restrictorMaterial: field("restrictorMaterial"),
  };
}

export function extOf(name: string): string {
  const m = String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function isAllowedImageName(name: string, mime = ""): boolean {
  const ext = extOf(name);
  if ((HHSRS_ALLOWED_EXTS as readonly string[]).includes(ext)) return true;
  const type = String(mime || "").toLowerCase();
  return (HHSRS_ALLOWED_MIMES as readonly string[]).includes(type);
}

export function imageExt(name: string, mime = ""): string {
  const ext = extOf(name);
  if ((HHSRS_ALLOWED_EXTS as readonly string[]).includes(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }
  const type = String(mime || "").toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic") return "heic";
  if (type === "image/heif") return "heif";
  return "jpg";
}

export type ValidateHhsrsOptions = {
  /** When set, the surveyor must be one of these Personnel names. */
  surveyorNames?: readonly string[];
};

export function siteFormSectionState(
  values: HhsrsFormValues,
  projectName: string
): { visit: boolean; property: boolean; hazard: boolean; extras: boolean } {
  const visit = Boolean(values.projectId && values.surveyDate && String(values.surveyorName || "").trim());
  const manual = values.addressSource === ADDRESS_SOURCE_MANUAL;
  const property =
    visit &&
    Boolean(
      String(values.uprn || "").trim() &&
        (manual
          ? String(values.addressLine1 || "").trim() && isBasicUkPostcode(values.postcode)
          : String(values.fullAddress || "").trim() &&
            String(values.postcode || "").trim() &&
            values.addressConfirmed)
    );
  const showRestrictor = siteFormShowsWindowRestrictor(projectName, values.category);
  const restrictorOk =
    !showRestrictor ||
    Boolean(
      String(values.restrictorMissingCount || "").trim() &&
        canonicalRestrictorLocations(values.restrictorLocations) &&
        (WINDOW_RESTRICTOR_MATERIALS as readonly string[]).includes(String(values.restrictorMaterial || "").trim())
    );
  const causeOk =
    !siteFormShowsSuspectedCause(projectName, values.category) || Boolean(String(values.suspectedCause || "").trim());
  const hazard =
    property &&
    Boolean(String(values.category || "").trim() && String(values.rating || "").trim() && String(values.comment || "").trim()) &&
    restrictorOk &&
    causeOk;
  const flags = siteFormProjectFlags(projectName);
  const showCalls = siteFormShowsCallReference(projectName, values.rating);
  let callOk = true;
  if (showCalls) {
    const reason = String(values.callRefBlankReason || "").trim();
    const notes = String(values.callUnreachedNote || "").trim();
    if (values.callUnreached) {
      callOk = reason === "No answer" || reason === "Engaged/busy" || (reason === "Other" && Boolean(notes));
    } else {
      callOk = Boolean(String(values.clientCallReference || "").trim());
    }
  }
  const vulnOk = !flags.vulnerabilities || Boolean(String(values.vulnerabilities || "").trim());
  const extras = hazard && callOk && vulnOk;
  return { visit, property, hazard, extras };
}

export function validateHhsrsForm(
  values: HhsrsFormValues,
  activeProject: { id: string; name: string } | null,
  options: ValidateHhsrsOptions = {}
): { ok: true; data: HhsrsFormData } | { ok: false; errors: HhsrsFieldErrors } {
  const errors: HhsrsFieldErrors = {};
  if (!values.projectId) errors.projectId = "Select a project.";
  else if (!activeProject) errors.projectId = "Select a current project, or one archived in the last 2 weeks.";
  if (!values.surveyDate) errors.surveyDate = "Enter the survey date.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.surveyDate)) {
    errors.surveyDate = "Use a valid date.";
  } else {
    const [y, m, d] = values.surveyDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      errors.surveyDate = "Use a valid date.";
    }
  }
  if (!values.uprn) errors.uprn = "Enter the UPRN.";
  if (values.addressSource === ADDRESS_SOURCE_MANUAL) {
    if (!values.addressLine1) errors.addressLine1 = "Enter address line 1.";
    if (!values.postcode) errors.postcode = "Enter the postcode.";
    else if (!isBasicUkPostcode(values.postcode)) errors.postcode = "Enter a valid UK postcode.";
  } else {
    if (!values.fullAddress) errors.fullAddress = "Enter the full address.";
    if (!values.postcode) errors.postcode = "Enter the postcode.";
    if (!values.addressConfirmed) errors.addressConfirmed = "Confirm the address is correct.";
  }
  if (!values.surveyorName) errors.surveyorName = "Select a surveyor.";
  else if (options.surveyorNames && !options.surveyorNames.includes(values.surveyorName)) {
    errors.surveyorName = "Select a surveyor from Personnel.";
  }
  const categoryChoices = siteFormCategoryChoices(activeProject?.name || "");
  if (!values.category) errors.category = "Select an HHSRS category.";
  else if (!categoryChoices.includes(values.category)) errors.category = "Select a valid HHSRS category.";
  const ratingChoices = siteFormRatingChoices(activeProject?.name || "");
  if (!values.rating) errors.rating = "Select a rating.";
  else if (!ratingChoices.includes(values.rating)) errors.rating = "Select a rating from the list.";
  if (!values.comment) errors.comment = "Enter a comment.";
  const projectName = activeProject?.name || "";
  const flags = siteFormProjectFlags(projectName);
  const showCalls = siteFormShowsCallReference(projectName, values.rating);
  const showCause = siteFormShowsSuspectedCause(projectName, values.category);
  const showRestrictor = siteFormShowsWindowRestrictor(projectName, values.category);
  const callUnreached = Boolean(values.callUnreached);
  const callReason = String(values.callRefBlankReason || "").trim();
  const callNote = String(values.callUnreachedNote || "").trim();
  let skippedCall = false;
  if (showCalls) {
    if (callUnreached) {
      if (!isCallRefBlankReason(callReason)) {
        errors.callRefBlankReason = "Select why the call reference is blank.";
      } else if (callReason === "Other" && !callNote) {
        errors.callUnreachedNote = "Say why the call reference is blank.";
      } else {
        skippedCall = true;
      }
    } else if (!String(values.clientCallReference || "").trim()) {
      errors.clientCallReference = "Enter the client call reference, or say why it is blank.";
    }
  }
  if (flags.vulnerabilities && !String(values.vulnerabilities || "").trim()) {
    errors.vulnerabilities = "Enter the vulnerabilities.";
  }
  if (showCause && !String(values.suspectedCause || "").trim()) {
    errors.suspectedCause = "Enter the suspected cause.";
  }
  const restrictorMissingCount = showRestrictor ? String(values.restrictorMissingCount || "").trim() : "";
  const restrictorLocations = showRestrictor ? canonicalRestrictorLocations(values.restrictorLocations) : "";
  const restrictorMaterial = showRestrictor ? String(values.restrictorMaterial || "").trim() : "";
  if (showRestrictor) {
    if (!restrictorMissingCount) errors.restrictorMissingCount = "Enter how many window restrictors are missing.";
    if (!restrictorLocations) errors.restrictorLocations = "Select at least one location.";
    if (!(WINDOW_RESTRICTOR_MATERIALS as readonly string[]).includes(restrictorMaterial)) {
      errors.restrictorMaterial = "Select the window material.";
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      ...values,
      uprn: normalizeUprn(values.uprn),
      postcode: values.addressSource === ADDRESS_SOURCE_MANUAL ? normalizeUkPostcode(values.postcode) : values.postcode,
      fullAddress:
        values.addressSource === ADDRESS_SOURCE_MANUAL
          ? composeManualFullAddress(values.addressLine1, values.addressLine2, values.town)
          : values.fullAddress,
      clientCallReference: showCalls && !skippedCall ? String(values.clientCallReference || "").trim() : "",
      suspectedCause: showCause ? String(values.suspectedCause || "").trim() : "",
      vulnerabilities: flags.vulnerabilities ? String(values.vulnerabilities || "").trim() : "",
      restrictorMissingCount,
      restrictorLocations,
      restrictorMaterial,
      otherDetails: String(values.otherDetails || "").trim(),
      callUnreached: showCalls && skippedCall,
      callRefBlankReason: showCalls && skippedCall ? callReason : "",
      callUnreachedNote: showCalls && skippedCall ? callNote : "",
      addressConfirmed: true,
      cat1Confirmed: false,
      projectName: activeProject!.name,
    },
  };
}

export function validatePhotos(
  incoming: { originalname: string; mimetype: string; size: number }[],
  existingCount: number
): string | undefined {
  const countError = hhsrsPhotoCountError(incoming.length + existingCount);
  if (countError) return countError;
  for (const file of incoming) {
    if (file.size > HHSRS_MAX_FILE_BYTES) {
      return hhsrsPhotoSizeError();
    }
    if (!isAllowedImageName(file.originalname, file.mimetype)) {
      return "Photos must be JPEG, PNG, WebP or HEIC.";
    }
  }
  return undefined;
}

export function hhsrsUploadRoot(): string {
  const uploadDir = process.env.UPLOAD_DIR || "uploads";
  return path.join(process.cwd(), uploadDir, "hhsrs-site-form");
}

export function draftDir(draftId: string): string {
  return path.join(hhsrsUploadRoot(), "drafts", safeId(draftId));
}

export function submissionDir(submissionId: string): string {
  return path.join(hhsrsUploadRoot(), safeId(submissionId));
}

export function safeId(id: string): string {
  const value = String(id || "");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(value)) {
    throw new Error("Invalid id");
  }
  return value;
}

export function safeStoredName(name: string): string {
  const value = String(name || "").replace(/[/\\]/g, "");
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value.includes("..")) {
    throw new Error("Invalid file name");
  }
  return value;
}

function resolveUnder(baseDir: string, name: string): string {
  const base = path.resolve(baseDir);
  const dest = path.resolve(base, safeStoredName(name));
  if (!dest.startsWith(base + path.sep)) {
    throw new Error("Invalid path");
  }
  return dest;
}

export function draftPhotoPath(draftId: string, storedName: string): string {
  return resolveUnder(draftDir(draftId), storedName);
}

export function submissionPhotoPath(submissionId: string, storedName: string): string {
  return resolveUnder(submissionDir(submissionId), storedName);
}

export async function readDraft(draftId: string): Promise<HhsrsDraft | null> {
  try {
    const raw = await fs.readFile(path.join(draftDir(draftId), "meta.json"), "utf8");
    const parsed = JSON.parse(raw) as HhsrsDraft;
    if (!parsed || parsed.id !== draftId) return null;
    const base = emptyHhsrsValues();
    return {
      ...base,
      ...parsed,
      addressSource: parsed.addressSource === ADDRESS_SOURCE_MANUAL ? ADDRESS_SOURCE_MANUAL : "",
      addressLine1: parsed.addressLine1 || "",
      addressLine2: parsed.addressLine2 || "",
      town: parsed.town || "",
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
    };
  } catch {
    return null;
  }
}

export async function writeDraft(draft: HhsrsDraft): Promise<void> {
  const dir = draftDir(draft.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(draft, null, 2), "utf8");
}

export async function deleteDraft(draftId: string): Promise<void> {
  try {
    await fs.rm(draftDir(draftId), { recursive: true, force: true });
  } catch {
    // already gone
  }
}

export async function saveIncomingPhotos(
  draftId: string,
  files: { originalname: string; mimetype: string; size: number; buffer: Buffer }[]
): Promise<HhsrsPhoto[]> {
  const prepared = [];
  for (const file of files) {
    const ready = await prepareSitePhoto({
      originalName: file.originalname,
      mime: file.mimetype,
      buffer: file.buffer,
    });
    prepared.push({
      ready,
      originalName: String(file.originalname || "photo").slice(0, 180),
    });
  }
  const dir = draftDir(draftId);
  await fs.mkdir(dir, { recursive: true });
  const saved: HhsrsPhoto[] = [];
  for (const item of prepared) {
    const storedName = `${randomUUID()}.${item.ready.ext}`;
    await fs.writeFile(path.join(dir, storedName), item.ready.buffer);
    saved.push({
      storedName,
      originalName: item.originalName,
      mime: item.ready.mime,
      size: item.ready.buffer.length,
    });
  }
  return saved;
}

export function keepRequestedPhotos(draft: HhsrsDraft, keepNames: string[]): HhsrsPhoto[] {
  const allowed = new Set(keepNames);
  return draft.photos.filter((p) => allowed.has(p.storedName));
}

export async function pruneRemovedPhotos(draft: HhsrsDraft, keep: HhsrsPhoto[]): Promise<void> {
  const keepNames = new Set(keep.map((p) => p.storedName));
  for (const photo of draft.photos) {
    if (keepNames.has(photo.storedName)) continue;
    try {
      await fs.unlink(draftPhotoPath(draft.id, photo.storedName));
    } catch {
      // already gone
    }
  }
}

/**
 * Copy each draft photo into the submission cache and the private Spaces
 * bucket. photoPaths stay `hhsrs-site-form/<submissionId>/<file>`.
 * A failed upload deletes anything already stored for this attempt and throws.
 * The caller must not save photoPaths, and must keep the draft so the
 * surveyor can try again.
 */
export async function persistSubmissionPhotos(
  submissionId: string,
  draft: HhsrsDraft,
  storage?: SitePhotoStorage,
  options?: SitePhotoPutOptions
): Promise<string[]> {
  const destDir = submissionDir(submissionId);
  await fs.mkdir(destDir, { recursive: true });
  const paths: string[] = [];
  const store = storage ?? defaultSitePhotoStorage();
  try {
    for (const photo of draft.photos) {
      const raw = await fs.readFile(draftPhotoPath(draft.id, photo.storedName));
      const ready = await prepareSitePhoto({
        originalName: photo.storedName,
        mime: photo.mime,
        buffer: raw,
      });
      const storedName = storedNameForPrepared(photo.storedName, ready.ext);
      await fs.writeFile(path.join(destDir, storedName), ready.buffer);
      const key = siteFormPhotoKey(submissionId, storedName);
      await putSitePhotoWithRetry(store, key, ready.buffer, ready.mime, options);
      paths.push(key);
    }
    return paths;
  } catch (err) {
    await Promise.all(paths.map((key) => store.remove(key).catch(() => false)));
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

function photoBaseName(stored: string): string {
  return String(stored || "").split("/").filter(Boolean).pop() || "";
}

/** A stored filename that stays inside the site-form photo rules and does not collide. */
export function replacementPhotoName(original: string, ext: string, taken: Set<string>): string {
  const rawStem = String(original || "")
    .replace(/[/\\]/g, "")
    .replace(/\.[^.]+$/, "");
  const stem =
    rawStem
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 48) || "photo";
  const suffix = String(ext || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
  for (let n = 1; n < 100; n += 1) {
    const candidate = n === 1 ? `${stem}.${suffix}` : `${stem}-${n}.${suffix}`;
    if (taken.has(candidate)) continue;
    try {
      safeStoredName(candidate);
    } catch {
      continue;
    }
    taken.add(candidate);
    return candidate;
  }
  const fallback = `${randomUUID()}.${suffix}`;
  taken.add(fallback);
  return fallback;
}

/**
 * Add photos beside the ones already stored for a case.
 * A failed upload removes only the new files. Existing case photos stay.
 */
export async function appendCasePhotos(
  submissionId: string,
  files: { originalname: string; mimetype: string; buffer: Buffer }[],
  existingNames: readonly string[],
  storage?: SitePhotoStorage,
  options?: SitePhotoPutOptions
): Promise<string[]> {
  if (!files.length) return [];
  const destDir = submissionDir(submissionId);
  await fs.mkdir(destDir, { recursive: true });
  const taken = new Set(existingNames.map(photoBaseName).filter(Boolean));
  const paths: string[] = [];
  const written: string[] = [];
  const store = storage ?? defaultSitePhotoStorage();
  try {
    for (const file of files) {
      const ready = await prepareSitePhoto({
        originalName: file.originalname,
        mime: file.mimetype,
        buffer: file.buffer,
      });
      const storedName = replacementPhotoName(file.originalname, ready.ext, taken);
      const dest = path.join(destDir, storedName);
      await fs.writeFile(dest, ready.buffer);
      written.push(dest);
      const key = siteFormPhotoKey(submissionId, storedName);
      await putSitePhotoWithRetry(store, key, ready.buffer, ready.mime, options);
      paths.push(key);
    }
    return paths;
  } catch (err) {
    await Promise.all(paths.map((key) => store.remove(key).catch(() => false)));
    await Promise.all(written.map((file) => fs.unlink(file).catch(() => undefined)));
    throw err;
  }
}

/** Drop photos added for an amendment that was not sent. Leaves every other case photo. */
export async function discardAppendedCasePhotos(
  submissionId: string,
  keys: readonly string[],
  storage?: SitePhotoStorage
): Promise<void> {
  if (!keys.length) return;
  const store = storage ?? defaultSitePhotoStorage();
  await Promise.all(keys.map((key) => store.remove(key).catch(() => false)));
  await Promise.all(
    keys.map(async (key) => {
      const name = photoBaseName(key);
      if (!name) return;
      try {
        await fs.unlink(path.join(submissionDir(submissionId), safeStoredName(name)));
      } catch {
        // already gone
      }
    })
  );
}

/**
 * Store office-created photos the same way as site-form photos:
 * local cache plus the private Spaces object `hhsrs-site-form/<id>/<file>`.
 * A failed upload removes anything already stored for this attempt and throws.
 */
export async function persistBufferPhotos(
  submissionId: string,
  files: { originalname: string; mimetype: string; buffer: Buffer }[],
  storage?: SitePhotoStorage,
  options?: SitePhotoPutOptions
): Promise<string[]> {
  if (!files.length) return [];
  const destDir = submissionDir(submissionId);
  await fs.mkdir(destDir, { recursive: true });
  const paths: string[] = [];
  const store = storage ?? defaultSitePhotoStorage();
  try {
    for (const file of files) {
      const ready = await prepareSitePhoto({
        originalName: file.originalname,
        mime: file.mimetype,
        buffer: file.buffer,
      });
      const storedName = `${randomUUID()}.${ready.ext}`;
      await fs.writeFile(path.join(destDir, storedName), ready.buffer);
      const key = siteFormPhotoKey(submissionId, storedName);
      await putSitePhotoWithRetry(store, key, ready.buffer, ready.mime, options);
      paths.push(key);
    }
    return paths;
  } catch (err) {
    await Promise.all(paths.map((key) => store.remove(key).catch(() => false)));
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

export async function sweepOldDrafts(now = Date.now()): Promise<void> {
  const root = path.join(hhsrsUploadRoot(), "drafts");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return;
  }
  for (const id of entries) {
    try {
      const stat = await fs.stat(path.join(root, id));
      if (now - stat.mtimeMs > DRAFT_TTL_MS) {
        await fs.rm(path.join(root, id), { recursive: true, force: true });
      }
    } catch {
      // skip
    }
  }
}

export function newDraftId(): string {
  return randomUUID();
}

export function listKeepPhotoNames(body: Record<string, unknown>): string[] {
  const raw = body.keepPhotos;
  const values = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
  return values.filter(Boolean);
}

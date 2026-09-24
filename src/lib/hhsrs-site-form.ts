import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isHhsrsCategory, isHhsrsSiteFormRating } from "./hhsrs-categories.js";
import { matchDemoProject } from "./hhsrs-reporter-projects.js";

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
  surveyorName: string;
  category: string;
  rating: string;
  comment: string;
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
};

/** Which Extra details blocks apply to a live project name. */
export type SiteFormProjectFlags = {
  calls: boolean;
  onward: boolean;
  saxon: boolean;
  online: boolean;
};

export function siteFormProjectFlags(projectName: string): SiteFormProjectFlags {
  const matched = matchDemoProject(projectName);
  return {
    calls: Boolean(matched?.extras.calls),
    onward: Boolean(matched?.extras.onward),
    saxon: Boolean(matched && /^saxon\b/i.test(matched.name)),
    online: Boolean(matched?.extras.online_form),
  };
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

export function emptyHhsrsValues(): HhsrsFormValues {
  return {
    projectId: "",
    surveyDate: todayLondonDate(),
    uprn: "",
    fullAddress: "",
    postcode: "",
    addressConfirmed: false,
    surveyorName: "",
    category: "",
    rating: "",
    comment: "",
    clientCallReference: "",
    otherDetails: "",
    cat1Confirmed: false,
    callUnreached: false,
    callRefBlankReason: "",
    callUnreachedNote: "",
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
    surveyorName: field("surveyorName"),
    category: field("category"),
    rating: field("rating"),
    comment: field("comment"),
    clientCallReference: field("clientCallReference"),
    otherDetails: field("otherDetails"),
    cat1Confirmed: false,
    callUnreached: readFlag(body, "callUnreached"),
    callRefBlankReason,
    callUnreachedNote,
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
  const property =
    visit &&
    Boolean(
      String(values.uprn || "").trim() &&
        String(values.fullAddress || "").trim() &&
        String(values.postcode || "").trim() &&
        values.addressConfirmed
    );
  const hazard =
    property &&
    Boolean(String(values.category || "").trim() && String(values.rating || "").trim() && String(values.comment || "").trim());
  const flags = siteFormProjectFlags(projectName);
  let callOk = true;
  if (flags.calls) {
    const reason = String(values.callRefBlankReason || "").trim();
    const notes = String(values.callUnreachedNote || "").trim();
    if (values.callUnreached) {
      callOk = reason === "No answer" || reason === "Engaged/busy" || (reason === "Other" && Boolean(notes));
    } else {
      callOk = Boolean(String(values.clientCallReference || "").trim());
    }
  }
  const extras = hazard && callOk;
  return { visit, property, hazard, extras };
}

export function validateHhsrsForm(
  values: HhsrsFormValues,
  activeProject: { id: string; name: string } | null,
  options: ValidateHhsrsOptions = {}
): { ok: true; data: HhsrsFormData } | { ok: false; errors: HhsrsFieldErrors } {
  const errors: HhsrsFieldErrors = {};
  if (!values.projectId) errors.projectId = "Select a project.";
  else if (!activeProject) errors.projectId = "Select an active (Current) project.";
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
  if (!values.fullAddress) errors.fullAddress = "Enter the full address.";
  if (!values.postcode) errors.postcode = "Enter the postcode.";
  if (!values.addressConfirmed) errors.addressConfirmed = "Confirm the address is correct.";
  if (!values.surveyorName) errors.surveyorName = "Select a surveyor.";
  else if (options.surveyorNames && !options.surveyorNames.includes(values.surveyorName)) {
    errors.surveyorName = "Select a surveyor from Personnel.";
  }
  if (!values.category) errors.category = "Select an HHSRS category.";
  else if (!isHhsrsCategory(values.category)) errors.category = "Select a valid HHSRS category.";
  if (!values.rating) errors.rating = "Select a rating.";
  else if (!isHhsrsSiteFormRating(values.rating)) errors.rating = "Select a rating from the list.";
  if (!values.comment) errors.comment = "Enter a comment.";
  const flags = siteFormProjectFlags(activeProject?.name || "");
  const callUnreached = Boolean(values.callUnreached);
  const callReason = String(values.callRefBlankReason || "").trim();
  const callNote = String(values.callUnreachedNote || "").trim();
  let skippedCall = false;
  if (flags.calls) {
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
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      ...values,
      uprn: normalizeUprn(values.uprn),
      clientCallReference: skippedCall ? "" : String(values.clientCallReference || "").trim(),
      otherDetails: String(values.otherDetails || "").trim(),
      callUnreached: skippedCall,
      callRefBlankReason: skippedCall ? callReason : "",
      callUnreachedNote: skippedCall ? callNote : "",
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
    return parsed;
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
  const dir = draftDir(draftId);
  await fs.mkdir(dir, { recursive: true });
  const saved: HhsrsPhoto[] = [];
  for (const file of files) {
    const storedName = `${randomUUID()}.${imageExt(file.originalname, file.mimetype)}`;
    await fs.writeFile(path.join(dir, storedName), file.buffer);
    saved.push({
      storedName,
      originalName: String(file.originalname || "photo").slice(0, 180),
      mime: file.mimetype || "application/octet-stream",
      size: file.size,
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

export async function persistSubmissionPhotos(
  submissionId: string,
  draft: HhsrsDraft
): Promise<string[]> {
  const destDir = submissionDir(submissionId);
  await fs.mkdir(destDir, { recursive: true });
  const paths: string[] = [];
  for (const photo of draft.photos) {
    const src = draftPhotoPath(draft.id, photo.storedName);
    const dest = path.join(destDir, photo.storedName);
    await fs.copyFile(src, dest);
    paths.push(`hhsrs-site-form/${submissionId}/${photo.storedName}`);
  }
  return paths;
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

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { extOf, safeOriginalName } from "./documents.js";
import {
  deleteSpacesObject,
  EXPECTED_SPACES_BUCKET,
  EXPECTED_SPACES_ENDPOINT,
  EXPECTED_SPACES_REGION,
  fetchSpacesObject,
  missingSpacesEnvNames,
  putSpacesObject,
  referenceStorageMode,
  resolveReferenceStorageMode,
  spacesStatus,
  spacesTargetOk,
  type ReferenceStorageMode,
} from "./spaces.js";

export class ReferenceStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceStorageError";
  }
}

export const REF_DOC_MAX_BYTES = 20 * 1024 * 1024;
export const REF_DOC_MAX_FILES = 20;

export const ALLOWED_REF_EXTS = ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"] as const;

export type RefCategoryId = "general" | "blocks" | "hhsrs" | "rdsap" | "new-starter" | "other";

export type RefCategory = {
  id: RefCategoryId;
  title: string;
  blurb: string;
  icon: string;
};

export const REFERENCE_CATEGORIES: RefCategory[] = [
  {
    id: "general",
    title: "General Surveying Docs",
    blurb: "Day-to-day surveying references and templates.",
    icon: "GS",
  },
  {
    id: "blocks",
    title: "Blocks",
    blurb: "Block survey guidance and shared forms.",
    icon: "BL",
  },
  {
    id: "hhsrs",
    title: "HHSRS",
    blurb: "HHSRS scoring, hazards, and reporting references.",
    icon: "HH",
  },
  {
    id: "rdsap",
    title: "RDSAP",
    blurb: "RDSAP / energy assessment references.",
    icon: "RD",
  },
  {
    id: "new-starter",
    title: "New Starter Docs",
    blurb: "Inductions, checklists, and onboarding packs.",
    icon: "NS",
  },
  {
    id: "other",
    title: "Other",
    blurb: "Anything that doesn’t sit in the categories above.",
    icon: "OT",
  },
];

/** Three columns, top then bottom, matching the reference-documents draft. */
export const REFERENCE_COLUMNS: RefCategoryId[][] = [
  ["general", "blocks"],
  ["hhsrs", "rdsap"],
  ["new-starter", "other"],
];

export type RefTile = RefCategory & { count: number };

export function categoryById(id: string): RefCategory | undefined {
  return REFERENCE_CATEGORIES.find((c) => c.id === id);
}

export function columnsWithCounts(counts: Map<string, number>): RefTile[][] {
  return REFERENCE_COLUMNS.map((col) =>
    col.map((id) => {
      const cat = categoryById(id);
      if (!cat) throw new Error(`Unknown reference category ${id}`);
      return { ...cat, count: counts.get(id) || 0 };
    })
  );
}

export function isAllowedRefExt(ext: string): boolean {
  return (ALLOWED_REF_EXTS as readonly string[]).includes(ext.toLowerCase());
}

export function displayType(nameOrExt: string): string {
  const e = nameOrExt.includes(".") ? extOf(nameOrExt) : nameOrExt.toLowerCase();
  if (e === "pdf") return "PDF";
  if (e === "doc" || e === "docx") return "Word";
  if (e === "xls" || e === "xlsx") return "Excel";
  if (e === "png" || e === "jpg" || e === "jpeg") return "Image";
  return e ? e.toUpperCase() : "File";
}

/** pdf and images open in the portal. Word and Excel are download-only. */
export function previewKind(ext: string): "" | "pdf" | "image" {
  const e = ext.toLowerCase();
  if (e === "pdf") return "pdf";
  if (e === "png" || e === "jpg" || e === "jpeg") return "image";
  return "";
}

export function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

/** DD-MM-YYYY, matching the reference-documents draft. */
export function formatRefUpdated(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export function referenceDisplayName(original: string, ext: string): string {
  const cleaned = safeOriginalName(original);
  if (!cleaned || cleaned === "file") return `file.${ext}`;
  return cleaned;
}

export function referenceUploadDir(): string {
  return path.join(process.cwd(), config.uploadDir, "reference-documents");
}

export function referenceFilePath(storedName: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(storedName)) {
    throw new Error("Invalid path");
  }
  const base = path.resolve(referenceUploadDir());
  const dest = path.resolve(base, storedName);
  if (!dest.startsWith(base + path.sep)) {
    throw new Error("Invalid path");
  }
  return dest;
}

export function referenceSpacesKey(category: string, storedName: string): string {
  return `reference-documents/${category}/${storedName}`;
}

/** Shown to admins. Names the env vars; never includes key or secret values. */
export function referenceStorageBlockMessage(): string {
  const s = spacesStatus();
  if (s.configured && !spacesTargetOk(s)) {
    return (
      `Reference documents must be stored in DigitalOcean Spaces bucket ${EXPECTED_SPACES_BUCKET} ` +
      `(${EXPECTED_SPACES_REGION}, ${EXPECTED_SPACES_ENDPOINT}). Current Spaces settings do not match, ` +
      `so the file was not saved on the server disk.`
    );
  }
  const missing = missingSpacesEnvNames();
  const missingText = missing.length ? ` Missing ${missing.join(", ")}.` : "";
  return (
    `Reference documents are not saved on the server disk. DigitalOcean Spaces is not configured ` +
    `(bucket ${s.bucket || EXPECTED_SPACES_BUCKET}, region ${s.region || EXPECTED_SPACES_REGION}).` +
    `${missingText} Set SPACES_ENDPOINT (${EXPECTED_SPACES_ENDPOINT}), SPACES_KEY, and SPACES_SECRET on App Platform.`
  );
}

export function referenceStorageNote(): string {
  const s = spacesStatus();
  const mode = referenceStorageMode();
  if (mode === "spaces") {
    return `Files are stored in DigitalOcean Spaces (${s.bucket}, ${s.region}). They are not written to the server disk.`;
  }
  if (mode === "blocked") return referenceStorageBlockMessage();
  return (
    `Files are stored on the server until Spaces is configured. Set SPACES_ENDPOINT, SPACES_KEY, and SPACES_SECRET ` +
    `(bucket ${EXPECTED_SPACES_BUCKET}, region ${EXPECTED_SPACES_REGION}) for durable storage. ` +
    `This disk is not used when NODE_ENV=production or REQUIRE_SPACES=true.`
  );
}

export type StoredReference = {
  spacesKey: string;
  storage: "spaces" | "disk";
};

export async function storeReferenceBytes(
  input: {
    category: string;
    storedName: string;
    buffer: Buffer;
    contentType: string;
  },
  override?: ReferenceStorageMode
): Promise<StoredReference> {
  const key = referenceSpacesKey(input.category, input.storedName);
  const mode = resolveReferenceStorageMode(referenceStorageMode(), override);
  if (mode === "blocked") {
    throw new ReferenceStorageError(referenceStorageBlockMessage());
  }
  if (mode === "spaces") {
    const ok = await putSpacesObject(key, input.buffer, input.contentType);
    if (!ok) {
      throw new ReferenceStorageError(
        "Could not store that file in DigitalOcean Spaces. Nothing was saved on the server disk."
      );
    }
    return { spacesKey: key, storage: "spaces" };
  }
  const dir = referenceUploadDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(referenceFilePath(input.storedName), input.buffer);
  return { spacesKey: "", storage: "disk" };
}

export type LoadedReference = { kind: "path"; path: string } | { kind: "bytes"; buffer: Buffer };

export async function loadReferenceFile(
  doc: {
    storedName: string;
    spacesKey: string;
  },
  override?: ReferenceStorageMode
): Promise<LoadedReference | null> {
  if (doc.spacesKey) {
    const bytes = await fetchSpacesObject(doc.spacesKey);
    return bytes ? { kind: "bytes", buffer: bytes } : null;
  }
  if (resolveReferenceStorageMode(referenceStorageMode(), override) !== "disk") return null;
  try {
    const filePath = referenceFilePath(doc.storedName);
    await fs.access(filePath);
    return { kind: "path", path: filePath };
  } catch {
    return null;
  }
}

/**
 * Removes the Spaces object when the row has one.
 * A local unlink only clears a leftover dev file; it is not the store in production.
 * False when a Spaces object could not be deleted (the database row should stay).
 */
export async function removeReferenceFile(doc: { storedName: string; spacesKey: string }): Promise<boolean> {
  if (doc.spacesKey) {
    if (!spacesStatus().configured) return false;
    const removed = await deleteSpacesObject(doc.spacesKey);
    if (!removed) return false;
  }
  try {
    await fs.unlink(referenceFilePath(doc.storedName));
  } catch {
    // leftover local copy already gone, or the file only lived in Spaces
  }
  return true;
}

export function contentDisposition(action: "view" | "download", filename: string): string {
  const ascii = filename.replace(/[\r\n"]/g, "").replace(/[^\x20-\x7E]/g, "_") || "document";
  const kind = action === "download" ? "attachment" : "inline";
  return `${kind}; filename="${ascii}"`;
}

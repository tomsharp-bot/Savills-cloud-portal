import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";
import {
  defaultPhotoStorageOps,
  parseUploadedPhotoName,
  uploadProjectPhoto,
  type PhotoStorageOps,
} from "./photos.js";

/**
 * Per-file cap. A morning batch is about 20 JPEGs of about 2 MB (about 50 MB
 * for the request). This stays at 50 MB so one large file, or that whole batch,
 * is accepted. Drag-and-drop uploads keep their own smaller cap.
 */
export const PHOTO_INGEST_MAX_BYTES = 50 * 1024 * 1024;
/** One request. scripts/photo-ingest.py sends 20 files and calls again for the next batch. */
export const PHOTO_INGEST_MAX_FILES = 40;
/** Suggested batch size for the morning client. The server accepts up to PHOTO_INGEST_MAX_FILES. */
export const PHOTO_INGEST_BATCH_FILES = 20;

export type IngestFile = {
  originalName: string;
  buffer: Buffer;
  mime?: string;
};

export type IngestBatchResult = {
  uploaded: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
};

export function photoIngestKeyFrom(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.PHOTO_INGEST_KEY ?? "").trim();
}

export function photoIngestConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return photoIngestKeyFrom(env).length > 0;
}

/** Bearer token, or "" when the header is missing or not Bearer. */
export function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(String(header || ""));
  return match ? match[1] : "";
}

/**
 * Compare the Authorization bearer token to PHOTO_INGEST_KEY.
 * Both sides are hashed first so a different length still takes one constant-time compare.
 */
export function photoIngestAuthorized(authorizationHeader: string | undefined, key: string): boolean {
  const expected = String(key || "");
  if (!expected) return false;
  const provided = bearerToken(authorizationHeader).slice(0, 512);
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

export async function resolveIngestProject(
  projectIdOrName: string
): Promise<{ ok: true; project: { id: string; name: string } } | { ok: false; status: 400 | 404; error: string }> {
  const key = String(projectIdOrName || "").trim();
  if (!key || key.length > 200) return { ok: false, status: 400, error: "Project not found." };
  const byId = await prisma.project.findUnique({
    where: { id: key },
    select: { id: true, name: true },
  });
  if (byId) return { ok: true, project: byId };
  const byName = await prisma.project.findUnique({
    where: { name: key },
    select: { id: true, name: true },
  });
  if (byName) return { ok: true, project: byName };
  return { ok: false, status: 404, error: "Project not found." };
}

/**
 * Base filename only. An M3Vision zip has one folder per property
 * (`635770-Challice Way Tillman House 16/635770-Front Door1.jpg`). The pool
 * name is the file, never the folder. Slashes and backslashes are both stripped.
 */
export function photoIngestBaseName(originalName: string): string {
  const trimmed = String(originalName || "").trim();
  const parts = trimmed.split(/[/\\]+/).filter((part) => part.length > 0 && part !== ".");
  return parts.length ? parts[parts.length - 1] : "";
}

/** Stored file names, for the morning job to skip files it already sent. */
export async function listProjectPhotoNames(projectId: string): Promise<string[]> {
  const rows = await prisma.photoPoolItem.findMany({
    where: { projectId },
    select: { fileName: true },
    orderBy: { fileName: "asc" },
  });
  return rows.map((row) => row.fileName);
}

function tooLargeMessage(): string {
  const mb = PHOTO_INGEST_MAX_BYTES / (1024 * 1024);
  return `That photo is larger than ${mb} MB.`;
}

/**
 * Store new pool photos the same way a drag-and-drop upload does.
 * The photo code is the base-filename stem, with spaces, hyphens, the letters
 * `null`, and capitals unchanged. A folder path in the client filename is ignored.
 * The extension is normalised like the portal upload (lower case, `.jpeg` stored as `.jpg`)
 * so the Spaces key matches a drag-and-drop of the same file. An existing name is
 * skipped and the stored object is not replaced.
 * `uploaded` / `skipped` / `failed` use that base filename.
 */
export async function ingestProjectPhotos(
  projectId: string,
  files: IngestFile[],
  ops: PhotoStorageOps = defaultPhotoStorageOps()
): Promise<IngestBatchResult> {
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  const seen = new Set<string>();

  for (const file of files) {
    const name = photoIngestBaseName(file.originalName) || "Untitled";
    const parsed = parseUploadedPhotoName(name);
    if (!parsed.ok) {
      failed.push({ name, error: parsed.error });
      continue;
    }
    const clashKey = parsed.name.code.toUpperCase();
    if (seen.has(clashKey)) {
      skipped.push(name);
      continue;
    }
    if (!file.buffer || file.buffer.length === 0) {
      failed.push({ name, error: "That file is empty." });
      continue;
    }
    if (file.buffer.length > PHOTO_INGEST_MAX_BYTES) {
      failed.push({ name, error: tooLargeMessage() });
      continue;
    }

    const result = await uploadProjectPhoto(
      projectId,
      { originalName: name, buffer: file.buffer, mime: file.mime },
      { kind: "pool" },
      ops,
      { maxBytes: PHOTO_INGEST_MAX_BYTES }
    );
    if (!result.ok) {
      if (result.status === 409) {
        seen.add(clashKey);
        skipped.push(name);
        continue;
      }
      failed.push({ name, error: result.error });
      continue;
    }
    seen.add(clashKey);
    uploaded.push(name);
  }

  return { uploaded, skipped, failed };
}

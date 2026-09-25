import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";
import {
  defaultPhotoStorageOps,
  parseUploadedPhotoName,
  uploadProjectPhoto,
  type PhotoStorageOps,
} from "./photos.js";

/** Morning import limit. The Photos Pool drag-and-drop upload stays at its own limit. */
export const PHOTO_INGEST_MAX_BYTES = 50 * 1024 * 1024;
/** One request. The morning job can call again for the next batch. */
export const PHOTO_INGEST_MAX_FILES = 40;

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
 * The photo code is the filename stem, with that stem's characters and case unchanged.
 * The extension is normalised like the portal upload (lower case, `.jpeg` stored as `.jpg`)
 * so the Spaces key matches. An existing name is skipped and the stored object is not replaced.
 * `uploaded` / `skipped` / `failed` use the original uploaded filename.
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
    const name = String(file.originalName || "").trim() || "Untitled";
    const parsed = parseUploadedPhotoName(file.originalName);
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
      { originalName: file.originalName, buffer: file.buffer, mime: file.mime },
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

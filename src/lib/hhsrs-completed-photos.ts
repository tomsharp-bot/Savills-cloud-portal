/**
 * Copy HHSRS site-form photos into the private Spaces bucket when a case
 * is logged to the Main Log, and list / search those copies.
 *
 * Key layout:
 *   HHSRS - Completed/<Project Progress name>/<UPRN> - <short address>/<file>
 *
 * The full address is stored on the index row (and as Spaces object metadata)
 * so Photo Storage can search by UPRN or address. The site-form object in Spaces
 * is the source of truth. A local file is only a cache. A Spaces failure is
 * recorded and can be retried. The same case logged twice does not create a second copy.
 */

import path from "node:path";
import { config } from "../config.js";
import { formatStockAddressLine } from "./hhsrs-site-form.js";
import { isActionedStatus, photoNames } from "./hhsrs-reporter.js";
import { progressNameForCase } from "./hhsrs-reporter-projects.js";
import {
  fileNameForCode,
  leadFirstName,
  accentClassForName,
  photoCodesOf,
  placeholderThumbUrl,
  poolPhotoImagePath,
  uprnFromCode,
} from "./photos.js";
import { prisma } from "./prisma.js";
import { readSiteFormPhotoBytes, type SitePhotoStorage } from "./hhsrs-site-photos.js";
import { putSpacesObject } from "./spaces.js";

export const HHSRS_COMPLETED_PREFIX = "HHSRS - Completed";
export const PHOTO_SEARCH_LIMIT = 80;
const SEARCH_CANDIDATES = 500;

export type HhsrsCopyStatus = "copied" | "failed" | "skipped";

export type CopyOutcome = {
  status: HhsrsCopyStatus;
  error: string;
  copiedCount: number;
  failedCount: number;
};

export type HhsrsCaseSnapshot = {
  id: string;
  status: string;
  projectId: string | null;
  projectName: string;
  linkedProjectName: string | null;
  progressNames: string[];
  uprn: string;
  fullAddress: string;
  postcode: string;
  photoPaths: string[];
};

export type NewCompletedPhoto = {
  submissionId: string;
  projectId: string | null;
  projectName: string;
  uprn: string;
  fullAddress: string;
  postcode: string;
  addressLine: string;
  shortAddress: string;
  fileName: string;
  sourcePath: string;
  spacesKey: string;
  contentType: string;
};

export type CopyAttempt = {
  submissionId: string;
  status: "copied" | "failed";
  error: string;
  copiedCount: number;
  failedCount: number;
};

export type HhsrsCopyDeps = {
  loadCase: (id: string) => Promise<HhsrsCaseSnapshot | null>;
  listCopiedSources: (submissionId: string) => Promise<Set<string>>;
  insertPhoto: (row: NewCompletedPhoto) => Promise<"inserted" | "duplicate">;
  saveAttempt: (attempt: CopyAttempt) => Promise<void>;
  readFile: (sourcePath: string) => Promise<Buffer | null>;
  putObject: (
    key: string,
    body: Buffer,
    contentType: string,
    metadata: Record<string, string>
  ) => Promise<boolean>;
};

export type CurrentPhotoProject = {
  id: string;
  name: string;
  projectManager: string;
};

export type HhsrsCompletedTile = {
  projectName: string;
  projectId: string | null;
  accent: string;
  leadFirst: string;
  propertyCount: number;
  photoCount: number;
};

export type HhsrsPropertyRow = {
  uprn: string;
  address: string;
  photoCount: number;
};

export type HhsrsCompletedPhotoView = {
  id: string;
  fileName: string;
  uprn: string;
  address: string;
  contentType: string;
  imageUrl: string;
};

export type PhotoSearchHit = {
  id: string;
  kind: "pool" | "hhsrs";
  projectName: string;
  uprn: string;
  address: string;
  title: string;
  location: string;
  thumbUrl: string;
  imageUrl: string;
};

export type PhotoSearchResult = {
  query: string;
  hits: PhotoSearchHit[];
  truncated: boolean;
};

/**
 * Project Progress name for the Spaces folder.
 * The linked Project Progress record wins. Otherwise use the name the Reporter
 * already maps onto a live project. The stored name is kept when nothing matches.
 * This does not append HHSRS, damp, or mould wording.
 */
export function completedProjectName(input: {
  storedName: string;
  linkedProjectName?: string | null;
  progressNames?: readonly string[];
}): string {
  const linked = String(input.linkedProjectName || "").trim();
  if (linked) return linked;
  const stored = String(input.storedName || "").trim();
  const progressNames = input.progressNames || [];
  if (stored && progressNames.length) {
    const mapped = progressNameForCase(stored, progressNames);
    if (mapped) return mapped;
  }
  return stored || "Unassigned";
}

export function displayAddress(fullAddress: string, postcode = ""): string {
  const line = String(fullAddress || "").replace(/\s+/g, " ").trim();
  const pc = String(postcode || "").replace(/\s+/g, " ").trim();
  if (!pc) return line;
  if (line.toLowerCase().includes(pc.toLowerCase())) return line;
  return line ? `${line}, ${pc}` : pc;
}

/** Address fragment used in the folder name. Long lines are cut on a comma or space. */
export function shortAddressLabel(fullAddress: string, postcode = ""): string {
  const line = displayAddress(fullAddress, postcode);
  if (line.length <= 80) return line;
  const cut = line.slice(0, 80);
  const comma = cut.lastIndexOf(",");
  const space = cut.lastIndexOf(" ");
  const at = comma >= 40 ? comma : space >= 40 ? space : 80;
  return line.slice(0, at).replace(/[\s,]+$/g, "").trim();
}

function safeKeySegment(value: string, fallback: string, max = 120): string {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, max)
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned;
}

export function fileNameFromSource(sourcePath: string): string {
  const base = String(sourcePath || "")
    .split(/[/\\]/)
    .filter(Boolean)
    .pop();
  const cleaned = String(base || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .slice(0, 180)
    .trim();
  return cleaned || "photo";
}

export function contentTypeForPhotoName(fileName: string): string {
  const ext = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return "application/octet-stream";
  }
}

export function hhsrsCompletedObjectKey(input: {
  projectName: string;
  uprn: string;
  shortAddress: string;
  fileName: string;
}): string {
  const project = safeKeySegment(input.projectName, "Unassigned", 140);
  const uprn = safeKeySegment(input.uprn, "unknown", 48);
  const address = safeKeySegment(input.shortAddress, "", 90);
  const folder = address ? `${uprn} - ${address}` : uprn;
  const file = safeKeySegment(fileNameFromSource(input.fileName), "photo", 180);
  return `${HHSRS_COMPLETED_PREFIX}/${project}/${folder}/${file}`;
}

export function hhsrsCompletedProjectPath(projectName: string): string {
  return `/photos/hhsrs/${encodeURIComponent(projectName)}`;
}

export function hhsrsCompletedPropertyPath(projectName: string, uprn: string): string {
  return `/photos/hhsrs/${encodeURIComponent(projectName)}/${encodeURIComponent(uprn)}`;
}

export function hhsrsCompletedFilePath(photoId: string): string {
  return `/photos/hhsrs-photo/${encodeURIComponent(photoId)}`;
}

/** Absolute path for a stored site-form photo, or null when the relative path escapes the upload root. */
export function hhsrsDiskPath(sourcePath: string, uploadDir = config.uploadDir): string | null {
  const rel = String(sourcePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!rel || rel.includes("\0")) return null;
  if (rel.split("/").some((part) => part === "..")) return null;
  const root = path.resolve(process.cwd(), uploadDir);
  const dest = path.resolve(root, rel);
  if (dest !== root && !dest.startsWith(root + path.sep)) return null;
  return dest;
}

export function compareUprn(a: string, b: string): number {
  const as = String(a || "").trim();
  const bs = String(b || "").trim();
  const aNum = /^\d+$/.test(as) ? BigInt(as) : null;
  const bNum = /^\d+$/.test(bs) ? BigInt(bs) : null;
  if (aNum !== null && bNum !== null) {
    if (aNum < bNum) return -1;
    if (aNum > bNum) return 1;
    return as.localeCompare(bs, "en-GB");
  }
  if (aNum !== null) return -1;
  if (bNum !== null) return 1;
  return as.localeCompare(bs, "en-GB", { numeric: true, sensitivity: "base" });
}

export function photoMatchesQuery(
  query: string,
  fields: { uprn?: string; address?: string; fileName?: string; code?: string }
): boolean {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return false;
  const hay = [fields.uprn, fields.address, fields.fileName, fields.code].map((value) =>
    String(value || "").toLowerCase()
  );
  return hay.some((value) => value.includes(q));
}

export function comparePhotoSearchHits(a: PhotoSearchHit, b: PhotoSearchHit): number {
  const byUprn = compareUprn(a.uprn, b.uprn);
  if (byUprn) return byUprn;
  const byTitle = a.title.localeCompare(b.title, "en-GB", { numeric: true, sensitivity: "base" });
  if (byTitle) return byTitle;
  if (a.kind !== b.kind) return a.kind === "hhsrs" ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/** Numerical UPRN order, pool and HHSRS together, capped for the results strip. */
export function mergePhotoSearchHits(
  hits: PhotoSearchHit[],
  limit = PHOTO_SEARCH_LIMIT
): { hits: PhotoSearchHit[]; truncated: boolean } {
  const map = new Map<string, PhotoSearchHit>();
  for (const hit of hits) {
    const key = `${hit.kind}:${hit.id}`;
    if (!map.has(key)) map.set(key, hit);
  }
  const sorted = [...map.values()].sort(comparePhotoSearchHits);
  const cap = Math.max(0, limit);
  return { hits: sorted.slice(0, cap), truncated: sorted.length > cap };
}

function asciiMeta(value: string): string {
  return String(value || "")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 200);
}

function prismaErrorCode(err: unknown): string {
  if (typeof err === "object" && err && "code" in err) return String((err as { code?: string }).code || "");
  return "";
}

export async function copyLoggedCasePhotos(submissionId: string, deps: HhsrsCopyDeps): Promise<CopyOutcome> {
  const row = await deps.loadCase(submissionId);
  if (!row) return { status: "skipped", error: "Case not found.", copiedCount: 0, failedCount: 0 };
  if (!isActionedStatus(row.status)) {
    return { status: "skipped", error: "Case is not on the Main Log.", copiedCount: 0, failedCount: 0 };
  }

  const projectName = completedProjectName({
    storedName: row.projectName,
    linkedProjectName: row.linkedProjectName,
    progressNames: row.progressNames,
  });
  const sources = [...new Set(row.photoPaths.map((item) => String(item || "").trim()).filter(Boolean))];
  const uprn = String(row.uprn || "").trim() || "unknown";
  const addressLine = displayAddress(row.fullAddress, row.postcode);
  const shortAddress = shortAddressLabel(row.fullAddress, row.postcode);

  if (!sources.length) {
    await deps.saveAttempt({
      submissionId,
      status: "copied",
      error: "",
      copiedCount: 0,
      failedCount: 0,
    });
    return { status: "copied", error: "", copiedCount: 0, failedCount: 0 };
  }

  // Record a failure first so a crash mid-copy can still be retried.
  await deps.saveAttempt({
    submissionId,
    status: "failed",
    error: "Copy did not finish",
    copiedCount: 0,
    failedCount: sources.length,
  });

  const already = await deps.listCopiedSources(submissionId);
  let copiedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const sourcePath of sources) {
    const fileName = fileNameFromSource(sourcePath);
    if (already.has(sourcePath)) {
      copiedCount += 1;
      continue;
    }
    const spacesKey = hhsrsCompletedObjectKey({
      projectName,
      uprn,
      shortAddress,
      fileName,
    });
    const bytes = await deps.readFile(sourcePath);
    if (!bytes) {
      failedCount += 1;
      errors.push(`Missing photo: ${fileName}`);
      continue;
    }
    const contentType = contentTypeForPhotoName(fileName);
    const stored = await deps.putObject(spacesKey, bytes, contentType, {
      uprn: asciiMeta(uprn),
      address: asciiMeta(addressLine),
      project: asciiMeta(projectName),
      submission: asciiMeta(row.id),
    });
    if (!stored) {
      failedCount += 1;
      errors.push(`Storage failed: ${fileName}`);
      continue;
    }
    const inserted = await deps.insertPhoto({
      submissionId,
      projectId: row.projectId,
      projectName,
      uprn,
      fullAddress: String(row.fullAddress || "").trim(),
      postcode: String(row.postcode || "").trim(),
      addressLine,
      shortAddress,
      fileName,
      sourcePath,
      spacesKey,
      contentType,
    });
    if (inserted === "inserted" || inserted === "duplicate") {
      copiedCount += 1;
      already.add(sourcePath);
    } else {
      failedCount += 1;
      errors.push(`Could not index: ${fileName}`);
    }
  }

  const status = failedCount > 0 ? "failed" : "copied";
  const error = errors.join("; ").slice(0, 800);
  await deps.saveAttempt({ submissionId, status, error, copiedCount, failedCount });
  return { status, error, copiedCount, failedCount };
}

export function defaultHhsrsCopyDeps(storage?: SitePhotoStorage): HhsrsCopyDeps {
  return {
    loadCase: loadCaseSnapshot,
    listCopiedSources: async (submissionId) => {
      const rows = await prisma.hhsrsCompletedPhoto.findMany({
        where: { submissionId },
        select: { sourcePath: true },
      });
      return new Set(rows.map((row) => row.sourcePath));
    },
    insertPhoto: async (row) => {
      try {
        await prisma.hhsrsCompletedPhoto.create({ data: row });
        return "inserted";
      } catch (err) {
        if (prismaErrorCode(err) === "P2002") return "duplicate";
        throw err;
      }
    },
    saveAttempt: async (attempt) => {
      await prisma.hhsrsPhotoCopy.upsert({
        where: { submissionId: attempt.submissionId },
        create: attempt,
        update: {
          status: attempt.status,
          error: attempt.error,
          copiedCount: attempt.copiedCount,
          failedCount: attempt.failedCount,
        },
      });
    },
    readFile: (sourcePath) => readSiteFormPhotoBytes(sourcePath, storage),
    putObject: (key, body, contentType, metadata) => putSpacesObject(key, body, contentType, metadata),
  };
}

async function loadCaseSnapshot(id: string): Promise<HhsrsCaseSnapshot | null> {
  const row = await prisma.hhsrsSiteSubmission.findUnique({
    where: { id },
    include: { project: { select: { name: true } } },
  });
  if (!row) return null;
  const progress = await prisma.project.findMany({ select: { name: true } });
  return {
    id: row.id,
    status: row.status,
    projectId: row.projectId,
    projectName: row.projectName,
    linkedProjectName: row.project?.name || null,
    progressNames: progress.map((project) => project.name),
    uprn: row.uprn,
    fullAddress: row.fullAddress,
    postcode: row.postcode,
    photoPaths: photoNames(row),
  };
}

/** Copy photos for one logged case. Never throws — a Spaces or disk error is a failed outcome. */
export async function copyLoggedHhsrsPhotos(submissionId: string, deps?: HhsrsCopyDeps): Promise<CopyOutcome> {
  const used = deps ?? defaultHhsrsCopyDeps();
  try {
    return await copyLoggedCasePhotos(submissionId, used);
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 800);
    console.error(`HHSRS photo copy failed for ${submissionId}: ${error}`);
    try {
      await used.saveAttempt({
        submissionId,
        status: "failed",
        error: error || "Copy failed",
        copiedCount: 0,
        failedCount: 0,
      });
    } catch (saveErr) {
      const message = saveErr instanceof Error ? saveErr.message : String(saveErr);
      console.error(`HHSRS photo copy could not record the failure for ${submissionId}: ${message}`);
    }
    return { status: "failed", error, copiedCount: 0, failedCount: 0 };
  }
}

export async function countFailedHhsrsCopies(): Promise<number> {
  return prisma.hhsrsPhotoCopy.count({ where: { status: "failed" } });
}

export async function listFailedHhsrsCopyIds(): Promise<string[]> {
  const rows = await prisma.hhsrsPhotoCopy.findMany({
    where: { status: "failed" },
    select: { submissionId: true },
    orderBy: { updatedAt: "asc" },
  });
  return rows.map((row) => row.submissionId);
}

/** Actioned cases that have never had a copy attempt. Used only by the off-by-default backfill script. */
export async function listUncopiedActionedIds(): Promise<string[]> {
  const rows = await prisma.hhsrsSiteSubmission.findMany({
    where: {
      status: { in: ["email_sent", "closed"] },
      photoCopy: { is: null },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => row.id);
}

/** Same accent and lead as the current-project tile when this is the same Project Progress project. */
export function completedTileAccent(
  projectName: string,
  projectIds: string[],
  current: CurrentPhotoProject[]
): { accent: string; leadFirst: string; projectId: string | null } {
  const byId = current.find((project) => projectIds.includes(project.id));
  const byName = current.find((project) => project.name.toLowerCase() === projectName.toLowerCase());
  const matched = byId || byName;
  return {
    accent: accentClassForName(byId?.name || byName?.name || projectName),
    leadFirst: matched ? leadFirstName(matched.projectManager) : "—",
    projectId: byId?.id || byName?.id || projectIds[0] || null,
  };
}

type CountRow = {
  projectName: string;
  photos: bigint | number;
  properties: bigint | number;
};

export async function listHhsrsCompletedTiles(current: CurrentPhotoProject[]): Promise<HhsrsCompletedTile[]> {
  const [counts, links] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT
        "projectName",
        COUNT(*) AS photos,
        COUNT(DISTINCT "uprn") AS properties
      FROM "HhsrsCompletedPhoto"
      GROUP BY "projectName"
    `,
    prisma.hhsrsCompletedPhoto.findMany({
      where: { projectId: { not: null } },
      distinct: ["projectName", "projectId"],
      select: { projectName: true, projectId: true },
    }),
  ]);

  const idsByName = new Map<string, string[]>();
  for (const link of links) {
    if (!link.projectId) continue;
    const list = idsByName.get(link.projectName) || [];
    list.push(link.projectId);
    idsByName.set(link.projectName, list);
  }

  return counts
    .map((row) => {
      const projectIds = idsByName.get(row.projectName) || [];
      const look = completedTileAccent(row.projectName, projectIds, current);
      return {
        projectName: row.projectName,
        projectId: look.projectId,
        accent: look.accent,
        leadFirst: look.leadFirst,
        propertyCount: Number(row.properties) || 0,
        photoCount: Number(row.photos) || 0,
      };
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName, "en-GB", { sensitivity: "base" }));
}

type PropertySqlRow = {
  uprn: string;
  fullAddress: string;
  postcode: string;
  photos: bigint | number;
};

export async function listHhsrsProperties(projectName: string): Promise<HhsrsPropertyRow[]> {
  const rows = await prisma.$queryRaw<PropertySqlRow[]>`
    SELECT DISTINCT ON ("uprn")
      "uprn",
      "fullAddress",
      "postcode",
      COUNT(*) OVER (PARTITION BY "uprn") AS photos
    FROM "HhsrsCompletedPhoto"
    WHERE "projectName" = ${projectName}
    ORDER BY "uprn", "copiedAt" DESC
  `;
  return rows
    .map((row) => ({
      uprn: row.uprn,
      address: displayAddress(row.fullAddress, row.postcode),
      photoCount: Number(row.photos) || 0,
    }))
    .sort((a, b) => compareUprn(a.uprn, b.uprn) || a.address.localeCompare(b.address, "en-GB"));
}

export async function listHhsrsPropertyPhotos(projectName: string, uprn: string): Promise<{
  address: string;
  photos: HhsrsCompletedPhotoView[];
}> {
  const rows = await prisma.hhsrsCompletedPhoto.findMany({
    where: { projectName, uprn },
    orderBy: [{ copiedAt: "asc" }, { fileName: "asc" }],
  });
  const latest = rows.reduce<(typeof rows)[number] | null>((best, row) => {
    if (!best || row.copiedAt > best.copiedAt) return row;
    return best;
  }, null);
  return {
    address: latest ? displayAddress(latest.fullAddress, latest.postcode) : "",
    photos: rows.map((row) => ({
      id: row.id,
      fileName: row.fileName,
      uprn: row.uprn,
      address: displayAddress(row.fullAddress, row.postcode),
      contentType: row.contentType,
      imageUrl: hhsrsCompletedFilePath(row.id),
    })),
  };
}

export async function readHhsrsCompletedPhoto(photoId: string): Promise<{
  id: string;
  fileName: string;
  contentType: string;
  spacesKey: string;
} | null> {
  const row = await prisma.hhsrsCompletedPhoto.findUnique({
    where: { id: photoId },
    select: { id: true, fileName: true, contentType: true, spacesKey: true },
  });
  if (!row) return null;
  if (!row.spacesKey.startsWith(`${HHSRS_COMPLETED_PREFIX}/`)) return null;
  return row;
}

export async function searchPhotoStorage(query: string): Promise<PhotoSearchResult> {
  const q = String(query || "").trim().slice(0, 120);
  if (!q) return { query: "", hits: [], truncated: false };
  const [hhsrs, existing] = await Promise.all([searchHhsrsCompleted(q), searchExistingStore(q)]);
  const merged = mergePhotoSearchHits([...hhsrs.hits, ...existing.hits], PHOTO_SEARCH_LIMIT);
  return {
    query: q,
    hits: merged.hits,
    truncated: merged.truncated || hhsrs.truncated || existing.truncated,
  };
}

async function searchHhsrsCompleted(q: string): Promise<{ hits: PhotoSearchHit[]; truncated: boolean }> {
  const rows = await prisma.hhsrsCompletedPhoto.findMany({
    where: {
      OR: [
        { uprn: { contains: q, mode: "insensitive" } },
        { addressLine: { contains: q, mode: "insensitive" } },
        { fullAddress: { contains: q, mode: "insensitive" } },
        { postcode: { contains: q, mode: "insensitive" } },
        { shortAddress: { contains: q, mode: "insensitive" } },
        { fileName: { contains: q, mode: "insensitive" } },
      ],
    },
    take: SEARCH_CANDIDATES,
  });
  const hits = rows
    .filter((row) =>
      photoMatchesQuery(q, {
        uprn: row.uprn,
        address: row.addressLine || displayAddress(row.fullAddress, row.postcode),
        fileName: row.fileName,
      })
    )
    .map((row) => ({
      id: row.id,
      kind: "hhsrs" as const,
      projectName: row.projectName,
      uprn: row.uprn,
      address: row.addressLine || displayAddress(row.fullAddress, row.postcode),
      title: row.fileName,
      location: HHSRS_COMPLETED_PREFIX,
      thumbUrl: hhsrsCompletedFilePath(row.id),
      imageUrl: hhsrsCompletedFilePath(row.id),
    }));
  return { hits, truncated: rows.length >= SEARCH_CANDIDATES };
}

async function searchExistingStore(q: string): Promise<{ hits: PhotoSearchHit[]; truncated: boolean }> {
  const direct = await prisma.photoPoolItem.findMany({
    where: {
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { fileName: { contains: q, mode: "insensitive" } },
      ],
    },
    include: { project: { select: { id: true, name: true } } },
    take: SEARCH_CANDIDATES,
  });

  const assets = await prisma.asset.findMany({
    where: {
      OR: [
        { uprn: { contains: q, mode: "insensitive" } },
        { number: { contains: q, mode: "insensitive" } },
        { block: { contains: q, mode: "insensitive" } },
        { street: { contains: q, mode: "insensitive" } },
        { area: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { postcode: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 80,
  });
  const visits = await prisma.visitLog.findMany({
    where: {
      OR: [
        { combinedAddress: { contains: q, mode: "insensitive" } },
        { uprn: { contains: q, mode: "insensitive" } },
        { addressLine1: { contains: q, mode: "insensitive" } },
        { postcode: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { projectId: true, uprn: true, combinedAddress: true },
    take: 40,
  });

  const addressByKey = new Map<string, string>();
  const pairKey = (projectId: string, uprn: string) => `${projectId}:${String(uprn || "").trim()}`;
  for (const asset of assets) {
    const line = displayAddress(formatStockAddressLine(asset), asset.postcode);
    if (line) addressByKey.set(pairKey(asset.projectId, asset.uprn), line);
  }
  for (const visit of visits) {
    const key = pairKey(visit.projectId, visit.uprn);
    if (!addressByKey.has(key) && visit.combinedAddress.trim()) {
      addressByKey.set(key, visit.combinedAddress.trim());
    }
  }

  const pairs: Array<{ projectId: string; uprn: string }> = [];
  const seenPairs = new Set<string>();
  for (const item of [...assets, ...visits]) {
    const uprn = String(item.uprn || "").trim();
    if (!uprn) continue;
    const key = pairKey(item.projectId, uprn);
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    pairs.push({ projectId: item.projectId, uprn });
  }

  const addressPhotos = pairs.length
    ? await prisma.photoPoolItem.findMany({
        where: {
          OR: pairs.slice(0, 40).flatMap((pair) => [
            { projectId: pair.projectId, code: { startsWith: `${pair.uprn}-` } },
            { projectId: pair.projectId, code: { equals: pair.uprn, mode: "insensitive" as const } },
          ]),
        },
        include: { project: { select: { id: true, name: true } } },
        take: SEARCH_CANDIDATES,
      })
    : [];

  const byId = new Map<string, (typeof direct)[number]>();
  for (const item of [...direct, ...addressPhotos]) byId.set(item.id, item);
  const poolItems = [...byId.values()];

  const hitUprns = [...new Set(poolItems.map((item) => uprnFromCode(item.code)).filter(Boolean))].slice(0, 100);
  if (hitUprns.length) {
    const extraAssets = await prisma.asset.findMany({
      where: { uprn: { in: hitUprns } },
      take: 200,
    });
    for (const asset of extraAssets) {
      const key = pairKey(asset.projectId, asset.uprn);
      if (!addressByKey.has(key)) {
        const line = displayAddress(formatStockAddressLine(asset), asset.postcode);
        if (line) addressByKey.set(key, line);
      }
    }
  }

  const projectIds = [...new Set([...poolItems.map((item) => item.projectId), ...pairs.map((pair) => pair.projectId)])];
  const folders = await prisma.photoFolder.findMany({
    where: {
      OR: [
        { photoCodes: { string_contains: q } },
        ...(projectIds.length ? [{ projectId: { in: projectIds.slice(0, 40) } }] : []),
      ],
    },
    take: 100,
  });
  const folderNames = new Map<string, string[]>();
  const folderOnly: PhotoSearchHit[] = [];
  const poolCodes = new Set(poolItems.map((item) => `${item.projectId}:${item.code.toUpperCase()}`));

  for (const folder of folders) {
    for (const code of photoCodesOf(folder)) {
      const codeKey = `${folder.projectId}:${code.toUpperCase()}`;
      const names = folderNames.get(codeKey) || [];
      if (!names.includes(folder.name)) names.push(folder.name);
      folderNames.set(codeKey, names);
      if (poolCodes.has(codeKey)) continue;
      const uprn = uprnFromCode(code);
      const address = addressByKey.get(pairKey(folder.projectId, uprn)) || "";
      const fileName = fileNameForCode(code);
      if (!photoMatchesQuery(q, { uprn, address, code, fileName })) continue;
      folderOnly.push({
        id: `${folder.id}:${code}`,
        kind: "pool",
        projectName: "",
        uprn,
        address,
        title: fileName,
        location: folder.name,
        thumbUrl: placeholderThumbUrl(code),
        imageUrl: poolPhotoImagePath(folder.projectId, code),
      });
    }
  }

  if (folderOnly.length) {
    const missingProjects = [
      ...new Set(
        folders
          .filter((folder) => folderOnly.some((hit) => hit.id.startsWith(`${folder.id}:`)))
          .map((folder) => folder.projectId)
      ),
    ];
    const projects = await prisma.project.findMany({
      where: { id: { in: missingProjects } },
      select: { id: true, name: true },
    });
    const nameById = new Map(projects.map((project) => [project.id, project.name]));
    for (const hit of folderOnly) {
      const folderId = hit.id.split(":")[0];
      const folder = folders.find((item) => item.id === folderId);
      if (folder) hit.projectName = nameById.get(folder.projectId) || "";
    }
  }

  const poolHits: PhotoSearchHit[] = [];
  for (const item of poolItems) {
    const uprn = uprnFromCode(item.code);
    const address = addressByKey.get(pairKey(item.projectId, uprn)) || "";
    if (
      !photoMatchesQuery(q, {
        uprn,
        address,
        code: item.code,
        fileName: item.fileName,
      })
    ) {
      continue;
    }
    const foldersForCode = folderNames.get(`${item.projectId}:${item.code.toUpperCase()}`) || [];
    const location = foldersForCode.length ? `Photos Pool · ${foldersForCode.join(", ")}` : "Photos Pool";
    poolHits.push({
      id: item.id,
      kind: "pool",
      projectName: item.project.name,
      uprn,
      address,
      title: item.fileName || item.code,
      location,
      thumbUrl: item.spacesKey ? poolPhotoImagePath(item.projectId, item.code) : placeholderThumbUrl(item.code),
      imageUrl: poolPhotoImagePath(item.projectId, item.code),
    });
  }

  const hits = [...poolHits, ...folderOnly];
  const truncated = direct.length >= SEARCH_CANDIDATES || addressPhotos.length >= SEARCH_CANDIDATES;
  return { hits, truncated };
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";
import {
  contentTypeForPhotoExt,
  extensionOfKey,
  fileExtension,
  isProjectPoolKey,
  PHOTO_NAME_MAX,
} from "./photos.js";
import { fetchSpacesObject } from "./spaces.js";

/** Calendar months a new Excel photo-share code stays valid. */
export const PHOTO_SHARE_MONTHS = 12;
const PHOTO_SHARE_SECRET_BYTES = 32;

export type PhotoShareAssessment =
  | { ok: true; projectId: string }
  | { ok: false; status: 401 | 403; error: string };

export type SharedPhotoBytes =
  | { ok: true; body: Buffer; contentType: string; fileName: string; disposition: string }
  | { ok: false; status: 404; error: string };

export function generatePhotoShareSecret(): string {
  return randomBytes(PHOTO_SHARE_SECRET_BYTES).toString("base64url");
}

export function hashPhotoShareSecret(secret: string): string {
  return createHash("sha256").update(String(secret || ""), "utf8").digest("hex");
}

/** Reject anything that is not a freshly issued secret before it touches the database. */
export function isPhotoShareSecret(secret: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(String(secret || ""));
}

export function hashesMatch(storedHex: string, candidateHex: string): boolean {
  const left = Buffer.from(String(storedHex || ""), "utf8");
  const right = Buffer.from(String(candidateHex || ""), "utf8");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function photoShareExpiresAt(from: Date = new Date()): Date {
  const expires = new Date(from.getTime());
  expires.setUTCMonth(expires.getUTCMonth() + PHOTO_SHARE_MONTHS);
  return expires;
}

export function photoShareOrigin(protocol: string, host: string): string {
  const proto = protocol === "http" ? "http" : "https";
  return `${proto}://${String(host || "").trim()}`;
}

/** One string for Excel cell Data Horizontal DW!F1. Domain root, not the portal login path. */
export function photoShareAddress(origin: string, secret: string): string {
  const base = String(origin || "").replace(/\/+$/, "");
  return `${base}/photos/share/${secret}`;
}

export function photoShareByCodeUrl(address: string, code: string): string {
  const base = String(address || "").replace(/\/+$/, "");
  return `${base}/by-code/${encodeURIComponent(code)}`;
}

export function photoShareHelpText(address: string): string {
  const example = photoShareByCodeUrl(address, "635569-Front Door1");
  return (
    "Savills Cloud Portal — Excel photo address\n" +
    "\n" +
    "This address does not sign you in and does not open the portal.\n" +
    "\n" +
    "Paste it into Excel cell Data Horizontal DW!F1.\n" +
    "\n" +
    "Excel loads one photo from this project's Photos Pool with:\n" +
    `GET ${address}/by-code/<photo code>\n` +
    "\n" +
    "Example:\n" +
    `GET ${example}\n`
  );
}

export function assessPhotoShareToken(
  row: { projectId: string; expiresAt: Date; revokedAt: Date | null } | null,
  now: Date = new Date()
): PhotoShareAssessment {
  if (!row) return { ok: false, status: 401, error: "This photo sharing code is not valid." };
  if (row.revokedAt) return { ok: false, status: 403, error: "This photo sharing code has been revoked." };
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, status: 401, error: "This photo sharing code has expired." };
  }
  return { ok: true, projectId: row.projectId };
}

export function cleanShareCode(raw: string): string | null {
  const code = String(raw || "").trim();
  if (!code || code.length > PHOTO_NAME_MAX) return null;
  if (/[\u0000-\u001f]/.test(code)) return null;
  if (/[/\\]/.test(code) || code.includes("..")) return null;
  return code;
}

/** Exact code wins. Otherwise the first case-insensitive match. */
export function pickPoolPhotoByCode<T extends { code: string }>(photos: T[], requested: string): T | null {
  const wanted = String(requested || "").trim();
  if (!wanted) return null;
  const exact = photos.find((photo) => photo.code === wanted);
  if (exact) return exact;
  const key = wanted.toUpperCase();
  return photos.find((photo) => photo.code.toUpperCase() === key) || null;
}

export function photoContentDisposition(fileName: string): string {
  const safe = String(fileName || "photo")
    .replace(/[\r\n"]/g, "")
    .slice(0, 180);
  return `inline; filename="${safe || "photo"}"`;
}

/**
 * Bytes for one pool photo. The object key must already sit in this project's pool.
 * Missing storage is a 404 — the share code never returns a Spaces URL or credential.
 */
export async function bytesForPoolPhoto(
  projectId: string,
  photo: { code: string; fileName: string; spacesKey: string },
  getObject: (key: string) => Promise<Buffer | null>
): Promise<SharedPhotoBytes> {
  const key = String(photo.spacesKey || "");
  if (!key || !isProjectPoolKey(projectId, key)) {
    return { ok: false, status: 404, error: "Photo file is not available." };
  }
  const body = await getObject(key);
  if (!body) return { ok: false, status: 404, error: "Photo file is not available." };
  const ext = extensionOfKey(key) || fileExtension(photo.fileName);
  const fileName = photo.fileName || `${photo.code}${ext}`;
  return {
    ok: true,
    body,
    contentType: contentTypeForPhotoExt(ext),
    fileName,
    disposition: photoContentDisposition(fileName),
  };
}

export async function findPhotoShareGrant(secret: string, now: Date = new Date()): Promise<PhotoShareAssessment> {
  if (!isPhotoShareSecret(secret)) {
    return { ok: false, status: 401, error: "This photo sharing code is not valid." };
  }
  const tokenHash = hashPhotoShareSecret(secret);
  const row = await prisma.photoShareToken.findUnique({ where: { tokenHash } });
  if (row && !hashesMatch(row.tokenHash, tokenHash)) {
    return { ok: false, status: 401, error: "This photo sharing code is not valid." };
  }
  return assessPhotoShareToken(row, now);
}

export async function findPoolPhotoForShare(projectId: string, rawCode: string) {
  const code = cleanShareCode(rawCode);
  if (!code) return null;
  const exact = await prisma.photoPoolItem.findFirst({
    where: { projectId, code },
  });
  if (exact) return exact;
  const rows = await prisma.photoPoolItem.findMany({
    where: { projectId, code: { equals: code, mode: "insensitive" } },
  });
  return pickPoolPhotoByCode(rows, code);
}

export async function readSharedPoolImage(
  projectId: string,
  rawCode: string,
  getObject: (key: string) => Promise<Buffer | null> = (key) => fetchSpacesObject(key)
): Promise<SharedPhotoBytes | { ok: false; status: 404; error: string }> {
  const photo = await findPoolPhotoForShare(projectId, rawCode);
  if (!photo) return { ok: false, status: 404, error: "Photo not found." };
  return bytesForPoolPhoto(projectId, photo, getObject);
}

export type PhotoShareSummary = {
  active: boolean;
  activeCount: number;
  expiresAt?: string;
  createdAt?: string;
  label?: string;
};

export async function activePhotoShareSummary(projectId: string, now: Date = new Date()): Promise<PhotoShareSummary> {
  const where = { projectId, revokedAt: null, expiresAt: { gt: now } };
  const [activeCount, latest] = await Promise.all([
    prisma.photoShareToken.count({ where }),
    prisma.photoShareToken.findFirst({
      where,
      orderBy: { expiresAt: "desc" },
      select: { expiresAt: true, createdAt: true, label: true },
    }),
  ]);
  if (!latest || activeCount === 0) return { active: false, activeCount: 0 };
  return {
    active: true,
    activeCount,
    expiresAt: latest.expiresAt.toISOString(),
    createdAt: latest.createdAt.toISOString(),
    label: latest.label,
  };
}

export async function issuePhotoShareToken(args: {
  projectId: string;
  createdBy: string;
  label?: string;
  replaceExisting: boolean;
  now?: Date;
}): Promise<{ secret: string; id: string; expiresAt: Date; createdAt: Date; replaced: number }> {
  const now = args.now ?? new Date();
  const secret = generatePhotoShareSecret();
  const tokenHash = hashPhotoShareSecret(secret);
  const expiresAt = photoShareExpiresAt(now);
  const label = String(args.label || "").trim().slice(0, 80);
  const created = await prisma.$transaction(async (tx) => {
    let replaced = 0;
    if (args.replaceExisting) {
      const result = await tx.photoShareToken.updateMany({
        where: { projectId: args.projectId, revokedAt: null },
        data: { revokedAt: now },
      });
      replaced = result.count;
    }
    const row = await tx.photoShareToken.create({
      data: {
        projectId: args.projectId,
        tokenHash,
        expiresAt,
        createdBy: args.createdBy || "",
        label,
      },
    });
    return { row, replaced };
  });
  return {
    secret,
    id: created.row.id,
    expiresAt: created.row.expiresAt,
    createdAt: created.row.createdAt,
    replaced: created.replaced,
  };
}

export async function revokePhotoShareTokens(projectId: string, now: Date = new Date()): Promise<number> {
  const result = await prisma.photoShareToken.updateMany({
    where: { projectId, revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count;
}

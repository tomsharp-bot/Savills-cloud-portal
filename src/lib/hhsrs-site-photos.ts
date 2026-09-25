/**
 * HHSRS site-form photos.
 * The private Spaces object `hhsrs-site-form/<submissionId>/<file>` is the
 * source of truth. A file under uploads/ is only a cache and is wiped on deploy.
 * Reads try the cache, then Spaces. Uploads retry and fail the submission
 * rather than storing a path with no object behind it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import convert from "heic-convert";
import sharp from "sharp";
import { config } from "../config.js";
import { deleteSpacesObject, fetchSpacesObject, putSpacesObject } from "./spaces.js";

/** Long edge after HEIC/HEIF conversion. Same limit the phone form uses. */
export const SITE_PHOTO_MAX_EDGE = 3000;
/** JPEG quality, 0–100. Matches the form's 0.88. */
export const SITE_PHOTO_JPEG_QUALITY = 88;
/** Stored JPEG cap after conversion. Matches the form's 25 MB client limit. */
export const SITE_PHOTO_MAX_STORED_BYTES = 25 * 1024 * 1024;
export const SITE_PHOTO_PUT_ATTEMPTS = 3;

export const PHOTOS_NOT_STORED =
  "Photos could not be saved. Nothing was submitted — please try again.";
export const HEIC_CONVERT_ERROR =
  "Could not convert that HEIC photo to JPEG. Choose another photo.";
export const HEIC_TOO_BIG =
  "That photo is still over 25 MB after conversion. Choose a smaller photo.";

const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "heif",
  "mif1",
  "msf1",
]);

export class SitePhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SitePhotoError";
  }
}

/** Stand-in for the Spaces client. Production uses the private vault helpers. */
export type SitePhotoStorage = {
  put(key: string, body: Buffer, contentType: string): Promise<boolean>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<boolean>;
};

export type SitePhotoPutOptions = {
  attempts?: number;
  /** Wait between attempts. Tests pass 0. */
  delayMs?: number;
};

export type PreparedSitePhoto = {
  buffer: Buffer;
  mime: string;
  ext: string;
};

export const HHSRS_SITE_PHOTO_STORAGE = "hhsrsSitePhotoStorage";

export function defaultSitePhotoStorage(): SitePhotoStorage {
  return {
    put: (key, body, contentType) => putSpacesObject(key, body, contentType),
    get: (key) => fetchSpacesObject(key),
    remove: (key) => deleteSpacesObject(key),
  };
}

export function sitePhotoStorageFromApp(app: { get(name: string): unknown } | undefined): SitePhotoStorage {
  const custom = app?.get(HHSRS_SITE_PHOTO_STORAGE);
  if (!custom || typeof custom !== "object") return defaultSitePhotoStorage();
  const rec = custom as Partial<SitePhotoStorage>;
  if (typeof rec.put !== "function" || typeof rec.get !== "function" || typeof rec.remove !== "function") {
    return defaultSitePhotoStorage();
  }
  return rec as SitePhotoStorage;
}

export function siteFormPhotoKey(submissionId: string, storedName: string): string {
  const id = String(submissionId || "");
  const name = String(storedName || "").replace(/[/\\]/g, "");
  if (!ID_RE.test(id) || !NAME_RE.test(name) || name.includes("..")) {
    throw new SitePhotoError("Invalid photo name.");
  }
  return `hhsrs-site-form/${id}/${name}`;
}

export function isSiteFormPhotoKey(key: string): boolean {
  const parts = String(key || "").split("/");
  if (parts.length !== 3 || parts[0] !== "hhsrs-site-form") return false;
  try {
    return siteFormPhotoKey(parts[1], parts[2]) === key;
  } catch {
    return false;
  }
}

function extOf(name: string): string {
  const match = String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function nameSaysHeic(name: string, mime: string): boolean {
  const ext = extOf(name);
  const type = String(mime || "").toLowerCase();
  return ext === "heic" || ext === "heif" || type.includes("heic") || type.includes("heif");
}

/** ISO BMFF brands used by HEIC/HEIF stills (not AVIF). */
export function isHeicBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  const brand = buffer.toString("ascii", 8, 12).toLowerCase().replace(/\0/g, "");
  if (HEIC_BRANDS.has(brand)) return true;
  const boxSize = buffer.readUInt32BE(0);
  const end = Math.min(buffer.length, Math.max(boxSize, 12));
  const blob = buffer.toString("latin1", 8, end).toLowerCase();
  return /\b(heic|heix|hevc|hevx|heim|heis|heif|mif1|msf1)\b/.test(blob);
}

function sniff(buffer: Buffer): "jpeg" | "png" | "webp" | "heic" | "" {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") return "png";
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (isHeicBuffer(buffer)) return "heic";
  return "";
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keep JPEG, PNG, and WebP bytes as uploaded (the phone form already shrinks those).
 * HEIC/HEIF becomes a JPEG, long edge at most 3000px, quality 88, at most 25 MB.
 */
export async function prepareSitePhoto(input: {
  originalName: string;
  mime: string;
  buffer: Buffer;
}): Promise<PreparedSitePhoto> {
  const buffer = input.buffer;
  if (!buffer || buffer.length === 0) throw new SitePhotoError("That photo is empty.");
  const kind = sniff(buffer);
  if (kind === "jpeg") return { buffer, mime: "image/jpeg", ext: "jpg" };
  if (kind === "png") return { buffer, mime: "image/png", ext: "png" };
  if (kind === "webp") return { buffer, mime: "image/webp", ext: "webp" };
  if (kind === "heic" || nameSaysHeic(input.originalName, input.mime)) {
    const jpeg = await heicToJpeg(buffer);
    return { buffer: jpeg, mime: "image/jpeg", ext: "jpg" };
  }
  const ext = extOf(input.originalName);
  if (ext === "jpg" || ext === "jpeg") return { buffer, mime: "image/jpeg", ext: "jpg" };
  if (ext === "png") return { buffer, mime: "image/png", ext: "png" };
  if (ext === "webp") return { buffer, mime: "image/webp", ext: "webp" };
  throw new SitePhotoError("Photos must be JPEG, PNG, WebP or HEIC.");
}

async function heicToJpeg(buffer: Buffer): Promise<Buffer> {
  let decoded: Buffer;
  try {
    const converted = await convert({
      buffer,
      format: "JPEG",
      quality: SITE_PHOTO_JPEG_QUALITY / 100,
    });
    decoded = Buffer.from(converted);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`HEIC conversion failed: ${message}`);
    throw new SitePhotoError(HEIC_CONVERT_ERROR);
  }
  if (decoded.length < 3 || decoded[0] !== 0xff || decoded[1] !== 0xd8) {
    throw new SitePhotoError(HEIC_CONVERT_ERROR);
  }
  try {
    const meta = await sharp(decoded, { failOn: "none" }).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    const needsRotate = Boolean(meta.orientation && meta.orientation > 1);
    const long = Math.max(width, height);
    let out = decoded;
    if (needsRotate || long > SITE_PHOTO_MAX_EDGE) {
      let pipeline = sharp(decoded, { failOn: "none" }).rotate();
      if (long > SITE_PHOTO_MAX_EDGE) {
        pipeline = pipeline.resize({
          width: SITE_PHOTO_MAX_EDGE,
          height: SITE_PHOTO_MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      out = await pipeline.jpeg({ quality: SITE_PHOTO_JPEG_QUALITY, mozjpeg: true }).toBuffer();
    }
    if (out.length < 3 || out[0] !== 0xff || out[1] !== 0xd8) {
      throw new SitePhotoError(HEIC_CONVERT_ERROR);
    }
    if (out.length > SITE_PHOTO_MAX_STORED_BYTES) throw new SitePhotoError(HEIC_TOO_BIG);
    return out;
  } catch (err) {
    if (err instanceof SitePhotoError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`HEIC conversion failed: ${message}`);
    throw new SitePhotoError(HEIC_CONVERT_ERROR);
  }
}

export function contentTypeForStoredPhoto(fileName: string): string {
  const ext = extOf(fileName);
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return "application/octet-stream";
}

export function storedNameForPrepared(currentName: string, ext: string): string {
  const name = String(currentName || "").replace(/[/\\]/g, "");
  if (!NAME_RE.test(name) || name.includes("..")) throw new SitePhotoError("Invalid photo name.");
  if (extOf(name) === ext) return name;
  const stem = name.replace(/\.[^.]+$/, "") || name;
  const next = `${stem}.${ext}`;
  if (!NAME_RE.test(next) || next.includes("..")) throw new SitePhotoError("Invalid photo name.");
  return next;
}

export function siteFormDiskPath(key: string, uploadDir = config.uploadDir): string | null {
  const rel = String(key || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!isSiteFormPhotoKey(rel)) return null;
  const root = path.resolve(process.cwd(), uploadDir);
  const dest = path.resolve(root, rel);
  if (dest !== root && !dest.startsWith(root + path.sep)) return null;
  return dest;
}

async function readLocal(key: string): Promise<Buffer | null> {
  const dest = siteFormDiskPath(key);
  if (!dest) return null;
  try {
    const stat = await fs.stat(dest);
    if (!stat.isFile() || stat.size <= 0) return null;
    return await fs.readFile(dest);
  } catch {
    return null;
  }
}

/** Local cache first. Spaces when the file was wiped (a deploy) or was never on this container. */
export async function readSiteFormPhotoBytes(
  sourcePath: string,
  storage: SitePhotoStorage = defaultSitePhotoStorage()
): Promise<Buffer | null> {
  const key = String(sourcePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!isSiteFormPhotoKey(key)) return null;
  const local = await readLocal(key);
  if (local) return local;
  try {
    const remote = await storage.get(key);
    if (remote && remote.length > 0) return remote;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`HHSRS site-form photo read failed for ${key}: ${message}`);
  }
  return null;
}

export async function siteFormPhotoSize(
  sourcePath: string,
  storage: SitePhotoStorage = defaultSitePhotoStorage()
): Promise<number | null> {
  const key = String(sourcePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!isSiteFormPhotoKey(key)) return null;
  const dest = siteFormDiskPath(key);
  if (dest) {
    try {
      const stat = await fs.stat(dest);
      if (stat.isFile() && stat.size > 0) return stat.size;
    } catch {
      // fall through to Spaces
    }
  }
  const remote = await readSiteFormPhotoBytes(key, storage);
  return remote ? remote.length : null;
}

export type LoadedSitePhoto = {
  body: Buffer;
  contentType: string;
  fileName: string;
};

export async function loadSiteFormPhoto(
  sourcePath: string,
  storage: SitePhotoStorage = defaultSitePhotoStorage()
): Promise<LoadedSitePhoto | null> {
  const key = String(sourcePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!isSiteFormPhotoKey(key)) return null;
  const body = await readSiteFormPhotoBytes(key, storage);
  if (!body) return null;
  const fileName = key.split("/").pop() || "photo";
  return { body, contentType: contentTypeForStoredPhoto(fileName), fileName };
}

/** Headers for an admin-only photo response. No public URL and no Spaces host. */
export function privateInlineHeaders(
  fileName: string,
  byteLength: number,
  contentType: string
): Record<string, string> {
  const ascii =
    String(fileName || "photo")
      .replace(/[\r\n"]/g, "")
      .replace(/[^\x20-\x7E]/g, "_")
      .slice(0, 180) || "photo";
  return {
    "Content-Type": contentType,
    "Content-Length": String(byteLength),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, no-cache",
    "Content-Disposition": `inline; filename="${ascii}"`,
  };
}

export async function putSitePhotoWithRetry(
  storage: SitePhotoStorage,
  key: string,
  body: Buffer,
  contentType: string,
  options: SitePhotoPutOptions = {}
): Promise<void> {
  const attempts = options.attempts && options.attempts > 0 ? options.attempts : SITE_PHOTO_PUT_ATTEMPTS;
  const wait = options.delayMs === undefined ? 200 : options.delayMs;
  let reason = "upload failed";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const ok = await storage.put(key, body, contentType);
      if (ok) return;
      reason = "upload returned false";
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    console.error(`HHSRS site-form photo upload failed (${attempt}/${attempts}) for ${key}: ${reason}`);
    if (attempt < attempts) await delay(wait * attempt);
  }
  throw new SitePhotoError(PHOTOS_NOT_STORED);
}

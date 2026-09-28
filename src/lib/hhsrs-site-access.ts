import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { HHSRS_SITE_FORM_PATH } from "./hhsrs-site-form.js";
import { prisma } from "./prisma.js";

export const SITE_FORM_ACCESS_COOKIE = "hhsrs_site_access";
/** Chrome caps persistent cookies at 400 days. */
export const SITE_FORM_ACCESS_MAX_AGE_SEC = 400 * 24 * 60 * 60;
export const SITE_FORM_ACCESS_MAX_AGE_MS = SITE_FORM_ACCESS_MAX_AGE_SEC * 1000;

export const SITE_FORM_WRONG_CODE = "Wrong code. Try again.";
export const SITE_FORM_TOO_MANY = "Too many tries. Wait a few minutes.";
export const SITE_FORM_ACCESS_REQUIRED = "Access code required";
export const SITE_FORM_UNAVAILABLE = "The form is unavailable right now. Try again.";
export const SITE_FORM_CODE_INVALID = "Enter a 6-digit code.";
export const SITE_FORM_CODE_CHANGED = "Code changed.";

export const SITE_FORM_MAX_WRONG_ATTEMPTS = 10;
export const SITE_FORM_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const ROW_ID = "default";

export type SiteFormAccessRecord = {
  code: string;
  version: number;
  fingerprint: string;
  changedAt: Date;
  changedByName: string;
};

export class SiteFormAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteFormAccessError";
  }
}

type AttemptBucket = { count: number; resetAt: number };
const attemptBuckets = new Map<string, AttemptBucket>();

let memoryRecord: SiteFormAccessRecord | null = null;

export function isSixDigitCode(value: string): boolean {
  return /^[0-9]{6}$/.test(value);
}

export function randomSiteFormCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function newSiteFormFingerprint(): string {
  return randomBytes(16).toString("base64url");
}

export function formatAccessDay(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function accessChangedLine(record: Pick<SiteFormAccessRecord, "changedAt" | "changedByName">): string {
  const day = formatAccessDay(record.changedAt);
  const name = record.changedByName.trim();
  return name ? `Last changed ${day} by ${name}` : `Last changed ${day}`;
}

/** In-memory stand-in for tests. Production always reads Postgres. */
export function useMemorySiteFormAccess(seed?: { code?: string; changedByName?: string }): SiteFormAccessRecord {
  if (process.env.NODE_ENV === "production") {
    throw new Error("useMemorySiteFormAccess is for tests only");
  }
  const code = seed?.code ?? randomSiteFormCode();
  if (!isSixDigitCode(code)) throw new SiteFormAccessError(SITE_FORM_CODE_INVALID);
  memoryRecord = {
    code,
    version: 1,
    fingerprint: newSiteFormFingerprint(),
    changedAt: new Date(),
    changedByName: (seed?.changedByName || "").trim(),
  };
  return memoryRecord;
}

export function resetSiteFormAccessForTests(): void {
  memoryRecord = null;
  attemptBuckets.clear();
}

export function resetSiteFormAttemptsForTests(): void {
  attemptBuckets.clear();
}

export function siteFormAttemptLocked(ip: string, now = Date.now()): boolean {
  const key = ip.trim() || "unknown";
  const bucket = attemptBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) return false;
  return bucket.count >= SITE_FORM_MAX_WRONG_ATTEMPTS;
}

export function noteSiteFormWrongAttempt(ip: string, now = Date.now()): void {
  const key = ip.trim() || "unknown";
  const bucket = attemptBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    if (attemptBuckets.size > 5000) attemptBuckets.clear();
    attemptBuckets.set(key, { count: 1, resetAt: now + SITE_FORM_ATTEMPT_WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

export function clearSiteFormAttempts(ip: string): void {
  attemptBuckets.delete(ip.trim() || "unknown");
}

function signPayload(payload: string): string {
  const sig = createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function codesMatch(given: string, expected: string): boolean {
  return safeEqual(given, expected);
}

export function signSiteFormAccess(record: Pick<SiteFormAccessRecord, "version" | "fingerprint">): string {
  return signPayload(`${record.version}.${record.fingerprint}`);
}

export function verifySiteFormAccessToken(
  token: string
): { version: number; fingerprint: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [versionRaw, fingerprint, sig] = parts;
  if (!/^[1-9][0-9]*$/.test(versionRaw) || !fingerprint || !sig) return null;
  const payload = `${versionRaw}.${fingerprint}`;
  const expected = createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  return { version: Number(versionRaw), fingerprint };
}

export function readCookieValue(header: string | undefined, name: string): string {
  if (!header) return "";
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function siteFormAccessCookieHeader(record?: Pick<SiteFormAccessRecord, "version" | "fingerprint">): string {
  const current = record || memoryRecord;
  if (!current) throw new Error("No site-form access record to sign");
  return `${SITE_FORM_ACCESS_COOKIE}=${signSiteFormAccess(current)}`;
}

export function setSiteFormAccessCookie(
  res: Response,
  record: Pick<SiteFormAccessRecord, "version" | "fingerprint">
): void {
  res.cookie(SITE_FORM_ACCESS_COOKIE, signSiteFormAccess(record), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SITE_FORM_ACCESS_MAX_AGE_MS,
    path: HHSRS_SITE_FORM_PATH,
  });
}

export function safeSiteFormNext(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  let text = String(raw ?? "").trim();
  if (!text) return HHSRS_SITE_FORM_PATH;
  try {
    text = decodeURIComponent(text);
  } catch {
    return HHSRS_SITE_FORM_PATH;
  }
  if (!text.startsWith(`${HHSRS_SITE_FORM_PATH}/`) && text !== HHSRS_SITE_FORM_PATH) {
    return HHSRS_SITE_FORM_PATH;
  }
  if (text.includes("\\") || text.includes("\n") || text.includes("\r") || text.includes("..")) {
    return HHSRS_SITE_FORM_PATH;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return HHSRS_SITE_FORM_PATH;
  return text;
}

function toRecord(row: {
  code: string;
  version: number;
  fingerprint: string;
  changedAt: Date;
  changedByName: string;
}): SiteFormAccessRecord {
  return {
    code: row.code,
    version: row.version,
    fingerprint: row.fingerprint,
    changedAt: row.changedAt,
    changedByName: row.changedByName,
  };
}

async function ensureDbRecord(): Promise<SiteFormAccessRecord> {
  const existing = await prisma.hhsrsSiteFormAccess.findUnique({ where: { id: ROW_ID } });
  if (existing) return toRecord(existing);
  const created = await prisma.hhsrsSiteFormAccess.upsert({
    where: { id: ROW_ID },
    update: {},
    create: {
      id: ROW_ID,
      code: randomSiteFormCode(),
      version: 1,
      fingerprint: newSiteFormFingerprint(),
      changedByName: "",
    },
  });
  return toRecord(created);
}

export async function loadSiteFormAccess(): Promise<SiteFormAccessRecord> {
  if (memoryRecord) return memoryRecord;
  return ensureDbRecord();
}

export async function changeSiteFormAccessCode(code: string, changedByName: string): Promise<SiteFormAccessRecord> {
  const clean = code.trim();
  if (!isSixDigitCode(clean)) throw new SiteFormAccessError(SITE_FORM_CODE_INVALID);
  const current = await loadSiteFormAccess();
  const next: SiteFormAccessRecord = {
    code: clean,
    version: current.version + 1,
    fingerprint: newSiteFormFingerprint(),
    changedAt: new Date(),
    changedByName: changedByName.trim(),
  };
  if (memoryRecord) {
    memoryRecord = next;
    return next;
  }
  const row = await prisma.hhsrsSiteFormAccess.update({
    where: { id: ROW_ID },
    data: {
      code: next.code,
      version: next.version,
      fingerprint: next.fingerprint,
      changedAt: next.changedAt,
      changedByName: next.changedByName,
    },
  });
  return toRecord(row);
}

export async function siteFormCookieMatches(req: Request): Promise<boolean> {
  const token = readCookieValue(req.headers.cookie, SITE_FORM_ACCESS_COOKIE);
  if (!token) return false;
  const parsed = verifySiteFormAccessToken(token);
  if (!parsed) return false;
  let record: SiteFormAccessRecord;
  try {
    record = await loadSiteFormAccess();
  } catch {
    return false;
  }
  return parsed.version === record.version && safeEqual(parsed.fingerprint, record.fingerprint);
}

export function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || "unknown").trim() || "unknown";
}

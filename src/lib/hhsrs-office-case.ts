/**
 * A blank "Create new email" becomes a real case on Send and log.
 * The reference comes from the same per-project counter as site-form issues.
 * Photos use the site-form Spaces path. A failed send leaves the case in Pending.
 * A failed photo upload removes the new row.
 */
import fs from "node:fs/promises";
import type { HhsrsSiteSubmission } from "@prisma/client";
import { isHhsrsCategory, isHhsrsRating, isHhsrsSiteFormRating } from "./hhsrs-categories.js";
import { prisma } from "./prisma.js";
import { createSubmissionWithReference } from "./hhsrs-reference.js";
import { persistBufferPhotos, submissionDir, HHSRS_MAX_FILE_BYTES, HHSRS_MAX_PHOTOS, hhsrsPhotoSizeError, isAllowedImageName } from "./hhsrs-site-form.js";
import { checkSendRequest, isTickChecked, smtpPasswordSet } from "./hhsrs-send.js";
import { SitePhotoError, type SitePhotoStorage } from "./hhsrs-site-photos.js";

export type OfficePhotoFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export type OfficeCaseResult =
  | { ok: true; id: string }
  | { ok: false; error: string; id?: string; pending?: boolean };

const POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*$/i;

/** Pull a trailing UK postcode out of an address line. */
export function splitAddressPostcode(address: string): { fullAddress: string; postcode: string } {
  const trimmed = String(address || "")
    .trim()
    .replace(/\s+/g, " ");
  const match = trimmed.match(POSTCODE_RE);
  if (!match || match.index == null) return { fullAddress: trimmed, postcode: "" };
  const compact = match[1].toUpperCase().replace(/\s+/g, "");
  const postcode = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  const line = trimmed.slice(0, match.index).replace(/[,\s]+$/, "").trim();
  return { fullAddress: line || trimmed, postcode };
}

export function officePhotoError(files: { originalname: string; mimetype: string; size: number }[]): string | undefined {
  if (files.length > HHSRS_MAX_PHOTOS) return `Add up to ${HHSRS_MAX_PHOTOS} photos.`;
  for (const file of files) {
    if (file.size > HHSRS_MAX_FILE_BYTES) return hhsrsPhotoSizeError();
    if (!isAllowedImageName(file.originalname, file.mimetype)) {
      return "Photos must be JPEG, PNG, WebP or HEIC.";
    }
  }
  return undefined;
}

function text(body: Record<string, unknown>, key: string, max: number): string {
  return String(body[key] ?? "")
    .trim()
    .slice(0, max);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function discardNewCase(id: string, storage: SitePhotoStorage | undefined, keys: string[]): Promise<void> {
  if (storage && keys.length) {
    await Promise.all(keys.map((key) => storage.remove(key).catch(() => false)));
  }
  await prisma.hhsrsSiteSubmission.delete({ where: { id } }).catch(() => undefined);
  await fs.rm(submissionDir(id), { recursive: true, force: true }).catch(() => undefined);
}

export async function createOfficeCaseAndSend(args: {
  body: Record<string, unknown>;
  files: OfficePhotoFile[];
  createdBy: string;
  hasReporterAccess: boolean;
  storage?: SitePhotoStorage;
  send: (
    row: HhsrsSiteSubmission,
    sendBody: Record<string, unknown>
  ) => Promise<{ ok: true; warning?: string } | { ok: false; error: string }>;
}): Promise<OfficeCaseResult> {
  const projectName = text(args.body, "project", 200);
  const address = text(args.body, "address", 500);
  const uprn = text(args.body, "uprn", 40);
  const hazard = text(args.body, "hazard", 200);
  const rating = text(args.body, "rating", 80);
  const notes = text(args.body, "notes", 4000);
  if (!projectName) return { ok: false, error: "Choose a project." };
  if (!address) return { ok: false, error: "Add an address." };
  if (!uprn) return { ok: false, error: "Add a UPRN." };
  if (!hazard) return { ok: false, error: "Add a hazard." };
  if (!isHhsrsCategory(hazard)) return { ok: false, error: "Choose a hazard from the list." };
  if (!rating) return { ok: false, error: "Add a rating." };
  if (!isHhsrsRating(rating) && !isHhsrsSiteFormRating(rating)) {
    return { ok: false, error: "Choose a rating from the list." };
  }

  const photoError = officePhotoError(args.files);
  if (photoError) return { ok: false, error: photoError };

  const totalBytes = args.files.reduce((sum, file) => sum + (file.size || file.buffer.length || 0), 0);
  const gate = checkSendRequest({
    hasReporterAccess: args.hasReporterAccess,
    passwordSet: smtpPasswordSet(),
    alreadySent: false,
    checked: isTickChecked(args.body.checked),
    to: String(args.body.to ?? ""),
    cc: String(args.body.cc ?? ""),
    bcc: String(args.body.bcc ?? ""),
    allowDomainsRaw: process.env.HHSRS_SEND_ALLOW_DOMAINS,
    totalBytes,
  });
  if (!gate.ok) return gate;

  const project = await prisma.project.findFirst({
    where: { name: { equals: projectName, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!project) return { ok: false, error: "Choose a project." };

  const split = splitAddressPostcode(address);
  const surveyor = text(args.body, "surveyor", 200) || args.createdBy;
  const postedDate = text(args.body, "surveyDate", 20);
  const surveyDate = /^\d{4}-\d{2}-\d{2}$/.test(postedDate) ? postedDate : todayIso();
  const subject = text(args.body, "subject", 300);
  const emailBody = String(args.body.body ?? "").replace(/\s+$/, "").slice(0, 20000);

  let createdId = "";
  let storedKeys: string[] = [];
  try {
    const created = await createSubmissionWithReference({ projectId: project.id, projectName: project.name }, (tx, reference) =>
      tx.hhsrsSiteSubmission.create({
        data: {
          projectId: project.id,
          projectName: project.name,
          surveyDate,
          uprn,
          fullAddress: split.fullAddress,
          postcode: split.postcode,
          surveyorName: surveyor,
          category: hazard,
          rating,
          comment: notes,
          clientDescription: notes,
          photoPaths: [],
          reference,
          source: "office",
          createdBy: args.createdBy,
          status: "new",
          emailSubject: subject,
          emailBody,
          lastEditedBy: args.createdBy,
        },
      })
    );
    createdId = created.id;
    storedKeys = await persistBufferPhotos(created.id, args.files, args.storage);
    if (storedKeys.length) {
      await prisma.hhsrsSiteSubmission.update({
        where: { id: created.id },
        data: { photoPaths: storedKeys },
      });
    }
  } catch (err) {
    if (createdId) await discardNewCase(createdId, args.storage, storedKeys);
    const message = err instanceof SitePhotoError ? err.message : "Could not save the case. Nothing was kept.";
    return { ok: false, error: message };
  }

  const fresh = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: createdId } });
  if (!fresh) return { ok: false, error: "Could not save the case. Nothing was kept." };
  const names = storedKeys.map((key) => key.split("/").filter(Boolean).pop() || "").filter(Boolean);
  const sendBody: Record<string, unknown> = {
    ...args.body,
    photo: names,
  };
  try {
    const sent = await args.send(fresh, sendBody);
    if (!sent.ok) return { ok: false, error: sent.error, id: fresh.id, pending: true };
  } catch {
    return { ok: false, error: "Not sent.", id: fresh.id, pending: true };
  }
  return { ok: true, id: fresh.id };
}

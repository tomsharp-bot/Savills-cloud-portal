/**
 * Loads a case's site-form photos and sends one email inside a row lock.
 * Person-initiated only. Called from the Review send route.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { HhsrsSiteSubmission } from "@prisma/client";
import { prisma } from "./prisma.js";
import { photoNames } from "./hhsrs-reporter.js";
import { safeId, safeStoredName, submissionDir } from "./hhsrs-site-form.js";
import {
  PortalSendError,
  checkAttachments,
  deliverPortalEmail,
  isTickChecked,
  smtpPasswordSet,
  type SendCommit,
  type SentEmailRecord,
} from "./hhsrs-send.js";
import { appendToSentFolder, sendMailboxMessage } from "./hhsrs-send-transport.js";

export function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return "image/jpeg";
}

export function casePhotoFileNames(photoPaths: unknown): string[] {
  const names: string[] = [];
  for (const stored of photoNames({ photoPaths } as Pick<HhsrsSiteSubmission, "photoPaths">)) {
    const base = stored.split("/").filter(Boolean).pop() || "";
    if (base && !names.includes(base)) names.push(base);
  }
  return names;
}

export function postedValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value == null || value === "") return [];
  return [String(value)];
}

function photoAbsPath(submissionId: string, filename: string): string | null {
  try {
    const id = safeId(submissionId);
    const stored = safeStoredName(filename);
    const dir = path.resolve(submissionDir(id));
    const dest = path.resolve(dir, stored);
    if (!dest.startsWith(dir + path.sep)) return null;
    return dest;
  } catch {
    return null;
  }
}

export async function photoByteSize(submissionId: string, filename: string): Promise<number | null> {
  const dest = photoAbsPath(submissionId, filename);
  if (!dest) return null;
  try {
    const stat = await fs.stat(dest);
    if (!stat.isFile()) return null;
    return stat.size;
  } catch {
    return null;
  }
}

async function readPhoto(submissionId: string, filename: string): Promise<Buffer | null> {
  const dest = photoAbsPath(submissionId, filename);
  if (!dest) return null;
  try {
    return await fs.readFile(dest);
  } catch {
    return null;
  }
}

function toRecord(row: {
  id: string;
  submissionId: string;
  sentAt: Date;
  sentBy: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  photoNames: unknown;
  messageId: string;
  sentCopySaved: boolean;
  sentCopyError: string;
}): SentEmailRecord {
  const photoNames = Array.isArray(row.photoNames) ? row.photoNames.map(String) : [];
  return {
    id: row.id,
    submissionId: row.submissionId,
    sentAt: row.sentAt,
    sentBy: row.sentBy,
    from: row.from,
    to: row.to,
    cc: row.cc,
    bcc: row.bcc,
    subject: row.subject,
    body: row.body,
    photoNames,
    messageId: row.messageId,
    sentCopySaved: row.sentCopySaved,
    sentCopyError: row.sentCopyError,
  };
}

export async function latestSentEmail(submissionId: string): Promise<SentEmailRecord | null> {
  const row = await prisma.hhsrsSentEmail.findFirst({
    where: { submissionId },
    orderBy: { sentAt: "desc" },
  });
  return row ? toRecord(row) : null;
}

export async function sendCaseEmail(args: {
  row: HhsrsSiteSubmission;
  sentBy: string;
  hasReporterAccess: boolean;
  body: Record<string, unknown>;
}): Promise<{ ok: true; warning: string } | { ok: false; error: string }> {
  const known = casePhotoFileNames(args.row.photoPaths);
  const requested = postedValues(args.body.photo);
  const sizes = new Map<string, number | null>();
  for (const name of known) {
    sizes.set(name, await photoByteSize(args.row.id, name));
  }
  const picked = checkAttachments(known, requested, (name) => sizes.get(name) ?? null);
  if (!picked.ok) return picked;

  const attachments = [];
  for (const name of picked.names) {
    const content = await readPhoto(args.row.id, name);
    if (!content) return { ok: false, error: "A photo is missing. Not sent." };
    attachments.push({ filename: name, content, contentType: contentTypeFor(name) });
  }

  const submissionId = args.row.id;
  return deliverPortalEmail(
    {
      submissionId,
      sentBy: args.sentBy,
      hasReporterAccess: args.hasReporterAccess,
      passwordSet: smtpPasswordSet(),
      alreadySent: Boolean(args.row.emailSentAt),
      checked: isTickChecked(args.body.checked),
      to: String(args.body.to ?? ""),
      cc: String(args.body.cc ?? ""),
      bcc: String(args.body.bcc ?? ""),
      subject: String(args.body.subject ?? ""),
      body: String(args.body.body ?? ""),
      photoNames: picked.names,
      attachments,
      allowDomainsRaw: process.env.HHSRS_SEND_ALLOW_DOMAINS,
      totalBytes: picked.totalBytes,
    },
    {
      sendMail: sendMailboxMessage,
      appendToSent: appendToSentFolder,
      exclusive: async (run) => {
        try {
          return await prisma.$transaction(
            async (tx) => {
              const locked = await tx.$queryRaw<Array<{ emailSentAt: Date | null }>>`
                SELECT "emailSentAt" FROM "HhsrsSiteSubmission" WHERE "id" = ${submissionId} FOR UPDATE
              `;
              if (!locked.length) throw new PortalSendError("Case not found.");
              if (locked[0].emailSentAt) throw new PortalSendError("Already sent. Can't be sent again.");
              const commit: SendCommit = await run();
              const updated = await tx.hhsrsSiteSubmission.updateMany({
                where: { id: submissionId, emailSentAt: null },
                data: {
                  status: "email_sent",
                  emailSentAt: commit.sentAt,
                  emailSentBy: commit.sentBy,
                  emailSubject: commit.subject,
                  emailBody: commit.body,
                  lastEditedBy: commit.sentBy,
                  claimedBy: "",
                  claimedAt: null,
                },
              });
              if (updated.count !== 1) throw new PortalSendError("Already sent. Can't be sent again.");
              const created = await tx.hhsrsSentEmail.create({
                data: {
                  submissionId,
                  sentAt: commit.sentAt,
                  sentBy: commit.sentBy,
                  from: commit.from,
                  to: commit.to,
                  cc: commit.cc,
                  bcc: commit.bcc,
                  subject: commit.subject,
                  body: commit.body,
                  photoNames: commit.photoNames,
                  messageId: commit.messageId,
                  sentCopySaved: commit.sentCopySaved,
                  sentCopyError: commit.sentCopyError,
                },
              });
              return toRecord(created);
            },
            { maxWait: 15_000, timeout: 60_000 }
          );
        } catch (err) {
          if (err instanceof PortalSendError) throw err;
          throw err;
        }
      },
    }
  );
}

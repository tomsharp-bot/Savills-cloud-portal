/**
 * Loads a case's site-form photos and sends one email inside a row lock.
 * Person-initiated only. Called from the Review send route.
 *
 * The sent-email row and the case update are one SQL statement. Postgres
 * cannot keep the email without moving the case out of Pending.
 */
import { randomUUID } from "node:crypto";
import { Prisma, type HhsrsSiteSubmission, type Prisma as PrismaTypes } from "@prisma/client";
import { closeOpenSubmissionFromEarliestEmail } from "./hhsrs-close-sent.js";
import { prisma } from "./prisma.js";
import { isActionedStatus, photoNames } from "./hhsrs-reporter.js";
import {
  readSiteFormPhotoBytes,
  siteFormPhotoKey,
  siteFormPhotoSize,
  type SitePhotoStorage,
} from "./hhsrs-site-photos.js";
import {
  PortalSendError,
  checkAttachments,
  deliverPortalEmail,
  isTickChecked,
  smtpPasswordSet,
  type OutboundAttachment,
  type OutboundEmail,
  type SendCommit,
  type SentEmailRecord,
} from "./hhsrs-send.js";
import { appendToSentFolder, sendMailboxMessage } from "./hhsrs-send-transport.js";
import {
  amendmentListError,
  buildAmendmentEmail,
  parseSentEmail,
  prepareCorrectionEmail,
  readAmendmentFields,
} from "./hhsrs-correction-email.js";
import { correctionSubject, validateCorrection } from "./hhsrs-find.js";
import { prepareClientEmailBody } from "./hhsrs-reporter-draft.js";

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

function photoKey(submissionId: string, filename: string): string | null {
  try {
    return siteFormPhotoKey(submissionId, filename);
  } catch {
    return null;
  }
}

export async function photoByteSize(
  submissionId: string,
  filename: string,
  storage?: SitePhotoStorage
): Promise<number | null> {
  const key = photoKey(submissionId, filename);
  if (!key) return null;
  return siteFormPhotoSize(key, storage);
}

/** Bytes for one case photo. Local cache first, then the private Spaces object. */
export async function readCasePhoto(
  submissionId: string,
  filename: string,
  storage?: SitePhotoStorage
): Promise<Buffer | null> {
  const key = photoKey(submissionId, filename);
  if (!key) return null;
  return readSiteFormPhotoBytes(key, storage);
}

export async function buildCasePhotoAttachments(
  submissionId: string,
  names: readonly string[],
  storage?: SitePhotoStorage
): Promise<{ ok: true; attachments: OutboundAttachment[] } | { ok: false; error: string }> {
  const attachments: OutboundAttachment[] = [];
  for (const name of names) {
    const content = await readCasePhoto(submissionId, name, storage);
    if (!content) return { ok: false, error: "A photo is missing. Not sent." };
    attachments.push({ filename: name, content, contentType: contentTypeFor(name) });
  }
  return { ok: true, attachments };
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
  kind?: string;
  correctionReason?: string;
  correctionNote?: string;
  correctsEmailId?: string | null;
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
    kind: row.kind || "original",
    correctionReason: row.correctionReason || "",
    correctionNote: row.correctionNote || "",
    correctsEmailId: row.correctsEmailId || null,
  };
}

export async function listSentEmails(submissionId: string): Promise<SentEmailRecord[]> {
  const rows = await prisma.hhsrsSentEmail.findMany({
    where: { submissionId },
    orderBy: { sentAt: "asc" },
  });
  return rows.map(toRecord);
}

export async function latestSentEmail(submissionId: string): Promise<SentEmailRecord | null> {
  const row = await prisma.hhsrsSentEmail.findFirst({
    where: { submissionId },
    orderBy: { sentAt: "desc" },
  });
  return row ? toRecord(row) : null;
}

/** The first portal send. A correction does not replace this row. */
export async function originalSentEmail(submissionId: string): Promise<SentEmailRecord | null> {
  const rows = await listSentEmails(submissionId);
  return rows.find((row) => row.kind !== "correction") || rows[0] || null;
}

export type CaseEmailTransport = {
  sendMail: (mail: OutboundEmail) => Promise<{ messageId: string; raw: Buffer }>;
  appendToSent: (raw: Buffer) => Promise<void>;
};

type Tx = PrismaTypes.TransactionClient;

const SENT_EMAIL_RETURNING = Prisma.sql`
  RETURNING
    "id", "submissionId", "sentAt", "sentBy", "from", "to", "cc", "bcc",
    "subject", "body", "photoNames", "messageId", "sentCopySaved", "sentCopyError",
    "kind", "correctionReason", "correctionNote", "correctsEmailId"
`;

async function earliestSentEmail(tx: Tx, submissionId: string) {
  return tx.hhsrsSentEmail.findFirst({
    where: { submissionId },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Insert the original send only when the case update matches.
 * One statement, so a saved email cannot leave the case in Pending.
 */
async function insertOriginalAndClose(tx: Tx, submissionId: string, commit: SendCommit): Promise<SentEmailRecord> {
  const id = randomUUID();
  const rows = await tx.$queryRaw<Array<Parameters<typeof toRecord>[0]>>`
    WITH updated AS (
      UPDATE "HhsrsSiteSubmission"
      SET
        "status" = 'email_sent',
        "emailSentAt" = ${commit.sentAt},
        "emailSentBy" = ${commit.sentBy},
        "emailSubject" = ${commit.subject},
        "emailBody" = ${commit.body},
        "lastEditedBy" = ${commit.sentBy},
        "claimedBy" = '',
        "claimedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${submissionId}
        AND "emailSentAt" IS NULL
        AND "status" IS DISTINCT FROM 'not_needed'
      RETURNING "id"
    )
    INSERT INTO "HhsrsSentEmail" (
      "id", "submissionId", "sentAt", "sentBy", "from", "to", "cc", "bcc",
      "subject", "body", "photoNames", "messageId", "sentCopySaved", "sentCopyError",
      "kind", "correctionReason", "correctionNote", "correctsEmailId"
    )
    SELECT
      ${id},
      ${submissionId},
      ${commit.sentAt},
      ${commit.sentBy},
      ${commit.from},
      ${commit.to},
      ${commit.cc},
      ${commit.bcc},
      ${commit.subject},
      ${commit.body},
      CAST(${JSON.stringify(commit.photoNames)} AS jsonb),
      ${commit.messageId},
      ${commit.sentCopySaved},
      ${commit.sentCopyError},
      'original',
      '',
      '',
      NULL
    FROM updated
    ${SENT_EMAIL_RETURNING}
  `;
  const created = rows[0];
  if (!created) throw new PortalSendError("Already sent. Can't be sent again.");
  return toRecord(created);
}

/** Insert a correction and mark the case corrected in the same statement. */
async function insertCorrectionAndClose(
  tx: Tx,
  submissionId: string,
  commit: SendCommit,
  anchor: { id: string; sentAt: Date; sentBy: string; subject: string; body: string },
  correction: { reason: string; note: string }
): Promise<SentEmailRecord> {
  const id = randomUUID();
  const rows = await tx.$queryRaw<Array<Parameters<typeof toRecord>[0]>>`
    WITH updated AS (
      UPDATE "HhsrsSiteSubmission"
      SET
        "status" = 'corrected',
        "emailSentAt" = COALESCE("emailSentAt", ${anchor.sentAt}),
        "emailSentBy" = CASE WHEN btrim("emailSentBy") <> '' THEN "emailSentBy" ELSE ${anchor.sentBy} END,
        "emailSubject" = CASE WHEN btrim("emailSubject") <> '' THEN "emailSubject" ELSE ${anchor.subject} END,
        "emailBody" = CASE WHEN btrim("emailBody") <> '' THEN "emailBody" ELSE ${anchor.body} END,
        "lastEditedBy" = ${commit.sentBy},
        "claimedBy" = '',
        "claimedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${submissionId}
      RETURNING "id"
    )
    INSERT INTO "HhsrsSentEmail" (
      "id", "submissionId", "sentAt", "sentBy", "from", "to", "cc", "bcc",
      "subject", "body", "photoNames", "messageId", "sentCopySaved", "sentCopyError",
      "kind", "correctionReason", "correctionNote", "correctsEmailId"
    )
    SELECT
      ${id},
      ${submissionId},
      ${commit.sentAt},
      ${commit.sentBy},
      ${commit.from},
      ${commit.to},
      ${commit.cc},
      ${commit.bcc},
      ${commit.subject},
      ${commit.body},
      CAST(${JSON.stringify(commit.photoNames)} AS jsonb),
      ${commit.messageId},
      ${commit.sentCopySaved},
      ${commit.sentCopyError},
      'correction',
      ${correction.reason.trim()},
      ${correction.note.trim()},
      ${anchor.id}
    FROM updated
    ${SENT_EMAIL_RETURNING}
  `;
  const created = rows[0];
  if (!created) throw new PortalSendError("Case not found.");
  return toRecord(created);
}

export async function sendCaseEmail(args: {
  row: HhsrsSiteSubmission;
  sentBy: string;
  hasReporterAccess: boolean;
  /** Signature name. The portal send appends it. Empty when no name is on file. */
  senderFirstName?: string;
  senderFullName?: string;
  body: Record<string, unknown>;
  storage?: SitePhotoStorage;
  /** Set for Amend & resend. Uses the same portal send; does not rewrite the original. */
  correction?: { reason: string; note: string };
  transport?: CaseEmailTransport;
}): Promise<{ ok: true; warning: string } | { ok: false; error: string }> {
  const correction = args.correction;
  if (!correction && args.row.status === "not_needed") {
    return {
      ok: false,
      error: "This case is in Duplicates & Errors. Move it back to Pending before sending.",
    };
  }
  const to = String(args.body.to ?? "");
  let correctionReason = "";
  let correctionNote = "";
  const amendmentPost = Boolean(correction) && String(args.body.amendmentFields || "") === "1";
  const previousEmail = correction ? await latestSentEmail(args.row.id) : null;
  let amendmentMail: ReturnType<typeof buildAmendmentEmail> | null = null;
  if (amendmentPost) {
    if (!previousEmail) return { ok: false, error: "Not sent yet." };
    const previousFields = parseSentEmail(previousEmail.body).fields;
    const nextFields = readAmendmentFields(args.body);
    const listError = amendmentListError(previousFields, nextFields);
    if (listError) return { ok: false, error: listError };
    amendmentMail = buildAmendmentEmail({
      previousBody: previousEmail.body,
      previousSubject: previousEmail.subject,
      next: nextFields,
      amendment: String(args.body.amendment || ""),
    });
    const checked = validateCorrection({ reason: amendmentMail.reason, note: amendmentMail.note, to });
    if (!checked.ok) return checked;
    correctionReason = checked.reason;
    correctionNote = checked.note;
  } else if (correction) {
    const checked = validateCorrection({ reason: correction.reason, note: correction.note, to });
    if (!checked.ok) return checked;
    correctionReason = checked.reason;
    correctionNote = checked.note;
  }

  const known = casePhotoFileNames(args.row.photoPaths);
  const postedPhotos = postedValues(args.body.photo);
  const explicitPhotos = String(args.body.photoSelection || "") === "1";
  if (amendmentPost && explicitPhotos && !isTickChecked(args.body.photosChecked)) {
    return { ok: false, error: "Tick the box to confirm the photo is correct." };
  }
  const requested =
    amendmentPost && !postedPhotos.length && previousEmail && !explicitPhotos
      ? previousEmail.photoNames
      : postedPhotos;
  const sizes = new Map<string, number | null>();
  for (const name of known) {
    sizes.set(name, await photoByteSize(args.row.id, name, args.storage));
  }
  const picked = checkAttachments(known, requested, (name) => sizes.get(name) ?? null);
  if (!picked.ok) return picked;

  const built = await buildCasePhotoAttachments(args.row.id, picked.names, args.storage);
  if (!built.ok) return built;
  const attachments = built.attachments;

  const submissionId = args.row.id;
  let subject = correction ? correctionSubject(String(args.body.subject ?? "")) : String(args.body.subject ?? "");
  let body = prepareClientEmailBody(args.row.projectName, String(args.body.body ?? ""));
  let messageHtml: string | undefined;
  if (amendmentMail) {
    subject = amendmentMail.subject;
    body = amendmentMail.text;
    messageHtml = amendmentMail.messageHtml;
  } else if (correction) {
    const prepared = prepareCorrectionEmail({
      previousBody: previousEmail?.body ?? "",
      nextBody: body,
      previousTo: previousEmail?.to ?? "",
      nextTo: to,
      previousPhotos: previousEmail?.photoNames ?? [],
      nextPhotos: picked.names,
      reason: correctionReason,
      note: correctionNote,
    });
    body = prepared.text;
    messageHtml = prepared.messageHtml;
  }
  const transport = args.transport || { sendMail: sendMailboxMessage, appendToSent: appendToSentFolder };
  return deliverPortalEmail(
    {
      submissionId,
      sentBy: args.sentBy,
      hasReporterAccess: args.hasReporterAccess,
      passwordSet: smtpPasswordSet(),
      alreadySent: correction ? false : Boolean(args.row.emailSentAt),
      checked: isTickChecked(args.body.checked),
      to,
      cc: String(args.body.cc ?? ""),
      bcc: String(args.body.bcc ?? ""),
      subject,
      body,
      messageHtml,
      senderFirstName: args.senderFirstName,
      senderFullName: args.senderFullName,
      photoNames: picked.names,
      attachments,
      allowDomainsRaw: process.env.HHSRS_SEND_ALLOW_DOMAINS,
      totalBytes: picked.totalBytes,
    },
    {
      sendMail: transport.sendMail,
      appendToSent: transport.appendToSent,
      exclusive: async (run) => {
        const record = await prisma.$transaction(
          async (tx) => {
            const locked = await tx.$queryRaw<Array<{ emailSentAt: Date | null; status: string }>>`
              SELECT "emailSentAt", "status" FROM "HhsrsSiteSubmission" WHERE "id" = ${submissionId} FOR UPDATE
            `;
            if (!locked.length) throw new PortalSendError("Case not found.");
            if (!correction && locked[0].status === "not_needed") {
              throw new PortalSendError(
                "This case is in Duplicates & Errors. Move it back to Pending before sending."
              );
            }
            if (correction) {
              const anchor = await earliestSentEmail(tx, submissionId);
              if (!anchor) throw new PortalSendError("Not sent yet.");
              const commit: SendCommit = await run();
              return insertCorrectionAndClose(tx, submissionId, commit, anchor, {
                reason: correctionReason,
                note: correctionNote,
              });
            }
            if (locked[0].emailSentAt) throw new PortalSendError("Already sent. Can't be sent again.");
            const existing = await earliestSentEmail(tx, submissionId);
            if (existing) {
              await closeOpenSubmissionFromEarliestEmail(tx, submissionId);
              return toRecord(existing);
            }
            const commit: SendCommit = await run();
            return insertOriginalAndClose(tx, submissionId, commit);
          },
          { maxWait: 15_000, timeout: 60_000 }
        );
        const fresh = await prisma.hhsrsSiteSubmission.findUnique({
          where: { id: submissionId },
          select: { status: true, emailSentAt: true },
        });
        if (fresh && (!fresh.emailSentAt || !isActionedStatus(fresh.status))) {
          await closeOpenSubmissionFromEarliestEmail(prisma, submissionId);
        }
        return record;
      },
    }
  );
}

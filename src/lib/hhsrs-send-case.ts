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
import { claimHeldMessage, otherClaimer } from "./hhsrs-claims.js";
import { isWaitingStatus, photoNames } from "./hhsrs-reporter.js";
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
async function insertOriginalAndClose(
  tx: Tx,
  submissionId: string,
  commit: SendCommit,
  lease: string
): Promise<SentEmailRecord> {
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
        "sendLease" = '',
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${submissionId}
        AND "emailSentAt" IS NULL
        AND "sendLease" = ${lease}
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

const SEND_IN_PROGRESS = "A send is already in progress for this case.";
const SEND_LOG_FAILED = "The email went out, but the Main Log did not save. Open the case again to record it.";
const SEND_LEASE_PAD = 16;

/** True while this send still owns the case. An expired lease can be taken over. */
export function sendLeaseActive(value: string | null | undefined, now = Date.now()): boolean {
  const stamp = String(value || "").split(":")[0];
  if (!/^[0-9]+$/.test(stamp)) return false;
  return Number(stamp) > now;
}

function newSendLease(now = Date.now()): string {
  return `${String(now + 2 * 60 * 1000).padStart(SEND_LEASE_PAD, "0")}:${randomUUID()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LockedSendRow = { emailSentAt: Date | null; status: string; claimedBy: string; sendLease: string };

async function lockSendRow(tx: Tx, submissionId: string): Promise<LockedSendRow | null> {
  const rows = await tx.$queryRaw<LockedSendRow[]>`
    SELECT "emailSentAt", "status", "claimedBy", "sendLease"
    FROM "HhsrsSiteSubmission"
    WHERE "id" = ${submissionId}
    FOR UPDATE
  `;
  return rows[0] || null;
}

async function clearSendLease(submissionId: string, lease: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "HhsrsSiteSubmission"
    SET "sendLease" = ''
    WHERE "id" = ${submissionId} AND "sendLease" = ${lease}
  `;
}

/** The mailbox send already happened. Write the Main Log row and take the case off Pending. */
async function writeOriginalLog(submissionId: string, commit: SendCommit, lease: string): Promise<SentEmailRecord | null> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const locked = await lockSendRow(tx, submissionId);
        if (!locked) return null;
        const existing = await earliestSentEmail(tx, submissionId);
        if (existing) {
          await closeOpenSubmissionFromEarliestEmail(tx, submissionId);
          await tx.$executeRaw`
            UPDATE "HhsrsSiteSubmission"
            SET "sendLease" = ''
            WHERE "id" = ${submissionId} AND "sendLease" = ${lease}
          `;
          return toRecord(existing);
        }
        return insertOriginalAndClose(tx, submissionId, commit, lease);
      },
      { maxWait: 15_000, timeout: 20_000 }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`HHSRS send log retry failed for ${submissionId}: ${detail}`);
    return null;
  }
}

type ReservedSend =
  | { kind: "go" }
  | { kind: "already"; record: SentEmailRecord }
  | { kind: "busy" }
  | { kind: "blocked"; error: string }
  | { kind: "missing" };

/** Commit the claim and the send lease before any email leaves the building. */
async function reserveOriginalSend(submissionId: string, actor: string, lease: string): Promise<ReservedSend> {
  return prisma.$transaction(
    async (tx) => {
      const locked = await lockSendRow(tx, submissionId);
      if (!locked) return { kind: "missing" };
      if (locked.status === "not_needed") {
        return {
          kind: "blocked",
          error: "This case is in Duplicates & Errors. Move it back to Pending before sending.",
        };
      }
      const existing = await earliestSentEmail(tx, submissionId);
      if (locked.emailSentAt || existing) {
        if (existing) {
          await closeOpenSubmissionFromEarliestEmail(tx, submissionId);
          return { kind: "already", record: toRecord(existing) };
        }
        return { kind: "blocked", error: "Already sent. Can't be sent again." };
      }
      if (!isWaitingStatus(locked.status)) return { kind: "blocked", error: "Already sent. Can't be sent again." };
      const owner = otherClaimer(locked.claimedBy, actor);
      if (owner) return { kind: "blocked", error: claimHeldMessage(owner) };
      if (!actor) return { kind: "blocked", error: "Sign in again before sending this case." };
      if (sendLeaseActive(locked.sendLease) && locked.sendLease !== lease) return { kind: "busy" };
      const nowText = String(Date.now()).padStart(SEND_LEASE_PAD, "0");
      const updated = await tx.$executeRaw`
        UPDATE "HhsrsSiteSubmission"
        SET
          "claimedBy" = ${actor},
          "claimedAt" = COALESCE("claimedAt", CURRENT_TIMESTAMP),
          "sendLease" = ${lease},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${submissionId}
          AND "emailSentAt" IS NULL
          AND "status" IN ('new', 'in_review', 'email_ready')
          AND btrim(${actor}) <> ''
          AND (
            btrim("claimedBy") = ''
            OR lower(btrim("claimedBy")) = lower(${actor})
          )
          AND CASE
            WHEN "sendLease" = '' THEN TRUE
            WHEN "sendLease" = ${lease} THEN TRUE
            WHEN split_part("sendLease", ':', 1) ~ '^[0-9]+$'
              THEN split_part("sendLease", ':', 1) <= ${nowText}
            ELSE TRUE
          END
      `;
      if (Number(updated) !== 1) return { kind: "busy" };
      return { kind: "go" };
    },
    { maxWait: 15_000, timeout: 20_000 }
  );
}

/**
 * One original send. The lease is committed before the mailbox send, so a second
 * person cannot send. The Main Log row is written after the mailbox accepts it,
 * in its own transaction, so a rolled-back mailbox transaction cannot drop the log.
 */
async function finishOriginalSend(
  submissionId: string,
  actor: string,
  run: () => Promise<SendCommit>
): Promise<SentEmailRecord> {
  const deadline = Date.now() + 60_000;
  const lease = newSendLease();
  while (Date.now() < deadline) {
    const reserved = await reserveOriginalSend(submissionId, actor, lease);
    if (reserved.kind === "already") return reserved.record;
    if (reserved.kind === "blocked") throw new PortalSendError(reserved.error);
    if (reserved.kind === "missing") throw new PortalSendError("Case not found.");
    if (reserved.kind === "busy") {
      await sleep(150);
      const logged = await prisma.hhsrsSentEmail.findFirst({
        where: { submissionId },
        orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      });
      if (logged) {
        await closeOpenSubmissionFromEarliestEmail(prisma, submissionId);
        return toRecord(logged);
      }
      continue;
    }
    let mailed: SendCommit | null = null;
    try {
      mailed = await run();
      let saved: SentEmailRecord | null = null;
      for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
        saved = await writeOriginalLog(submissionId, mailed, lease);
        if (!saved) await sleep(200);
      }
      if (!saved) throw new PortalSendError(SEND_LOG_FAILED);
      return saved;
    } catch (err) {
      if (!mailed) {
        await clearSendLease(submissionId, lease).catch(() => undefined);
        throw err;
      }
      const saved = await writeOriginalLog(submissionId, mailed, lease);
      if (saved) return saved;
      throw err instanceof PortalSendError ? err : new PortalSendError(SEND_LOG_FAILED);
    }
  }
  throw new PortalSendError(SEND_IN_PROGRESS);
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
  /** Name stored on the claim. Send is refused when a different person holds it. */
  actor?: string;
}): Promise<{ ok: true; warning: string } | { ok: false; error: string }> {
  const correction = args.correction;
  if (!correction && args.row.status === "dismissed") {
    return { ok: false, error: "This hazard was dismissed. No email is sent." };
  }
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
    const listError = amendmentListError(previousFields, nextFields, args.row.projectName);
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
    const withPhotos = buildAmendmentEmail({
      previousBody: previousEmail?.body ?? "",
      previousSubject: previousEmail?.subject ?? "",
      next: amendmentMail.next,
      amendment: String(args.body.amendment || ""),
      previousPhotos: previousEmail?.photoNames ?? [],
      nextPhotos: picked.names,
    });
    subject = withPhotos.subject;
    body = withPhotos.text;
    messageHtml = withPhotos.messageHtml;
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
        if (!correction) {
          const actor = String(args.actor || args.sentBy || "").trim();
          return finishOriginalSend(submissionId, actor, run);
        }
        return prisma.$transaction(
          async (tx) => {
            const locked = await lockSendRow(tx, submissionId);
            if (!locked) throw new PortalSendError("Case not found.");
            if (sendLeaseActive(locked.sendLease)) throw new PortalSendError(SEND_IN_PROGRESS);
            const anchor = await earliestSentEmail(tx, submissionId);
            if (!anchor) throw new PortalSendError("Not sent yet.");
            const commit: SendCommit = await run();
            return insertCorrectionAndClose(tx, submissionId, commit, anchor, {
              reason: correctionReason,
              note: correctionNote,
            });
          },
          { maxWait: 15_000, timeout: 60_000 }
        );
      },
    }
  );
}

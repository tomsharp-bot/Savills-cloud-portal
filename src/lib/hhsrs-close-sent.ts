/**
 * A portal send is done only when the case row itself is closed.
 * Pending is status new, in_review, or email_ready.
 * Main Log and the completed counts read email_sent, corrected, and closed.
 *
 * Live sends have written HhsrsSentEmail and left the case on status "new"
 * with the email fields empty. This closes those cases from the earliest send.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export const CLOSE_OPEN_SENT_SUBMISSIONS_SQL = `
UPDATE "HhsrsSiteSubmission" AS s
SET
  "status" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "HhsrsSentEmail" c
      WHERE c."submissionId" = s."id" AND c."kind" = 'correction'
    ) THEN 'corrected'
    ELSE 'email_sent'
  END,
  "emailSentAt" = e."sentAt",
  "emailSentBy" = e."sentBy",
  "emailSubject" = e."subject",
  "emailBody" = e."body",
  "lastEditedBy" = CASE WHEN btrim(s."lastEditedBy") <> '' THEN s."lastEditedBy" ELSE e."sentBy" END,
  "claimedBy" = '',
  "claimedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON ("submissionId")
    "submissionId",
    "sentAt",
    "sentBy",
    "subject",
    "body"
  FROM "HhsrsSentEmail"
  ORDER BY "submissionId", "sentAt" ASC, "id" ASC
) AS e
WHERE s."id" = e."submissionId"
  AND s."status" NOT IN ('email_sent', 'corrected', 'closed')
`.trim();

type SqlClient = Prisma.TransactionClient | typeof prisma;

/** Close every case that has a sent email but is still not on the Main Log. */
export async function closeSubmissionsLeftOpenAfterSend(db: SqlClient = prisma): Promise<number> {
  return db.$executeRawUnsafe(CLOSE_OPEN_SENT_SUBMISSIONS_SQL);
}

/** Close one case from its earliest sent email. No-op when it is already done. */
export async function closeOpenSubmissionFromEarliestEmail(
  db: SqlClient,
  submissionId: string
): Promise<number> {
  return db.$executeRaw`
    UPDATE "HhsrsSiteSubmission" AS s
    SET
      "status" = CASE
        WHEN EXISTS (
          SELECT 1 FROM "HhsrsSentEmail" c
          WHERE c."submissionId" = s."id" AND c."kind" = 'correction'
        ) THEN 'corrected'
        ELSE 'email_sent'
      END,
      "emailSentAt" = e."sentAt",
      "emailSentBy" = e."sentBy",
      "emailSubject" = e."subject",
      "emailBody" = e."body",
      "lastEditedBy" = CASE WHEN btrim(s."lastEditedBy") <> '' THEN s."lastEditedBy" ELSE e."sentBy" END,
      "claimedBy" = '',
      "claimedAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    FROM (
      SELECT "submissionId", "sentAt", "sentBy", "subject", "body"
      FROM "HhsrsSentEmail"
      WHERE "submissionId" = ${submissionId}
      ORDER BY "sentAt" ASC, "id" ASC
      LIMIT 1
    ) AS e
    WHERE s."id" = e."submissionId"
      AND s."id" = ${submissionId}
      AND s."status" NOT IN ('email_sent', 'corrected', 'closed')
  `;
}

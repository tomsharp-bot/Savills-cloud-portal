-- A portal send left some cases in Pending: HhsrsSentEmail was saved,
-- but the case stayed status "new" with the email fields empty.
-- Close those from the earliest sent email so they leave Pending
-- and show on the Main Log. Cases already sent, corrected, or closed
-- are left as they are. Nothing is deleted.

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
  AND s."status" NOT IN ('email_sent', 'corrected', 'closed');

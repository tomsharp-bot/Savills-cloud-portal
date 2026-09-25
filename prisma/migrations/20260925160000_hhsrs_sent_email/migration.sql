-- Portal send history. One row per person-initiated send from the HHSRS mailbox.
CREATE TABLE "HhsrsSentEmail" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "cc" TEXT NOT NULL DEFAULT '',
    "bcc" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "photoNames" JSONB NOT NULL,
    "messageId" TEXT NOT NULL DEFAULT '',
    "sentCopySaved" BOOLEAN NOT NULL DEFAULT false,
    "sentCopyError" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "HhsrsSentEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HhsrsSentEmail_submissionId_idx" ON "HhsrsSentEmail"("submissionId");
CREATE INDEX "HhsrsSentEmail_sentAt_idx" ON "HhsrsSentEmail"("sentAt");

ALTER TABLE "HhsrsSentEmail" ADD CONSTRAINT "HhsrsSentEmail_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "HhsrsSiteSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

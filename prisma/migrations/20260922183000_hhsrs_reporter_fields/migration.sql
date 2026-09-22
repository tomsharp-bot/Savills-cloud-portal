-- HHSRS Reporter office-review fields on site submissions.
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "clientDescription" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "callOutcome" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "workOrder" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "suspectedCause" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "includeCause" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "vulnerabilities" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "escalation" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "onwardTopic" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "cat1Confirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "internalNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "emailSubject" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "emailBody" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "emailSentAt" TIMESTAMP(3);
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "emailSentBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "lastEditedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "HhsrsSiteSubmission_status_idx" ON "HhsrsSiteSubmission"("status");

-- Duplicates & errors, and office-created cases from Review and create.
-- Nothing is deleted: a case moves to status not_needed and can move back.
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'site';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "notNeededReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "notNeededDuplicateOf" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "notNeededNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "notNeededBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "notNeededAt" TIMESTAMP(3);
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "notNeededLog" JSONB NOT NULL DEFAULT '[]';

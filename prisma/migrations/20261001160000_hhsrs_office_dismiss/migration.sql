ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "surveyorCheck" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "dismissedDecision" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "dismissedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "dismissedAt" TIMESTAMP(3);

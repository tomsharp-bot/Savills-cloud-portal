-- Office claim on a waiting HHSRS case. Stale is derived from claimedAt in the app.
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "claimedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "claimedAt" TIMESTAMP(3);

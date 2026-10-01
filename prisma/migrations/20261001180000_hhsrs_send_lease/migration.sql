-- Stops a second person sending a case while the first send is still being logged.
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN IF NOT EXISTS "sendLease" TEXT NOT NULL DEFAULT '';

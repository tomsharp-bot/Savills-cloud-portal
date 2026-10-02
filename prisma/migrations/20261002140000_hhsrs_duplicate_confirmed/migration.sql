-- Office confirmed this comparison is a duplicate.
-- The pair leaves Duplicates & errors. The newer case stays on Pending marked Dupe.
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "duplicateConfirmed" BOOLEAN NOT NULL DEFAULT false;

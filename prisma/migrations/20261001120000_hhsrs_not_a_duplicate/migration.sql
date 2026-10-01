-- Remember when the office says a case is not a duplicate.
-- Automatic UPRN filing must not put that case back on Duplicates & errors.
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "notADuplicate" BOOLEAN NOT NULL DEFAULT false;

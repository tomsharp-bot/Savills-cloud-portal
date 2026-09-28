-- Flag site-form addresses that were typed because the project had no stock list.
-- Existing rows stay blank, which means a stock lookup.
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "addressSource" TEXT NOT NULL DEFAULT '';

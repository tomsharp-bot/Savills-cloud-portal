-- EPC Req. on dwellings. Existing "… EPC" survey types start ticked
-- so completed rows keep an EPC survey type instead of flipping to SCS only.
ALTER TABLE "Asset" ADD COLUMN "epcRequired" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Asset"
SET "epcRequired" = true
WHERE "kind" = 'dwelling'
  AND "surveyType" ~* 'epc';

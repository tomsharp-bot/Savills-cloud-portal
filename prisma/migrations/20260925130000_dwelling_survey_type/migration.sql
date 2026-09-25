-- Dwellings take Survey Type from Asset Status and EPC Req, on every project.
-- Ext-Only (and the older External Only label) becomes External.
-- Full Survey with EPC Req ticked becomes SCS + EPC.
-- Full Survey with EPC Req not ticked becomes SCS Only.
-- Every other status becomes blank.
-- One set-based update, so a large stock such as MTVH is corrected on deploy.
-- Blocks and garages are left as they are.
UPDATE "Asset"
SET "surveyType" = CASE
  WHEN btrim(COALESCE("assetStatus", '')) IN ('Ext-Only', 'External Only') THEN 'External'
  WHEN btrim(COALESCE("assetStatus", '')) IN ('Full Survey', 'Full Surveys')
    OR lower(btrim(COALESCE("assetStatus", ''))) IN ('completed', 'complete')
  THEN CASE WHEN "epcRequired" THEN 'SCS + EPC' ELSE 'SCS Only' END
  ELSE ''
END
WHERE "kind" = 'dwelling';

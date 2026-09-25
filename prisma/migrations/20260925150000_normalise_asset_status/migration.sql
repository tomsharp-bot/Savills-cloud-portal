-- Fold stored Asset Status onto the seven grid labels, then refresh dwelling Survey Type.
-- Case, extra spaces, hyphens, underscores, periods, and apostrophes are ignored.
-- MTVH labels stored today:
--   Completed, Complete, Survey Complete(d), Full Survey Completed → Full Survey
--   Access Attempted → No Access
--   No Visit Recorded → No Visit
--   Resident refused access → Access Refused
-- Ext Only and External become Ext-Only. Anything unrecognised is left as stored.
-- One set-based update, so a stock the size of MTVH (~44k dwellings) is corrected on deploy.
-- Blocks and garages keep their Survey Type. Their status is still folded.
-- The same folds are in assetStatusKey / ASSET_STATUS_SYNONYMS.

WITH keyed AS (
  SELECT
    id,
    lower(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(btrim(COALESCE("assetStatus", '')), '\.', '', 'g'),
              '''',
              '',
              'g'
            ),
            '[-_]+',
            ' ',
            'g'
          ),
          '[[:space:]]+',
          ' ',
          'g'
        )
      )
    ) AS status_key
  FROM "Asset"
),
mapped AS (
  SELECT
    id,
    CASE
      WHEN status_key = 'no visit' THEN 'No Visit'
      WHEN status_key = 'no visits' THEN 'No Visit'
      WHEN status_key = 'not visited' THEN 'No Visit'
      WHEN status_key = 'no visit recorded' THEN 'No Visit'
      WHEN status_key = 'no access' THEN 'No Access'
      WHEN status_key = 'no answer' THEN 'No Access'
      WHEN status_key = 'none' THEN 'No Access'
      WHEN status_key = 'access attempted' THEN 'No Access'
      WHEN status_key = 'appt made not kept' THEN 'Appt Made Not Kept'
      WHEN status_key = 'appointment made not kept' THEN 'Appt Made Not Kept'
      WHEN status_key = 'appointment not kept' THEN 'Appt Made Not Kept'
      WHEN status_key = 'appt not kept' THEN 'Appt Made Not Kept'
      WHEN status_key = 'failed appointment' THEN 'Appt Made Not Kept'
      WHEN status_key = 'failed appt' THEN 'Appt Made Not Kept'
      WHEN status_key = 'access refused' THEN 'Access Refused'
      WHEN status_key = 'refused access' THEN 'Access Refused'
      WHEN status_key = 'resident refused access' THEN 'Access Refused'
      WHEN status_key = 'not convenient' THEN 'Access Refused'
      WHEN status_key = 'refused' THEN 'Access Refused'
      WHEN status_key = 'void' THEN 'Void'
      WHEN status_key = 'void property' THEN 'Void'
      WHEN status_key = 'full survey' THEN 'Full Survey'
      WHEN status_key = 'full surveys' THEN 'Full Survey'
      WHEN status_key = 'full survey completed' THEN 'Full Survey'
      WHEN status_key = 'full survey complete' THEN 'Full Survey'
      WHEN status_key = 'full surveys completed' THEN 'Full Survey'
      WHEN status_key = 'full surveys complete' THEN 'Full Survey'
      WHEN status_key = 'survey complete' THEN 'Full Survey'
      WHEN status_key = 'survey completed' THEN 'Full Survey'
      WHEN status_key = 'completed' THEN 'Full Survey'
      WHEN status_key = 'complete' THEN 'Full Survey'
      WHEN status_key = 'successful' THEN 'Full Survey'
      WHEN status_key = 'success' THEN 'Full Survey'
      WHEN status_key = 'ext only' THEN 'Ext-Only'
      WHEN status_key = 'external only' THEN 'Ext-Only'
      WHEN status_key = 'external' THEN 'Ext-Only'
      WHEN status_key = 'ext survey' THEN 'Ext-Only'
      WHEN status_key = 'external survey' THEN 'Ext-Only'
      WHEN status_key LIKE 'failed appt%' OR position('failed appointment' IN status_key) > 0 THEN 'Appt Made Not Kept'
      WHEN status_key LIKE 'successful%' THEN 'Full Survey'
      ELSE NULL
    END AS label
  FROM keyed
)
UPDATE "Asset" AS a
SET "assetStatus" = mapped.label
FROM mapped
WHERE a.id = mapped.id
  AND mapped.label IS NOT NULL
  AND a."assetStatus" IS DISTINCT FROM mapped.label;

-- Dwelling Survey Type follows the status just stored. Ext-Only is External.
-- Full Survey is SCS + EPC when EPC Req is ticked, otherwise SCS Only.
UPDATE "Asset"
SET "surveyType" = CASE
  WHEN btrim("assetStatus") = 'Ext-Only' THEN 'External'
  WHEN btrim("assetStatus") = 'Full Survey' THEN
    CASE WHEN "epcRequired" THEN 'SCS + EPC' ELSE 'SCS Only' END
  ELSE ''
END
WHERE "kind" = 'dwelling';

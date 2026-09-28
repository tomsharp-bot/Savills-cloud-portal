-- HHSRS issue references: project code + running number (MTVH-014).
-- The counter stays in step with existing rows (nextNumber is one past the highest used).
-- Go-live data wipe: after HHSRS submissions are deleted, restart numbering with
--   npx tsx scripts/reset-hhsrs-reference-counters.ts
-- or: UPDATE "HhsrsReferenceCounter" SET "nextNumber" = 1;
-- Leaving this table untouched after a wipe continues the old numbers instead of restarting at 001.

ALTER TABLE "Project" ADD COLUMN "hhsrsCode" TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION hhsrs_code_from_name(raw text) RETURNS text AS $$
DECLARE
  n text := lower(btrim(coalesce(raw, '')));
  letters text;
BEGIN
  IF n ~ 'saxon' THEN RETURN 'SAXW'; END IF;
  IF n ~ 'test[[:space:]]*housing' THEN RETURN 'TEST'; END IF;
  IF n ~ 'cornwall' THEN RETURN 'CORN'; END IF;
  IF n ~ 'onward' THEN RETURN 'ONW'; END IF;
  IF n ~ 'vico' THEN RETURN 'VICO'; END IF;
  IF n ~ 'bpha' THEN RETURN 'BPHA'; END IF;
  IF n ~ 'metropolitan' OR n ~ 'mtvh' THEN RETURN 'MTVH'; END IF;
  IF n ~ '(a2d|a2[[:space:]]*dominion)' THEN RETURN 'A2D'; END IF;
  letters := upper(substr(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9]', '', 'g'), 1, 4));
  IF letters IS NULL OR letters = '' THEN RETURN 'HHSR'; END IF;
  RETURN letters;
END;
$$ LANGUAGE plpgsql;

UPDATE "Project" SET "hhsrsCode" = hhsrs_code_from_name(name) WHERE "hhsrsCode" = '';

ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "reference" TEXT;

ALTER TABLE "HhsrsSentEmail" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'original';
ALTER TABLE "HhsrsSentEmail" ADD COLUMN "correctionReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSentEmail" ADD COLUMN "correctionNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HhsrsSentEmail" ADD COLUMN "correctsEmailId" TEXT;

CREATE TABLE "HhsrsReferenceCounter" (
    "key" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "HhsrsReferenceCounter_pkey" PRIMARY KEY ("key")
);

-- Number existing submissions in created order within each project.
-- If two projects share a code, a number that is already used is skipped.
DO $$
DECLARE
  rec RECORD;
  n integer;
  code text;
  ref text;
  pkey text;
BEGIN
  FOR rec IN
    SELECT s.id,
           s."projectId",
           s."projectName",
           COALESCE(NULLIF(p."hhsrsCode", ''), hhsrs_code_from_name(s."projectName")) AS code
    FROM "HhsrsSiteSubmission" s
    LEFT JOIN "Project" p ON p.id = s."projectId"
    ORDER BY s."projectId" NULLS LAST, lower(s."projectName"), s."createdAt", s.id
  LOOP
    code := rec.code;
    IF rec."projectId" IS NOT NULL AND rec."projectId" <> '' THEN
      pkey := rec."projectId";
    ELSE
      pkey := 'name:' || lower(btrim(coalesce(rec."projectName", '')));
    END IF;
    SELECT "nextNumber" INTO n FROM "HhsrsReferenceCounter" WHERE "key" = pkey;
    IF n IS NULL THEN
      n := 1;
    END IF;
    LOOP
      ref := code || '-' || lpad(n::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "HhsrsSiteSubmission" WHERE "reference" = ref);
      n := n + 1;
    END LOOP;
    UPDATE "HhsrsSiteSubmission" SET "reference" = ref WHERE id = rec.id;
    INSERT INTO "HhsrsReferenceCounter" ("key", "nextNumber")
    VALUES (pkey, n + 1)
    ON CONFLICT ("key") DO UPDATE SET "nextNumber" = EXCLUDED."nextNumber";
  END LOOP;
END $$;

CREATE UNIQUE INDEX "HhsrsSiteSubmission_reference_key" ON "HhsrsSiteSubmission"("reference");

CREATE INDEX "HhsrsSentEmail_correctsEmailId_idx" ON "HhsrsSentEmail"("correctsEmailId");

ALTER TABLE "HhsrsSentEmail"
  ADD CONSTRAINT "HhsrsSentEmail_correctsEmailId_fkey"
  FOREIGN KEY ("correctsEmailId") REFERENCES "HhsrsSentEmail"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP FUNCTION hhsrs_code_from_name(text);

-- Moment Project.stage becomes archive. The HHSRS site form uses this for its 2-week window.
-- There was no stored archive time. updatedAt is the closest moment already on the row
-- (the archive board orders "most recently archived" by it). Copy it once, then leave it.
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "Project"
SET "archivedAt" = "updatedAt"
WHERE "stage" = 'archive';

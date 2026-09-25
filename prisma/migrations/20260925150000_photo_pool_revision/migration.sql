-- Cache-bust Photos Pool images after an in-place replace (GDPR blur).
-- The 7-day pool view filters on createdAt for one project.

ALTER TABLE "PhotoPoolItem" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "PhotoPoolItem_projectId_createdAt_idx" ON "PhotoPoolItem"("projectId", "createdAt");

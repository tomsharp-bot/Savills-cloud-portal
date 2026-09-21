-- Sample Analysis: per-project schedule dates and per-patch area name / surveyor initials.
ALTER TABLE "Project" ADD COLUMN "sampleStartDate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "sampleTargetEndDate" TEXT NOT NULL DEFAULT '';

CREATE TABLE "PatchSample" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "areaName" TEXT NOT NULL DEFAULT '',
    "surveyorInitials" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatchSample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatchSample_projectId_patch_key" ON "PatchSample"("projectId", "patch");
CREATE INDEX "PatchSample_projectId_idx" ON "PatchSample"("projectId");

ALTER TABLE "PatchSample" ADD CONSTRAINT "PatchSample_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

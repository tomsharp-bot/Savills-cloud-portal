-- Index of HHSRS photos copied into Spaces when a case is logged to the Main Log.
-- Originals stay on app disk. A failed copy is recorded on HhsrsPhotoCopy and can be retried.

CREATE TABLE "HhsrsCompletedPhoto" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "projectId" TEXT,
    "projectName" TEXT NOT NULL,
    "uprn" TEXT NOT NULL,
    "fullAddress" TEXT NOT NULL DEFAULT '',
    "postcode" TEXT NOT NULL DEFAULT '',
    "addressLine" TEXT NOT NULL DEFAULT '',
    "shortAddress" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "spacesKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT '',
    "copiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HhsrsCompletedPhoto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HhsrsPhotoCopy" (
    "submissionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT NOT NULL DEFAULT '',
    "copiedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HhsrsPhotoCopy_pkey" PRIMARY KEY ("submissionId")
);

CREATE UNIQUE INDEX "HhsrsCompletedPhoto_submissionId_sourcePath_key" ON "HhsrsCompletedPhoto"("submissionId", "sourcePath");
CREATE INDEX "HhsrsCompletedPhoto_projectName_uprn_idx" ON "HhsrsCompletedPhoto"("projectName", "uprn");
CREATE INDEX "HhsrsCompletedPhoto_projectName_idx" ON "HhsrsCompletedPhoto"("projectName");
CREATE INDEX "HhsrsCompletedPhoto_uprn_idx" ON "HhsrsCompletedPhoto"("uprn");

ALTER TABLE "HhsrsCompletedPhoto" ADD CONSTRAINT "HhsrsCompletedPhoto_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "HhsrsSiteSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HhsrsPhotoCopy" ADD CONSTRAINT "HhsrsPhotoCopy_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "HhsrsSiteSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

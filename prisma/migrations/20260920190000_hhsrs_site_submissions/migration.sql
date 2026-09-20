-- CreateTable
CREATE TABLE "HhsrsSiteSubmission" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "projectName" TEXT NOT NULL,
    "surveyDate" TEXT NOT NULL,
    "uprn" TEXT NOT NULL,
    "fullAddress" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "surveyorName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "clientCallReference" TEXT NOT NULL DEFAULT '',
    "otherDetails" TEXT NOT NULL DEFAULT '',
    "photoPaths" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HhsrsSiteSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HhsrsSiteSubmission_createdAt_idx" ON "HhsrsSiteSubmission"("createdAt");

-- CreateIndex
CREATE INDEX "HhsrsSiteSubmission_projectId_idx" ON "HhsrsSiteSubmission"("projectId");

-- AddForeignKey
ALTER TABLE "HhsrsSiteSubmission" ADD CONSTRAINT "HhsrsSiteSubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Live and archived Master Data Files for Data Checks. One current file per project.

CREATE TABLE "MasterDataFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storedName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterDataFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MasterDataFile_projectId_idx" ON "MasterDataFile"("projectId");
CREATE INDEX "MasterDataFile_current_archivedAt_idx" ON "MasterDataFile"("current", "archivedAt");

ALTER TABLE "MasterDataFile" ADD CONSTRAINT "MasterDataFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

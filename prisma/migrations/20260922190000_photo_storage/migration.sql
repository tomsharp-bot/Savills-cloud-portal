-- Photo Storage: pool items, folders / zips, client-access activity

CREATE TABLE "PhotoPoolItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "spacesKey" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoPoolItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PhotoFolder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'folder',
    "sizeLabel" TEXT NOT NULL DEFAULT '',
    "clientAccess" BOOLEAN NOT NULL DEFAULT false,
    "photoCodes" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PhotoFolderActivity" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "who" TEXT NOT NULL,
    "downloaded" BOOLEAN NOT NULL DEFAULT false,
    "downloadedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PhotoFolderActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhotoPoolItem_projectId_code_key" ON "PhotoPoolItem"("projectId", "code");
CREATE INDEX "PhotoPoolItem_projectId_idx" ON "PhotoPoolItem"("projectId");
CREATE INDEX "PhotoFolder_projectId_idx" ON "PhotoFolder"("projectId");
CREATE INDEX "PhotoFolder_projectId_clientAccess_idx" ON "PhotoFolder"("projectId", "clientAccess");
CREATE INDEX "PhotoFolderActivity_folderId_idx" ON "PhotoFolderActivity"("folderId");

ALTER TABLE "PhotoPoolItem" ADD CONSTRAINT "PhotoPoolItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoFolder" ADD CONSTRAINT "PhotoFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhotoFolderActivity" ADD CONSTRAINT "PhotoFolderActivity_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "PhotoFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

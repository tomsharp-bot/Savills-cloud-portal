-- CreateTable
CREATE TABLE "ReferenceDocument" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spacesKey" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ReferenceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferenceDocument_category_idx" ON "ReferenceDocument"("category");

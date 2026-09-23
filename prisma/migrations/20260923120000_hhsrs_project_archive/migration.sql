-- HHSRS Reporter project overview archive flags (archive / restore).
CREATE TABLE "HhsrsReporterProjectArchive" (
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT true,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HhsrsReporterProjectArchive_pkey" PRIMARY KEY ("name")
);

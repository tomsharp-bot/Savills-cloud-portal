-- Excel photo-share tokens. Store a hash of the secret, not the secret itself.

CREATE TABLE "PhotoShareToken" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "label" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PhotoShareToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhotoShareToken_tokenHash_key" ON "PhotoShareToken"("tokenHash");
CREATE INDEX "PhotoShareToken_projectId_idx" ON "PhotoShareToken"("projectId");

ALTER TABLE "PhotoShareToken" ADD CONSTRAINT "PhotoShareToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Shared HHSRS site-form access code. One row (id = 'default'), created on first use.
-- The code is plaintext so admins can read it. Cookies store version + fingerprint only.
CREATE TABLE "HhsrsSiteFormAccess" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByName" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "HhsrsSiteFormAccess_pkey" PRIMARY KEY ("id")
);

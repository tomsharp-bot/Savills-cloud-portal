-- Office-edited To / Cc / Bcc for HHSRS Reporter projects.
-- Seed only the address already hard-coded for Test Housing. No other client addresses.

CREATE TABLE "HhsrsClientEmail" (
    "projectName" TEXT NOT NULL,
    "toAddresses" TEXT NOT NULL DEFAULT '',
    "ccAddresses" TEXT NOT NULL DEFAULT '',
    "bccAddresses" TEXT NOT NULL DEFAULT '',
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByName" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "HhsrsClientEmail_pkey" PRIMARY KEY ("projectName")
);

INSERT INTO "HhsrsClientEmail" ("projectName", "toAddresses", "ccAddresses", "bccAddresses", "changedByName")
VALUES ('Test Housing', 'cfarrell@savillshousing.co.uk', '', '', '');

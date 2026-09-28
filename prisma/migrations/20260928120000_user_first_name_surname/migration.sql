-- First name and surname on the login account, for the HHSRS email signature.
-- Existing display names in "name" are left as they are.
ALTER TABLE "User" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "surname" TEXT NOT NULL DEFAULT '';

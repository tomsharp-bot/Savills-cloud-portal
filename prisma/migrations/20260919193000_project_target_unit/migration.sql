-- CreateEnum
CREATE TYPE "ProjectTargetUnit" AS ENUM ('count', 'percent');

-- AlterTable
ALTER TABLE "Project" RENAME COLUMN "projectTargetPercent" TO "projectTargetValue";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "projectTargetUnit" "ProjectTargetUnit" NOT NULL DEFAULT 'percent';

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'surveyor', 'client');

-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('current', 'upcoming', 'archive');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('dwelling', 'block', 'garage');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "initials" TEXT,
    "agency" TEXT,
    "company" TEXT,
    "clientRole" TEXT,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "lastTempPassword" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectManager" TEXT NOT NULL,
    "stage" "ProjectStage" NOT NULL DEFAULT 'upcoming',
    "typeConditionOnly" BOOLEAN NOT NULL DEFAULT true,
    "typeConditionEpc" BOOLEAN NOT NULL DEFAULT false,
    "typeBlocks" BOOLEAN NOT NULL DEFAULT true,
    "typeGarages" BOOLEAN NOT NULL DEFAULT true,
    "typeCommercial" BOOLEAN NOT NULL DEFAULT false,
    "typeOther" BOOLEAN NOT NULL DEFAULT false,
    "typeValidations" BOOLEAN NOT NULL DEFAULT false,
    "projectTargetPercent" INTEGER NOT NULL DEFAULT 75,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAccess" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "ProjectAccess_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "uprn" TEXT NOT NULL,
    "assetStatus" TEXT NOT NULL DEFAULT 'No Visit',
    "surveyDate" TEXT NOT NULL DEFAULT '',
    "surveyedBy" TEXT NOT NULL DEFAULT '',
    "visit1" TEXT NOT NULL DEFAULT '',
    "visit2" TEXT NOT NULL DEFAULT '',
    "visit3" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "block" TEXT NOT NULL DEFAULT '',
    "street" TEXT NOT NULL DEFAULT '',
    "area" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "postcode" TEXT NOT NULL DEFAULT '',
    "archetype" TEXT NOT NULL DEFAULT '',
    "yearBuilt" TEXT NOT NULL DEFAULT '',
    "patch" TEXT NOT NULL DEFAULT '',
    "surveyor" TEXT NOT NULL DEFAULT '',
    "surveyType" TEXT NOT NULL DEFAULT '',
    "siteComments" TEXT NOT NULL DEFAULT '',
    "external" TEXT NOT NULL DEFAULT '',
    "omitAsset" BOOLEAN NOT NULL DEFAULT false,
    "stockMissing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "uprn" TEXT NOT NULL,
    "combinedAddress" TEXT NOT NULL DEFAULT '',
    "visitType" TEXT NOT NULL DEFAULT '',
    "dataSource" TEXT NOT NULL DEFAULT '',
    "surveyDate" TEXT NOT NULL DEFAULT '',
    "nextSurvey" TEXT NOT NULL DEFAULT '',
    "accessType" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdOn" TEXT NOT NULL DEFAULT '',
    "surveyDesign" TEXT NOT NULL DEFAULT '',
    "visitDate" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "block" TEXT NOT NULL DEFAULT '',
    "addressLine1" TEXT NOT NULL DEFAULT '',
    "addressLine5" TEXT NOT NULL DEFAULT '',
    "postcode" TEXT NOT NULL DEFAULT '',
    "archetype" TEXT NOT NULL DEFAULT '',
    "loadedFrom" TEXT NOT NULL DEFAULT '',
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoaderHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "when" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "result" TEXT NOT NULL,

    CONSTRAINT "LoaderHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Completion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Ready',

    CONSTRAINT "Completion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE INDEX "Asset_projectId_kind_idx" ON "Asset"("projectId", "kind");

-- CreateIndex
CREATE INDEX "Asset_projectId_uprn_idx" ON "Asset"("projectId", "uprn");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_projectId_kind_uprn_key" ON "Asset"("projectId", "kind", "uprn");

-- CreateIndex
CREATE INDEX "VisitLog_projectId_uprn_idx" ON "VisitLog"("projectId", "uprn");

-- AddForeignKey
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoaderHistory" ADD CONSTRAINT "LoaderHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Completion" ADD CONSTRAINT "Completion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


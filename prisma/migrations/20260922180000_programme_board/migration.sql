-- Projects Programme: shared board JSON and per-project survey-type edits.
CREATE TABLE "ProgrammeBoard" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ProgrammeBoard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgrammeSurveyNote" (
    "projectId" TEXT NOT NULL,
    "surveyTypes" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgrammeSurveyNote_pkey" PRIMARY KEY ("projectId")
);

ALTER TABLE "ProgrammeSurveyNote" ADD CONSTRAINT "ProgrammeSurveyNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

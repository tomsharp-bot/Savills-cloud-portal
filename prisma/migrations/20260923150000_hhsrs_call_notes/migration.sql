-- Surveyor "couldn't get through" notes, shown as Call notes in Reporter Review.
ALTER TABLE "HhsrsSiteSubmission" ADD COLUMN "callNotes" TEXT NOT NULL DEFAULT '';

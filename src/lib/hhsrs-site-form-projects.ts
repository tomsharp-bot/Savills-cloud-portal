import type { Prisma } from "@prisma/client";

/** Archived projects stay on the HHSRS site form for this long after stage becomes archive. */
export const SITE_FORM_ARCHIVE_WINDOW_DAYS = 14;
export const SITE_FORM_ARCHIVE_WINDOW_MS = SITE_FORM_ARCHIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** First moment that is no longer inside the 2-week window. */
export function siteFormArchiveCutoff(now = new Date()): Date {
  return new Date(now.getTime() - SITE_FORM_ARCHIVE_WINDOW_MS);
}

/**
 * Current projects, plus archive projects whose stage changed to archive
 * less than 14 days ago. A project archived exactly 14 days ago has dropped off.
 * Upcoming projects are not included.
 */
export function siteFormProjectWhere(now = new Date()): Prisma.ProjectWhereInput {
  return {
    OR: [
      { stage: "current" },
      { stage: "archive", archivedAt: { gt: siteFormArchiveCutoff(now) } },
    ],
  };
}

/**
 * archivedAt to write when stage changes.
 * undefined means the project is already archived, so leave the original moment alone.
 * null clears it when the project leaves archive.
 */
export function archivedAtForStageChange(
  previousStage: string,
  nextStage: string,
  now = new Date()
): Date | null | undefined {
  if (nextStage === "archive" && previousStage !== "archive") return now;
  if (nextStage !== "archive") return null;
  return undefined;
}

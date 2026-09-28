/**
 * The surveyor site form and the Reporter share one project list:
 * current rows in the portal Project table, by Project.name.
 */
import { prisma } from "./prisma.js";
import { portalProjectMatchNames } from "./hhsrs-reporter-projects.js";

/** Same names the site form dropdown offers, A to Z. */
export async function loadPortalProjectNames(): Promise<string[]> {
  const rows = await prisma.project.findMany({
    where: { stage: "current" },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => row.name.trim()).filter(Boolean);
}

/** Names stored on submissions that resolve to the portal project the office picked. */
export async function storedNamesForPortalProject(portalName: string): Promise<string[]> {
  const rows = await prisma.hhsrsSiteSubmission.findMany({
    distinct: ["projectName"],
    select: { projectName: true },
  });
  return portalProjectMatchNames(
    portalName,
    rows.map((row) => row.projectName)
  );
}

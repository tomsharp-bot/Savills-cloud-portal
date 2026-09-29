/**
 * Reporter project names come from current rows in the portal Project table.
 * The public site form uses the same current projects, and also keeps a project
 * for 14 days after it is archived (see siteFormProjectWhere).
 */
import { prisma } from "./prisma.js";
import { portalProjectMatchNames } from "./hhsrs-reporter-projects.js";

/** Current portal project names, A to Z. The site form adds the 2-week archive window. */
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

import type { Role } from "@prisma/client";

/**
 * Where a signed-in user goes after login, and where the portal home sends them.
 * Admins land on the section hub. Surveyors land on a two-tile home
 * (Project Progress and Reference Documents). Clients keep Project Progress.
 */
export function postLoginPath(role: Role | null | undefined): string {
  if (role === "admin") return "/admin";
  if (role === "surveyor") return "/surveyor";
  return "/projects";
}

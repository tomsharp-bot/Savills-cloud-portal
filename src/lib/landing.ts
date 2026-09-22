import type { Role } from "@prisma/client";

/**
 * Where a signed-in user goes after login, and where the portal home sends them.
 * Admins land on the section hub. Surveyors go straight to Project Progress.
 * Clients keep the existing Project Progress landing (Completions only).
 */
export function postLoginPath(role: Role | null | undefined): string {
  if (role === "admin") return "/admin";
  return "/projects";
}

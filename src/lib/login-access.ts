import type { Role } from "@prisma/client";

export const NO_SITE_ACCESS_ERROR =
  "Error: You do not currently have access to this site, please contact the Project Management Team.";

/** Admins always pass. Client / surveyor need at least one Personnel project tick. */
export function loginBlockedForMissingAccess(role: Role, accessCount: number): boolean {
  if (role === "admin") return false;
  return accessCount < 1;
}

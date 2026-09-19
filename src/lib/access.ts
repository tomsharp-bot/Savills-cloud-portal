import type { Project, ProjectStage, Role, User } from "@prisma/client";

export type AuthedUser = Pick<
  User,
  "id" | "username" | "role" | "name" | "email" | "initials" | "agency" | "company" | "clientRole" | "frozen"
>;

export function isAdmin(user: AuthedUser | null | undefined): boolean {
  return user?.role === "admin";
}

export function isSurveyor(user: AuthedUser | null | undefined): boolean {
  return user?.role === "surveyor";
}

export function isClient(user: AuthedUser | null | undefined): boolean {
  return user?.role === "client";
}

export function roleLabel(role: Role): string {
  if (role === "admin") return "Admin";
  if (role === "client") return "Client";
  return "Surveyor";
}

export function stageLabel(stage: ProjectStage): string {
  return stage === "current" ? "Current" : stage === "upcoming" ? "Upcoming" : "Archive";
}

export function canSeeProject(
  user: AuthedUser,
  project: Pick<Project, "id" | "stage">,
  accessIds: Set<string>
): boolean {
  if (isAdmin(user)) return true;
  if (project.stage === "upcoming") return false;
  return accessIds.has(project.id);
}

export function canEditSiteComments(user: AuthedUser): boolean {
  return isAdmin(user) || isSurveyor(user);
}

export function canOmitAsset(user: AuthedUser): boolean {
  return isAdmin(user);
}

export function canUseLoader(user: AuthedUser): boolean {
  return isAdmin(user);
}

export function canManagePersonnel(user: AuthedUser): boolean {
  return isAdmin(user);
}

export function canSeeUpcoming(user: AuthedUser): boolean {
  return isAdmin(user);
}

export function clientForcedTab(user: AuthedUser, tab: string): string {
  if (isClient(user)) return "completions";
  return tab;
}

export const PROJECT_TABS = [
  "summary",
  "dwellings",
  "blocks",
  "garages",
  "hierarchy",
  "documents",
  "loader",
  "completions",
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];

export const FIELD_TABS = new Set(["summary", "dwellings", "blocks", "garages", "hierarchy", "documents", "loader"]);

export const TYPE_LABELS: Record<string, string> = {
  typeConditionOnly: "Condition Only",
  typeConditionEpc: "Condition + EPC",
  typeBlocks: "Blocks",
  typeGarages: "Garages",
  typeCommercial: "Commercial Units",
  typeOther: "Other",
  typeValidations: "Validations",
};

export function includedTypeLabels(p: Pick<
  Project,
  | "typeConditionOnly"
  | "typeConditionEpc"
  | "typeBlocks"
  | "typeGarages"
  | "typeCommercial"
  | "typeOther"
  | "typeValidations"
>): string[] {
  return (Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[]).filter((k) => p[k as keyof typeof p]).map((k) => TYPE_LABELS[k]);
}

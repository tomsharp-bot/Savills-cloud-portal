import type { ProjectTargetUnit } from "@prisma/client";

export type ProjectTargetFields = {
  projectTargetValue: number;
  projectTargetUnit: ProjectTargetUnit;
};

export function parseProjectTarget(body: Record<string, unknown>): ProjectTargetFields {
  const unit: ProjectTargetUnit = body.projectTargetUnit === "count" ? "count" : "percent";
  const raw = Number(body.projectTargetValue);
  let value = Number.isFinite(raw) ? Math.round(raw) : 75;
  if (value < 0) value = 0;
  if (unit === "percent" && value > 100) value = 100;
  return { projectTargetValue: value, projectTargetUnit: unit };
}

export function formatProjectTarget(project: ProjectTargetFields): string {
  if (project.projectTargetUnit === "count") return String(project.projectTargetValue);
  return `${project.projectTargetValue}%`;
}

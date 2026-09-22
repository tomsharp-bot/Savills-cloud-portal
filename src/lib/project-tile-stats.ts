import type { ProjectTargetUnit } from "@prisma/client";
import {
  formatSamplePercent,
  hasAnyVisit,
  isFullSurveyAsset,
  type SampleAsset,
} from "./sample-analysis.js";
import { formatProjectTarget, type ProjectTargetFields } from "./project-target.js";

export type ProjectTileStats = {
  dwellings: number;
  /** Full surveys completed / relevant (patched, else viable) dwellings. */
  surveysFull: number;
  surveysRelevant: number;
  surveysLabel: string;
  blocks: number;
  accessPct: string;
  target: string;
  completionPct: string;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Compact admin-only numbers for a live Project Progress card.
 * Mirrors Sample Analysis overview: omit-asset rows out; access % and
 * completion % use patched dwellings when any patch is set.
 */
export function buildProjectTileStats(
  project: ProjectTargetFields,
  assets: SampleAsset[]
): ProjectTileStats {
  const live = assets.filter((a) => !a.omitAsset);
  const dwellings = live.filter((a) => a.kind === "dwelling");
  const blocks = live.filter((a) => a.kind === "block");
  const patched = dwellings.filter((a) => text(a.patch));
  const relevant = patched.length > 0 ? patched : dwellings;
  const full = relevant.filter((a) => isFullSurveyAsset(a)).length;
  const visited = relevant.filter((a) => hasAnyVisit(a)).length;

  return {
    dwellings: dwellings.length,
    surveysFull: full,
    surveysRelevant: relevant.length,
    surveysLabel: `${full}/${relevant.length}`,
    blocks: blocks.length,
    accessPct: formatSamplePercent(full, visited),
    target: formatProjectTarget(project),
    completionPct: formatSamplePercent(full, relevant.length),
  };
}

export type TileStatsProject = ProjectTargetFields & { id: string; stage: string };

/**
 * Build a map of projectId → stats for current-stage projects only.
 * Incoming assets must include projectId (as on Asset rows).
 */
export function buildCurrentProjectTileStats(
  projects: TileStatsProject[],
  assets: Array<SampleAsset & { projectId: string }>
): Map<string, ProjectTileStats> {
  const currentIds = new Set(projects.filter((p) => p.stage === "current").map((p) => p.id));
  const byProject = new Map<string, SampleAsset[]>();
  for (const asset of assets) {
    if (!currentIds.has(asset.projectId)) continue;
    const list = byProject.get(asset.projectId) || [];
    list.push(asset);
    byProject.set(asset.projectId, list);
  }

  const out = new Map<string, ProjectTileStats>();
  for (const project of projects) {
    if (project.stage !== "current") continue;
    out.set(project.id, buildProjectTileStats(project, byProject.get(project.id) || []));
  }
  return out;
}

/** Narrow helper for unit tests that only need the target fields. */
export function tileTarget(
  value: number,
  unit: ProjectTargetUnit = "percent"
): ProjectTargetFields {
  return { projectTargetValue: value, projectTargetUnit: unit };
}

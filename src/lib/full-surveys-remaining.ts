import type { ProjectTargetFields } from "./project-target.js";
import { areaTargetFor, isFullSurveyAsset, type SampleAsset } from "./sample-analysis.js";

/**
 * Full Surveys still to do against the project target.
 *
 * The target count uses Math.round, the same rule as Sample Analysis area
 * targets (`areaTargetFor`): round((dwellings × percent) / 100). That is the
 * existing convention, so this does not use Math.ceil. For the MTVH stock,
 * round(38837 × 80 / 100) = round(31069.6) = 31070.
 *
 * A count target is that count (again via `areaTargetFor`). If no target is
 * set, the target count is 100% of dwellings, which keeps the previous
 * "remaining equals the dwelling total when nothing is done" result.
 *
 * Remaining = target count − full surveys done, and never goes below 0.
 * External-only surveys are not part of this figure; callers pass full
 * surveys only.
 */
export function fullSurveysRemaining(
  totalDwellings: number,
  fullSurveysDone: number,
  target?: Partial<ProjectTargetFields> | null
): number {
  const total = finiteCount(totalDwellings);
  const done = finiteCount(fullSurveysDone);
  const targetCount = areaTargetFor(total, resolveTarget(target));
  return Math.max(0, targetCount - done);
}

/**
 * Remaining for the same dwellings the project total counts: kind dwelling,
 * Omit Asset left out. Done is a full survey only (`isFullSurveyAsset`),
 * matching Sample Analysis, so external-only rows do not reduce the figure.
 */
export function fullSurveysRemainingForAssets(
  assets: SampleAsset[],
  target?: Partial<ProjectTargetFields> | null
): number {
  const dwellings = assets.filter((asset) => asset.kind === "dwelling" && !asset.omitAsset);
  const done = dwellings.filter((asset) => isFullSurveyAsset(asset)).length;
  return fullSurveysRemaining(dwellings.length, done, target);
}

function finiteCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

/** Missing target falls back to 100%. A stored 0 is a real target, not "unset". */
function resolveTarget(target?: Partial<ProjectTargetFields> | null): ProjectTargetFields {
  const value = target?.projectTargetValue;
  if (target == null || value == null || !Number.isFinite(value)) {
    return { projectTargetValue: 100, projectTargetUnit: "percent" };
  }
  return {
    projectTargetValue: value,
    projectTargetUnit: target.projectTargetUnit === "count" ? "count" : "percent",
  };
}

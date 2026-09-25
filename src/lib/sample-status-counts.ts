import type { AssetKind } from "@prisma/client";
import { canonicalAssetStatus } from "./asset-status.js";
import { applyEpcSurveyType, isEpcSurveyType } from "./epc-survey.js";
import { isFullSurveyAsset } from "./sample-analysis.js";
import { prisma } from "./prisma.js";

/**
 * Dwelling Asset Status rows on Sample Analysis, in the order the table shows.
 * Synonyms fold into these: "Full Survey Completed" / "Completed" → Full Survey,
 * "Ext Only" → Ext-Only. A blank status folds into No Visit.
 */
export const DWELLING_STATUS_COUNT_ORDER = [
  "Full Survey",
  "Ext-Only",
  "Access Refused",
  "Appt Made Not Kept",
  "Void",
  "No Access",
  "No Visit",
] as const;

export type DwellingStatusCountLabel = (typeof DWELLING_STATUS_COUNT_ORDER)[number] | "Other" | "Total";

export type StatusCountRow = {
  status: DwellingStatusCountLabel;
  count: number;
};

/** One GROUP BY bucket from stock. The query already limits this to dwellings. */
export type DwellingSurveyGroup = {
  kind?: string | null;
  assetStatus?: string | null;
  surveyType?: string | null;
  epcRequired?: boolean | null;
  omitAsset?: boolean | null;
  count: number;
};

export type ConditionSurveyCompletion = {
  /** True only when the project has both Condition Only and Condition + EPC. */
  show: boolean;
  conditionOnly: number;
  conditionEpc: number;
};

/**
 * Dwellings on this project, with Omit Asset left out.
 * Same exclusion Sample Analysis already uses for its counts.
 */
export function dwellingSurveyCountWhere(projectId: string): {
  projectId: string;
  kind: AssetKind;
  omitAsset: boolean;
} {
  return { projectId, kind: "dwelling", omitAsset: false };
}

function finiteCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function countedGroup(group: DwellingSurveyGroup): boolean {
  if (group.omitAsset) return false;
  if (group.kind && group.kind !== "dwelling") return false;
  return finiteCount(group.count) > 0;
}

/** Map a stored Asset Status onto a table row. Blank counts as No Visit. */
export function dwellingStatusBucket(status: unknown): Exclude<DwellingStatusCountLabel, "Total"> {
  if (!String(status ?? "").trim()) return "No Visit";
  return canonicalAssetStatus(status) ?? "Other";
}

/**
 * Seven status rows (always, even at 0), then Other when any non-canonical
 * text is present, then Total.
 */
export function foldDwellingStatusCounts(groups: DwellingSurveyGroup[]): StatusCountRow[] {
  const counts = new Map<string, number>(DWELLING_STATUS_COUNT_ORDER.map((status) => [status, 0]));
  let other = 0;
  for (const group of groups) {
    if (!countedGroup(group)) continue;
    const bucket = dwellingStatusBucket(group.assetStatus);
    const n = finiteCount(group.count);
    if (bucket === "Other") other += n;
    else counts.set(bucket, (counts.get(bucket) || 0) + n);
  }
  const rows: StatusCountRow[] = DWELLING_STATUS_COUNT_ORDER.map((status) => ({
    status,
    count: counts.get(status) || 0,
  }));
  if (other > 0) rows.push({ status: "Other", count: other });
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  rows.push({ status: "Total", count: total });
  return rows;
}

export function projectHasBothConditionTypes(project: {
  typeConditionOnly?: boolean | null;
  typeConditionEpc?: boolean | null;
}): boolean {
  return !!project.typeConditionOnly && !!project.typeConditionEpc;
}

/**
 * Completed full surveys split into Condition Only and Condition + EPC.
 *
 * Completed matches Sample Analysis Full Surveys Done (`isFullSurveyAsset`):
 * Asset Status Full Survey, including Completed / Survey Complete / Full Survey
 * Completed. A blank or No Visit status also counts when Survey Type is itself
 * Full Survey. Ext-Only does not count.
 *
 * Which of the two rows a full survey belongs to follows the Dwellings grid:
 * a completed dwelling is SCS + EPC or SCS Only from EPC Req, on every project.
 */
export function conditionSurveyCompletion(
  project: { typeConditionOnly?: boolean | null; typeConditionEpc?: boolean | null },
  groups: DwellingSurveyGroup[]
): ConditionSurveyCompletion {
  if (!projectHasBothConditionTypes(project)) {
    return { show: false, conditionOnly: 0, conditionEpc: 0 };
  }
  let conditionOnly = 0;
  let conditionEpc = 0;
  for (const group of groups) {
    if (!countedGroup(group)) continue;
    const asset = {
      kind: "dwelling" as const,
      assetStatus: group.assetStatus,
      surveyType: group.surveyType,
      epcRequired: group.epcRequired,
    };
    if (!isFullSurveyAsset(asset)) continue;
    const typed = applyEpcSurveyType(asset, true);
    if (isEpcSurveyType(typed.surveyType)) conditionEpc += finiteCount(group.count);
    else conditionOnly += finiteCount(group.count);
  }
  return { show: true, conditionOnly, conditionEpc };
}

/**
 * Status and survey-type counts for the Sample Analysis page.
 * Postgres groups the rows, so a ~45k dwelling project is not loaded into memory.
 */
export async function loadDwellingSurveyGroups(projectId: string): Promise<DwellingSurveyGroup[]> {
  const rows = await prisma.asset.groupBy({
    by: ["assetStatus", "surveyType", "epcRequired"],
    where: dwellingSurveyCountWhere(projectId),
    _count: { _all: true },
  });
  return rows.map((row) => ({
    kind: "dwelling",
    assetStatus: row.assetStatus,
    surveyType: row.surveyType,
    epcRequired: row.epcRequired,
    omitAsset: false,
    count: row._count._all,
  }));
}

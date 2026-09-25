import type { ProjectTargetUnit } from "@prisma/client";
import { canonicalAssetStatus, isExtOnlyStatus, isFullSurveyStatus } from "./asset-status.js";
import { formatProjectTarget, type ProjectTargetFields } from "./project-target.js";

export type SampleAsset = {
  kind: "dwelling" | "block" | "garage" | string;
  patch?: string | null;
  omitAsset?: boolean | null;
  assetStatus?: string | null;
  surveyType?: string | null;
  external?: string | null;
  surveyor?: string | null;
  surveyedBy?: string | null;
  visit1?: string | null;
  visit2?: string | null;
  visit3?: string | null;
};

export type PatchMeta = {
  patch: string;
  areaName?: string | null;
  surveyorInitials?: string | null;
};

export type SamplePerson = {
  id?: string;
  name: string;
  initials?: string | null;
};

export type KindCounts = {
  total: number;
  done: number;
  toDo: number;
};

export type DwellingCounts = {
  total: number;
  target: number;
  fullDone: number;
  toDo: number;
  pctDone: string;
  visitedYes: number;
  visitedNo: number;
  extDone: number;
  extToDo: number;
};

export type PatchRow = {
  patch: string;
  areaName: string;
  surveyorInitials: string;
  dwellings: DwellingCounts;
  blocks: KindCounts;
  garages: KindCounts;
};

export type SurveyorRow = {
  name: string;
  initials: string;
  active: boolean;
  dwellingsTarget: number;
  dwellingsDone: number;
  dwellingsToDo: number;
  extDone: number;
  extToDo: number;
  visitedYes: number;
  visitedNo: number;
  blocksDone: number;
  blocksToDo: number;
};

export type SampleOverview = {
  dwellings: {
    total: number;
    omitted: number;
    viable: number;
    projectTarget: string;
    completed: number;
    remaining: number;
    pctProjectDone: string;
    accessRate: string;
    extDone: number;
    extToDo: number;
  };
  blocks: {
    total: number;
    viable: number;
    completed: number;
    remaining: number;
  };
  garages: {
    total: number;
    completed: number;
    remaining: number;
  };
};

export type SampleAnalysis = {
  targetLabel: string;
  patches: PatchRow[];
  patchTotals: PatchRow | null;
  surveyors: SurveyorRow[];
  surveyorTotals: SurveyorRow | null;
  usedProjectPersonnel: boolean;
  overview: SampleOverview;
};

function norm(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function isExternalFlag(value: unknown): boolean {
  const s = text(value).toLowerCase();
  return s === "yes" || s === "true" || s === "y" || s === "1" || s === "external" || s === "ext" || s === "ext-only" || s === "ext only";
}

function statusText(asset: SampleAsset): string {
  return text(asset.assetStatus);
}

function openStatus(asset: SampleAsset): boolean {
  const status = statusText(asset);
  if (!status) return true;
  return canonicalAssetStatus(status) === "No Visit";
}

/** Surveyed By is who finished the visit. Surveyor is only the allocated name. */
export function creditedSurveyor(asset: SampleAsset): string {
  return text(asset.surveyedBy) || text(asset.surveyor);
}

/** Full survey wins over external-only. Asset Status is checked before Survey Type. */
export function isFullSurveyAsset(asset: SampleAsset): boolean {
  if (isFullSurveyStatus(asset.assetStatus)) return true;
  if (isExtOnlyStatus(asset.assetStatus)) return false;
  if (!openStatus(asset)) return false;
  return isFullSurveyStatus(asset.surveyType);
}

export function isExtOnlyAsset(asset: SampleAsset): boolean {
  if (isFullSurveyAsset(asset)) return false;
  if (isExtOnlyStatus(asset.assetStatus)) return true;
  if (!openStatus(asset)) return false;
  return isExtOnlyStatus(asset.surveyType);
}

export function isCompletedAsset(asset: SampleAsset): boolean {
  return isFullSurveyAsset(asset) || isExtOnlyAsset(asset);
}

/**
 * Any recorded visit outcome: no answer, failed appointment, access refused,
 * void, full survey, or a visit date. External-only with no visit does not count.
 */
export function hasAnyVisit(asset: SampleAsset): boolean {
  if (isFullSurveyAsset(asset)) return true;
  const status = statusText(asset);
  if (status && canonicalAssetStatus(status) !== "No Visit" && !isExtOnlyStatus(status)) return true;
  return [asset.visit1, asset.visit2, asset.visit3].some((v) => text(v) !== "");
}

export function formatSamplePercent(numerator: number, denominator: number): string {
  if (denominator <= 0 || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return "0%";
  const rounded = Math.round((numerator / denominator) * 1000) / 10;
  if (!Number.isFinite(rounded) || Object.is(rounded, -0) || rounded === 0) return "0%";
  const textValue = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${textValue}%`;
}

/** Area Target ≈ Area Total × project target %. A count target is shared across the base. */
export function areaTargetFor(
  count: number,
  target: ProjectTargetFields,
  base = count
): number {
  if (count <= 0) return 0;
  if (target.projectTargetUnit === "count") {
    if (base <= 0) return 0;
    return Math.round((count / base) * target.projectTargetValue);
  }
  const pct = Math.min(100, Math.max(0, target.projectTargetValue));
  return Math.round((count * pct) / 100);
}

export function comparePatchNames(a: string, b: string): number {
  const parts = (value: string) => value.match(/(\d+)|(\D+)/g) || [];
  const left = parts(a);
  const right = parts(b);
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const x = left[i] || "";
    const y = right[i] || "";
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff) return diff;
    } else {
      const diff = x.toLowerCase().localeCompare(y.toLowerCase(), "en-GB");
      if (diff) return diff;
    }
  }
  return a.localeCompare(b, "en-GB");
}

function counted(assets: SampleAsset[]): SampleAsset[] {
  return assets.filter((asset) => !asset.omitAsset);
}

function patchKey(asset: SampleAsset): string {
  return text(asset.patch);
}

function matchesPerson(person: SamplePerson, surveyor: string): boolean {
  const value = norm(surveyor);
  if (!value) return false;
  if (person.initials && norm(person.initials) === value) return true;
  if (person.name && norm(person.name) === value) return true;
  return false;
}

function personKey(person: SamplePerson): string {
  if (person.id) return `id:${person.id}`;
  return `name:${norm(person.initials)}|${norm(person.name)}`;
}

function fallbackSurveyors(assets: SampleAsset[], known: SamplePerson[]): SamplePerson[] {
  const rows: SamplePerson[] = [];
  const seen = new Set<string>();
  for (const asset of counted(assets)) {
    const raw = creditedSurveyor(asset);
    if (!raw) continue;
    const hit = known.find((person) => matchesPerson(person, raw));
    const row = hit || { name: raw, initials: raw };
    const key = personKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  return rows;
}

/**
 * A Surveyed By value that matches none of the rows already listed.
 * The allocated Surveyor column is not used here: a blank Surveyed By still
 * falls through to those people, and an unmatched allocated name stays hidden
 * when the project already has personnel.
 */
function unmatchedSurveyedBy(assets: SampleAsset[], people: SamplePerson[]): SamplePerson[] {
  const extras: SamplePerson[] = [];
  for (const asset of counted(assets)) {
    const raw = text(asset.surveyedBy);
    if (!raw) continue;
    if (people.some((person) => matchesPerson(person, raw))) continue;
    if (extras.some((person) => matchesPerson(person, raw))) continue;
    extras.push({ name: raw, initials: raw });
  }
  extras.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  return extras;
}

function emptyDwelling(): DwellingCounts {
  return {
    total: 0,
    target: 0,
    fullDone: 0,
    toDo: 0,
    pctDone: "0%",
    visitedYes: 0,
    visitedNo: 0,
    extDone: 0,
    extToDo: 0,
  };
}

function dwellingCounts(assets: SampleAsset[], target: number): DwellingCounts {
  let fullDone = 0;
  let extDone = 0;
  let extToDo = 0;
  let visitedYes = 0;
  for (const asset of assets) {
    if (isFullSurveyAsset(asset)) fullDone += 1;
    else if (isExtOnlyAsset(asset)) extDone += 1;
    else if (isExternalFlag(asset.external)) extToDo += 1;
    if (hasAnyVisit(asset)) visitedYes += 1;
  }
  return {
    total: assets.length,
    target,
    fullDone,
    toDo: target - fullDone,
    pctDone: formatSamplePercent(fullDone, target),
    visitedYes,
    visitedNo: assets.length - visitedYes,
    extDone,
    extToDo,
  };
}

function kindCounts(assets: SampleAsset[]): KindCounts {
  const done = assets.filter((asset) => isCompletedAsset(asset)).length;
  return { total: assets.length, done, toDo: assets.length - done };
}

function sumKind(rows: KindCounts[]): KindCounts {
  return rows.reduce(
    (sum, row) => ({
      total: sum.total + row.total,
      done: sum.done + row.done,
      toDo: sum.toDo + row.toDo,
    }),
    { total: 0, done: 0, toDo: 0 }
  );
}

function sumDwellings(rows: DwellingCounts[]): DwellingCounts {
  const sum = rows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      target: acc.target + row.target,
      fullDone: acc.fullDone + row.fullDone,
      toDo: acc.toDo + row.toDo,
      pctDone: "0%",
      visitedYes: acc.visitedYes + row.visitedYes,
      visitedNo: acc.visitedNo + row.visitedNo,
      extDone: acc.extDone + row.extDone,
      extToDo: acc.extToDo + row.extToDo,
    }),
    emptyDwelling()
  );
  sum.pctDone = formatSamplePercent(sum.fullDone, sum.target);
  return sum;
}

export function buildSampleAnalysis(input: {
  assets: SampleAsset[];
  projectTargetValue: number;
  projectTargetUnit: ProjectTargetUnit;
  patchMeta?: PatchMeta[];
  allocatedSurveyors?: SamplePerson[];
  knownSurveyors?: SamplePerson[];
}): SampleAnalysis {
  const targetFields: ProjectTargetFields = {
    projectTargetValue: input.projectTargetValue,
    projectTargetUnit: input.projectTargetUnit,
  };
  const metaByPatch = new Map<string, PatchMeta>();
  for (const meta of input.patchMeta || []) {
    const key = text(meta.patch);
    if (key) metaByPatch.set(key, meta);
  }

  const live = counted(input.assets);
  const patchedDwellings = live.filter((asset) => asset.kind === "dwelling" && patchKey(asset));
  const patchNames = new Set<string>();
  for (const asset of live) {
    const key = patchKey(asset);
    if (key) patchNames.add(key);
  }

  const patches: PatchRow[] = [...patchNames].sort(comparePatchNames).map((patch) => {
    const inPatch = live.filter((asset) => patchKey(asset) === patch);
    const dwellings = inPatch.filter((asset) => asset.kind === "dwelling");
    const blocks = inPatch.filter((asset) => asset.kind === "block");
    const garages = inPatch.filter((asset) => asset.kind === "garage");
    const meta = metaByPatch.get(patch);
    const target =
      targetFields.projectTargetUnit === "count"
        ? areaTargetFor(dwellings.length, targetFields, patchedDwellings.length)
        : areaTargetFor(dwellings.length, targetFields);
    return {
      patch,
      areaName: text(meta?.areaName),
      surveyorInitials: text(meta?.surveyorInitials).toUpperCase(),
      dwellings: dwellingCounts(dwellings, target),
      blocks: kindCounts(blocks),
      garages: kindCounts(garages),
    };
  });

  const patchTotals = patches.length
    ? {
        patch: "TOTALS",
        areaName: "",
        surveyorInitials: "",
        dwellings: sumDwellings(patches.map((row) => row.dwellings)),
        blocks: sumKind(patches.map((row) => row.blocks)),
        garages: sumKind(patches.map((row) => row.garages)),
      }
    : null;

  const allocated = (input.allocatedSurveyors || [])
    .filter((person) => text(person.name) || text(person.initials))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const usedProjectPersonnel = allocated.length > 0;
  const listed = usedProjectPersonnel
    ? allocated
    : fallbackSurveyors(input.assets, input.knownSurveyors || []);
  const people = listed.concat(unmatchedSurveyedBy(input.assets, listed));

  const buckets = people.map(() => ({
    dwellings: [] as SampleAsset[],
    blocks: [] as SampleAsset[],
  }));
  for (const asset of live) {
    const index = people.findIndex((person) => matchesPerson(person, creditedSurveyor(asset)));
    if (index < 0) continue;
    if (asset.kind === "dwelling") buckets[index].dwellings.push(asset);
    else if (asset.kind === "block") buckets[index].blocks.push(asset);
  }

  const dwellingBase = live.filter((asset) => asset.kind === "dwelling").length;
  const surveyors: SurveyorRow[] = people.map((person, index) => {
    const dwellings = buckets[index].dwellings;
    const blocks = buckets[index].blocks;
    const target =
      targetFields.projectTargetUnit === "count"
        ? areaTargetFor(dwellings.length, targetFields, dwellingBase)
        : areaTargetFor(dwellings.length, targetFields);
    const stats = dwellingCounts(dwellings, target);
    const blockStats = kindCounts(blocks);
    const active = stats.fullDone + stats.extDone + stats.visitedYes + blockStats.done > 0;
    return {
      name: text(person.name) || text(person.initials),
      initials: text(person.initials).toUpperCase(),
      active,
      dwellingsTarget: stats.target,
      dwellingsDone: stats.fullDone,
      dwellingsToDo: stats.toDo,
      extDone: stats.extDone,
      extToDo: stats.extToDo,
      visitedYes: stats.visitedYes,
      visitedNo: stats.visitedNo,
      blocksDone: blockStats.done,
      blocksToDo: blockStats.toDo,
    };
  });

  const surveyorTotals = surveyors.length
    ? surveyors.reduce<SurveyorRow>(
        (sum, row) => ({
          name: "Total",
          initials: "",
          active: false,
          dwellingsTarget: sum.dwellingsTarget + row.dwellingsTarget,
          dwellingsDone: sum.dwellingsDone + row.dwellingsDone,
          dwellingsToDo: sum.dwellingsToDo + row.dwellingsToDo,
          extDone: sum.extDone + row.extDone,
          extToDo: sum.extToDo + row.extToDo,
          visitedYes: sum.visitedYes + row.visitedYes,
          visitedNo: sum.visitedNo + row.visitedNo,
          blocksDone: sum.blocksDone + row.blocksDone,
          blocksToDo: sum.blocksToDo + row.blocksToDo,
        }),
        {
          name: "Total",
          initials: "",
          active: false,
          dwellingsTarget: 0,
          dwellingsDone: 0,
          dwellingsToDo: 0,
          extDone: 0,
          extToDo: 0,
          visitedYes: 0,
          visitedNo: 0,
          blocksDone: 0,
          blocksToDo: 0,
        }
      )
    : null;

  const allDwellings = input.assets.filter((asset) => asset.kind === "dwelling");
  const omittedDwellings = allDwellings.filter((asset) => asset.omitAsset).length;
  const fullOnPatched = patchedDwellings.filter((asset) => isFullSurveyAsset(asset)).length;
  const visitedOnPatched = patchedDwellings.filter((asset) => hasAnyVisit(asset)).length;
  const extDonePatched = patchedDwellings.filter((asset) => isExtOnlyAsset(asset)).length;
  const extToDoPatched = patchedDwellings.filter(
    (asset) => !isFullSurveyAsset(asset) && !isExtOnlyAsset(asset) && isExternalFlag(asset.external)
  ).length;
  const remaining = patchTotals ? patchTotals.dwellings.toDo : 0;

  const allBlocks = input.assets.filter((asset) => asset.kind === "block");
  const viableBlocks = counted(allBlocks);
  const blocksCompleted = viableBlocks.filter((asset) => isCompletedAsset(asset)).length;
  const allGarages = input.assets.filter((asset) => asset.kind === "garage");
  const viableGarages = counted(allGarages);
  const garagesCompleted = viableGarages.filter((asset) => isCompletedAsset(asset)).length;

  return {
    targetLabel: formatProjectTarget(targetFields),
    patches,
    patchTotals,
    surveyors,
    surveyorTotals,
    usedProjectPersonnel,
    overview: {
      dwellings: {
        total: allDwellings.length,
        omitted: omittedDwellings,
        viable: allDwellings.length - omittedDwellings,
        projectTarget: formatProjectTarget(targetFields),
        completed: fullOnPatched,
        remaining,
        pctProjectDone: formatSamplePercent(fullOnPatched, patchedDwellings.length),
        accessRate: formatSamplePercent(fullOnPatched, visitedOnPatched),
        extDone: extDonePatched,
        extToDo: extToDoPatched,
      },
      blocks: {
        total: allBlocks.length,
        viable: viableBlocks.length,
        completed: blocksCompleted,
        remaining: viableBlocks.length - blocksCompleted,
      },
      garages: {
        total: viableGarages.length,
        completed: garagesCompleted,
        remaining: viableGarages.length - garagesCompleted,
      },
    },
  };
}

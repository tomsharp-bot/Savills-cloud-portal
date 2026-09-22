import type { Asset, Project } from "@prisma/client";
import { isExtOnlyStatus, isFullSurveyStatus } from "./asset-status.js";
import { applyEpcSurveyType, isEpcSurveyType } from "./epc-survey.js";
import { formatProjectTarget } from "./project-target.js";

export type KpiStack = {
  key: string;
  hidden: boolean;
  tiles: { label: string; value: string }[];
};

function counted(assets: Asset[]) {
  return assets.filter((a) => !a.omitAsset);
}

function completed(assets: Asset[]) {
  return counted(assets).filter((a) => isFullSurveyStatus(a.assetStatus) || isExtOnlyStatus(a.assetStatus));
}

export function buildSummary(project: Project, assets: Asset[]): KpiStack[] {
  const view = assets.map((asset) => applyEpcSurveyType(asset, !!project.typeConditionEpc));
  const dwellings = view.filter((a) => a.kind === "dwelling");
  const blocks = view.filter((a) => a.kind === "block");
  const garages = view.filter((a) => a.kind === "garage");
  const showDwellings = !!(project.typeConditionOnly || project.typeConditionEpc);

  const dwellCounted = counted(dwellings);
  const blockCounted = counted(blocks);
  const garageCounted = counted(garages);
  const fullAssets = dwellCounted.filter((a) => isFullSurveyStatus(a.assetStatus));
  const fullCondition = fullAssets.filter((a) => !isEpcSurveyType(a.surveyType)).length;
  const fullEpc = fullAssets.filter((a) => isEpcSurveyType(a.surveyType)).length;
  const full = fullCondition + fullEpc;
  const fullTiles = project.typeConditionEpc
    ? [
        { label: "Full Surveys Completed: Condition Only", value: String(fullCondition) },
        { label: "Full Surveys Completed: Condition + EPC", value: String(fullEpc) },
      ]
    : [{ label: "Full Surveys Completed", value: String(full) }];
  const ext = dwellCounted.filter((a) => isExtOnlyStatus(a.assetStatus)).length;
  const remaining = Math.max(0, dwellCounted.length - full - ext);
  const extPending = dwellCounted.filter(
    (a) => String(a.external).trim().toLowerCase() === "yes" && !isExtOnlyStatus(a.assetStatus)
  ).length;

  const blockDone = completed(blocks).length;
  const garageDone = completed(garages).length;

  const totalAssets = dwellCounted.length + blockCounted.length + garageCounted.length;

  return [
    {
      key: "all",
      hidden: false,
      tiles: [
        { label: "Total assets", value: String(totalAssets) },
        { label: "Dwellings", value: String(dwellCounted.length) },
        { label: "Blocks", value: String(blockCounted.length) },
        { label: "Garages", value: String(garageCounted.length) },
      ],
    },
    {
      key: "dwellings",
      hidden: !showDwellings,
      tiles: [
        { label: "Total Dwellings", value: String(dwellCounted.length) },
        { label: "Project Target", value: formatProjectTarget(project) },
        ...fullTiles,
        { label: "Full Surveys Remaining", value: String(remaining) },
        { label: "External-only Completed", value: String(ext) },
        { label: "External-only Remaining", value: String(extPending) },
      ],
    },
    {
      key: "blocks",
      hidden: !project.typeBlocks,
      tiles: [
        { label: "Total Blocks", value: String(blockCounted.length) },
        { label: "Blocks Completed", value: String(blockDone) },
        { label: "Blocks Remaining", value: String(Math.max(0, blockCounted.length - blockDone)) },
      ],
    },
    {
      key: "garages",
      hidden: !project.typeGarages,
      tiles: [
        { label: "Total Garages", value: String(garageCounted.length) },
        { label: "Garages Completed", value: String(garageDone) },
        { label: "Garages Remaining", value: String(Math.max(0, garageCounted.length - garageDone)) },
      ],
    },
    {
      key: "commercial",
      hidden: !project.typeCommercial,
      tiles: [
        { label: "Commercial Units", value: "0" },
        { label: "Commercial Completed", value: "0" },
        { label: "Commercial Remaining", value: "0" },
      ],
    },
    {
      key: "other",
      hidden: !project.typeOther,
      tiles: [
        { label: "Other Units", value: "0" },
        { label: "Other Completed", value: "0" },
        { label: "Other Remaining", value: "0" },
      ],
    },
    {
      key: "validations",
      hidden: !project.typeValidations,
      tiles: [
        { label: "Validations Total", value: "0" },
        { label: "Validations Completed", value: "0" },
        { label: "Validations Remaining", value: "0" },
      ],
    },
  ];
}

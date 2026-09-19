import type { Asset, Project } from "@prisma/client";
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
  return counted(assets).filter((a) => a.assetStatus === "Full Survey" || a.assetStatus === "Ext-Only");
}

export function buildSummary(project: Project, assets: Asset[]): KpiStack[] {
  const dwellings = assets.filter((a) => a.kind === "dwelling");
  const blocks = assets.filter((a) => a.kind === "block");
  const garages = assets.filter((a) => a.kind === "garage");
  const showDwellings = !!(project.typeConditionOnly || project.typeConditionEpc);

  const dwellCounted = counted(dwellings);
  const full = dwellCounted.filter((a) => a.assetStatus === "Full Survey").length;
  const ext = dwellCounted.filter((a) => a.assetStatus === "Ext-Only").length;
  const remaining = Math.max(0, dwellCounted.length - full - ext);
  const extPending = dwellCounted.filter((a) => String(a.external).toLowerCase() === "yes" && a.assetStatus !== "Ext-Only").length;

  const blockDone = completed(blocks).length;
  const garageDone = completed(garages).length;

  return [
    {
      key: "dwellings",
      hidden: !showDwellings,
      tiles: [
        { label: "Total Dwellings", value: String(dwellings.length) },
        { label: "Project Target", value: formatProjectTarget(project) },
        { label: "Full Surveys Completed", value: String(full) },
        { label: "Full Surveys Remaining", value: String(remaining) },
        { label: "External-only Completed", value: String(ext) },
        { label: "External-only Remaining", value: String(extPending) },
      ],
    },
    {
      key: "blocks",
      hidden: !project.typeBlocks,
      tiles: [
        { label: "Total Blocks", value: String(blocks.length) },
        { label: "Blocks Completed", value: String(blockDone) },
        { label: "Blocks Remaining", value: String(Math.max(0, counted(blocks).length - blockDone)) },
      ],
    },
    {
      key: "garages",
      hidden: !project.typeGarages,
      tiles: [
        { label: "Total Garages", value: String(garages.length) },
        { label: "Garages Completed", value: String(garageDone) },
        { label: "Garages Remaining", value: String(Math.max(0, counted(garages).length - garageDone)) },
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

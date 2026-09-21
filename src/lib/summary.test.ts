import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Asset, Project } from "@prisma/client";
import { buildSummary } from "./summary.js";

function project(): Project {
  return {
    id: "p",
    name: "Cornwall",
    projectManager: "Greg K",
    stage: "current",
    typeConditionOnly: true,
    typeConditionEpc: false,
    typeBlocks: true,
    typeGarages: true,
    typeCommercial: false,
    typeOther: false,
    typeValidations: false,
    projectTargetValue: 75,
    projectTargetUnit: "percent",
    sampleStartDate: "",
    sampleTargetEndDate: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function asset(partial: Partial<Asset>): Asset {
  return {
    id: partial.uprn || "a",
    projectId: "p",
    kind: "dwelling",
    uprn: "1",
    assetStatus: "No Visit",
    surveyDate: "",
    surveyedBy: "",
    visit1: "",
    visit2: "",
    visit3: "",
    number: "",
    block: "",
    street: "",
    area: "",
    city: "",
    postcode: "",
    archetype: "",
    yearBuilt: "",
    patch: "",
    surveyor: "",
    surveyType: "",
    siteComments: "",
    external: "",
    residentName: "",
    residentNumber: "",
    residentEmail: "",
    letterDate1: "",
    letterDate2: "",
    x1: "",
    x2: "",
    x3: "",
    omitAsset: false,
    stockMissing: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

function tile(stackKey: string, label: string, assets: Asset[]): string {
  const stack = buildSummary(project(), assets).find((s) => s.key === stackKey);
  const found = stack?.tiles.find((t) => t.label === label);
  return found?.value || "";
}

describe("Summary counts and Omit Asset", () => {
  it("leaves omitted assets out of totals, completed and remaining", () => {
    const assets = [
      asset({ uprn: "open", assetStatus: "No Visit" }),
      asset({ uprn: "full", assetStatus: "Full Survey" }),
      asset({ uprn: "ext", assetStatus: "Ext-Only", external: "Yes" }),
      asset({ uprn: "omitted-full", assetStatus: "Full Survey", omitAsset: true }),
      asset({ uprn: "omitted-open", assetStatus: "No Access", omitAsset: true }),
    ];
    assert.equal(tile("dwellings", "Total Dwellings", assets), "3");
    assert.equal(tile("dwellings", "Full Surveys Completed", assets), "1");
    assert.equal(tile("dwellings", "External-only Completed", assets), "1");
    assert.equal(tile("dwellings", "Full Surveys Remaining", assets), "1");
    assert.equal(tile("dwellings", "External-only Remaining", assets), "0");
    const total = Number(tile("dwellings", "Total Dwellings", assets));
    const full = Number(tile("dwellings", "Full Surveys Completed", assets));
    const ext = Number(tile("dwellings", "External-only Completed", assets));
    const remaining = Number(tile("dwellings", "Full Surveys Remaining", assets));
    assert.equal(full + ext + remaining, total);
  });

  it("counts legacy completed labels and ignores surrounding spaces", () => {
    const assets = [
      asset({ uprn: "a", assetStatus: "Full Surveys" }),
      asset({ uprn: "b", assetStatus: " External Only " }),
      asset({ uprn: "c", kind: "block", assetStatus: "Full Survey", omitAsset: true }),
      asset({ uprn: "d", kind: "block", assetStatus: "No Visit" }),
      asset({ uprn: "e", kind: "garage", assetStatus: "Ext-Only" }),
    ];
    assert.equal(tile("dwellings", "Full Surveys Completed", assets), "1");
    assert.equal(tile("dwellings", "External-only Completed", assets), "1");
    assert.equal(tile("dwellings", "Total Dwellings", assets), "2");
    assert.equal(tile("blocks", "Total Blocks", assets), "1");
    assert.equal(tile("blocks", "Blocks Completed", assets), "0");
    assert.equal(tile("blocks", "Blocks Remaining", assets), "1");
    assert.equal(tile("garages", "Total Garages", assets), "1");
    assert.equal(tile("garages", "Garages Completed", assets), "1");
    assert.equal(tile("garages", "Garages Remaining", assets), "0");
  });
});

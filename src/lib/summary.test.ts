import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Asset, Project } from "@prisma/client";
import { buildSummary } from "./summary.js";

function project(partial: Partial<Project> = {}): Project {
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
    ...partial,
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
    epcRequired: false,
    stockMissing: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

function tile(stackKey: string, label: string, assets: Asset[], proj: Project = project()): string {
  const stack = buildSummary(proj, assets).find((s) => s.key === stackKey);
  const found = stack?.tiles.find((t) => t.label === label);
  return found?.value || "";
}

describe("Summary counts and Omit Asset", () => {
  it("shows one total for every non-omitted asset, including kinds whose survey type is off", () => {
    const proj = project({ typeBlocks: false, typeGarages: false, typeConditionOnly: true });
    const assets = [
      asset({ uprn: "d", kind: "dwelling" }),
      asset({ uprn: "b", kind: "block" }),
      asset({ uprn: "g", kind: "garage" }),
      asset({ uprn: "o", kind: "dwelling", omitAsset: true }),
    ];
    const summary = buildSummary(proj, assets);
    const all = summary.find((stack) => stack.key === "all");
    assert.equal(all?.hidden, false);
    assert.equal(all?.tiles.find((tile) => tile.label === "Total assets")?.value, "3");
    assert.equal(all?.tiles.find((tile) => tile.label === "Dwellings")?.value, "1");
    assert.equal(all?.tiles.find((tile) => tile.label === "Blocks")?.value, "1");
    assert.equal(all?.tiles.find((tile) => tile.label === "Garages")?.value, "1");
    assert.equal(summary.find((stack) => stack.key === "blocks")?.hidden, true);
    assert.equal(summary.find((stack) => stack.key === "garages")?.hidden, true);
    assert.equal(tile("dwellings", "Total Dwellings", assets, proj), "1");
  });

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
    assert.equal(tile("dwellings", "Full Surveys Completed: Condition Only", assets), "");
    assert.equal(tile("dwellings", "Full Surveys Completed: Condition + EPC", assets), "");
  });

  it("splits full surveys when the project includes Condition + EPC", () => {
    const proj = project({ typeConditionEpc: true });
    const assets = [
      asset({ uprn: "only", assetStatus: "Full Survey", surveyType: "Condition Only", epcRequired: false }),
      asset({ uprn: "epc", assetStatus: "Full Survey", surveyType: "Condition Only", epcRequired: true }),
      asset({ uprn: "legacy", assetStatus: "Full Survey", surveyType: "Condition + EPC", epcRequired: false }),
      asset({ uprn: "open", assetStatus: "No Visit", surveyType: "Condition + EPC", epcRequired: true }),
      asset({ uprn: "ext", assetStatus: "Ext-Only", external: "Yes", epcRequired: true }),
      asset({ uprn: "omit", assetStatus: "Full Survey", epcRequired: true, omitAsset: true }),
    ];
    assert.equal(tile("dwellings", "Full Surveys Completed", assets, proj), "");
    assert.equal(tile("dwellings", "Full Surveys Completed: Condition Only", assets, proj), "2");
    assert.equal(tile("dwellings", "Full Surveys Completed: Condition + EPC", assets, proj), "1");
    assert.equal(tile("dwellings", "Total Dwellings", assets, proj), "5");
    assert.equal(tile("dwellings", "External-only Completed", assets, proj), "1");
    assert.equal(tile("dwellings", "Full Surveys Remaining", assets, proj), "1");
    assert.equal(tile("dwellings", "External-only Remaining", assets, proj), "0");
  });
});

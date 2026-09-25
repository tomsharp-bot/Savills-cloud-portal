import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DWELLING_STATUS_COUNT_ORDER,
  conditionSurveyCompletion,
  dwellingStatusBucket,
  dwellingSurveyCountWhere,
  foldDwellingStatusCounts,
  type DwellingSurveyGroup,
} from "./sample-status-counts.js";

function group(partial: Partial<DwellingSurveyGroup> & { count: number }): DwellingSurveyGroup {
  return {
    kind: "dwelling",
    assetStatus: "No Visit",
    surveyType: "",
    epcRequired: false,
    omitAsset: false,
    ...partial,
  };
}

const bothTypes = { typeConditionOnly: true, typeConditionEpc: true };

describe("dwelling asset status counts", () => {
  it("keeps the seven statuses in order, including zeros, and adds a total", () => {
    const rows = foldDwellingStatusCounts([]);
    assert.deepEqual(
      rows.map((row) => row.status),
      [...DWELLING_STATUS_COUNT_ORDER, "Total"]
    );
    assert.deepEqual(
      rows.map((row) => row.count),
      [0, 0, 0, 0, 0, 0, 0, 0]
    );
  });

  it("folds legacy labels and a blank status, and sums an Other row", () => {
    const rows = foldDwellingStatusCounts([
      group({ assetStatus: "Full Survey", count: 10 }),
      group({ assetStatus: "Full Surveys", count: 2 }),
      group({ assetStatus: "  Full Survey  ", count: 1 }),
      group({ assetStatus: "Ext-Only", count: 4 }),
      group({ assetStatus: "External Only", count: 3 }),
      group({ assetStatus: "Access Refused", count: 5 }),
      group({ assetStatus: "Appt Made Not Kept", count: 6 }),
      group({ assetStatus: "Void", count: 7 }),
      group({ assetStatus: "No Access", count: 8 }),
      group({ assetStatus: "No Visit", count: 9 }),
      group({ assetStatus: "", count: 2 }),
      group({ assetStatus: null, count: 1 }),
      group({ assetStatus: "   ", count: 1 }),
      group({ assetStatus: "Unknown", count: 3 }),
      group({ assetStatus: "completed", count: 2 }),
    ]);
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.count]));
    assert.equal(byStatus["Full Survey"], 15);
    assert.equal(byStatus["Ext-Only"], 7);
    assert.equal(byStatus["Access Refused"], 5);
    assert.equal(byStatus["Appt Made Not Kept"], 6);
    assert.equal(byStatus.Void, 7);
    assert.equal(byStatus["No Access"], 8);
    assert.equal(byStatus["No Visit"], 13);
    assert.equal(byStatus.Other, 3);
    assert.equal(byStatus.Total, 15 + 7 + 5 + 6 + 7 + 8 + 13 + 3);
    assert.equal(rows.at(-2)?.status, "Other");
    assert.equal(rows.at(-1)?.status, "Total");
  });

  it("leaves omitted rows, blocks and garages out, and hides Other when nothing else remains", () => {
    const rows = foldDwellingStatusCounts([
      group({ assetStatus: "Full Survey", count: 4, omitAsset: true }),
      group({ kind: "block", assetStatus: "Full Survey", count: 9 }),
      group({ kind: "garage", assetStatus: "No Access", count: 8 }),
      group({ assetStatus: "No Access", count: 2 }),
      group({ assetStatus: "Mystery", count: 0 }),
    ]);
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.count]));
    assert.equal(byStatus["Full Survey"], 0);
    assert.equal(byStatus["No Access"], 2);
    assert.equal(byStatus.Total, 2);
    assert.equal(rows.some((row) => row.status === "Other"), false);
  });

  it("maps blank and legacy labels onto the canonical rows", () => {
    assert.equal(dwellingStatusBucket(null), "No Visit");
    assert.equal(dwellingStatusBucket(""), "No Visit");
    assert.equal(dwellingStatusBucket("Full Surveys"), "Full Survey");
    assert.equal(dwellingStatusBucket("External Only"), "Ext-Only");
    assert.equal(dwellingStatusBucket("Full Survey Completed"), "Full Survey");
    assert.equal(dwellingStatusBucket("  survey complete "), "Full Survey");
    assert.equal(dwellingStatusBucket("completed"), "Full Survey");
    assert.equal(dwellingStatusBucket("Ext Only"), "Ext-Only");
    assert.equal(dwellingStatusBucket("Access Attempted"), "No Access");
    assert.equal(dwellingStatusBucket("No Visit Recorded"), "No Visit");
    assert.equal(dwellingStatusBucket("Resident refused access"), "Access Refused");
    assert.equal(dwellingStatusBucket("  NO ACCESS  "), "No Access");
    assert.equal(dwellingStatusBucket("Something else"), "Other");
  });

  it("asks the database for dwellings only, with Omit Asset left out", () => {
    assert.deepEqual(dwellingSurveyCountWhere("proj-1"), {
      projectId: "proj-1",
      kind: "dwelling",
      omitAsset: false,
    });
    const source = readFileSync(join(process.cwd(), "src/lib/sample-status-counts.ts"), "utf8");
    assert.match(source, /groupBy/);
    assert.match(source, /dwellingSurveyCountWhere/);
  });
});

describe("Condition Only and Condition + EPC completed counts", () => {
  it("stays hidden unless the project has both survey types", () => {
    const groups = [group({ assetStatus: "Full Survey", epcRequired: true, count: 4 })];
    assert.deepEqual(conditionSurveyCompletion({ typeConditionOnly: true, typeConditionEpc: false }, groups), {
      show: false,
      conditionOnly: 0,
      conditionEpc: 0,
    });
    assert.deepEqual(conditionSurveyCompletion({ typeConditionOnly: false, typeConditionEpc: true }, groups), {
      show: false,
      conditionOnly: 0,
      conditionEpc: 0,
    });
    assert.equal(conditionSurveyCompletion(bothTypes, groups).show, true);
  });

  it("counts Full Survey only and splits completed dwellings by EPC Req.", () => {
    const result = conditionSurveyCompletion(bothTypes, [
      group({ assetStatus: "Full Survey", surveyType: "Condition Only", epcRequired: false, count: 3 }),
      group({ assetStatus: "Full Surveys", surveyType: "Condition Only", epcRequired: true, count: 2 }),
      group({ assetStatus: "Full Survey", surveyType: "Condition + EPC", epcRequired: false, count: 1 }),
      group({ assetStatus: "Full Survey", surveyType: "Condition Only", epcRequired: true, count: 4 }),
      group({ assetStatus: "Ext-Only", surveyType: "Condition + EPC", epcRequired: true, count: 6 }),
      group({ assetStatus: "External Only", epcRequired: true, count: 2 }),
      group({ assetStatus: "No Access", epcRequired: true, count: 5 }),
      group({ assetStatus: "No Visit", surveyType: "Condition + EPC", epcRequired: true, count: 7 }),
      group({ assetStatus: "Void", epcRequired: false, count: 1 }),
      group({ assetStatus: "Full Survey", epcRequired: true, omitAsset: true, count: 9 }),
      group({ kind: "block", assetStatus: "Full Survey", epcRequired: true, count: 8 }),
    ]);
    assert.equal(result.show, true);
    assert.equal(result.conditionOnly, 4);
    assert.equal(result.conditionEpc, 6);
  });

  it("counts a blank status as a full survey only when Survey Type is Full Survey, and then as Condition Only", () => {
    const result = conditionSurveyCompletion(bothTypes, [
      group({ assetStatus: "", surveyType: "Full Survey", epcRequired: true, count: 2 }),
      group({ assetStatus: "No Visit", surveyType: "Full Surveys", epcRequired: true, count: 1 }),
      group({ assetStatus: "No Visit", surveyType: "Condition + EPC", epcRequired: true, count: 5 }),
    ]);
    assert.equal(result.conditionOnly, 3);
    assert.equal(result.conditionEpc, 0);
  });

  it("counts stocklist completion wording as Full Survey, and Ext Only as Ext-Only", () => {
    const rows = foldDwellingStatusCounts([
      group({ assetStatus: "Full Survey Completed", epcRequired: false, count: 4 }),
      group({ assetStatus: "Survey Complete", epcRequired: true, count: 3 }),
      group({ assetStatus: "Completed", epcRequired: false, count: 2 }),
      group({ assetStatus: "Ext Only", epcRequired: true, count: 5 }),
      group({ assetStatus: "External", count: 1 }),
      group({ assetStatus: "On hold", count: 6 }),
    ]);
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.count]));
    assert.equal(byStatus["Full Survey"], 9);
    assert.equal(byStatus["Ext-Only"], 6);
    assert.equal(byStatus.Other, 6);
    const split = conditionSurveyCompletion(bothTypes, [
      group({ assetStatus: "Full Survey Completed", surveyType: "", epcRequired: false, count: 4 }),
      group({ assetStatus: "Survey Complete", surveyType: "Condition Only", epcRequired: true, count: 3 }),
      group({ assetStatus: "Ext Only", epcRequired: true, count: 5 }),
      group({ assetStatus: "No Visit", surveyType: "SCS + EPC", epcRequired: true, count: 8 }),
    ]);
    assert.equal(split.conditionOnly, 4);
    assert.equal(split.conditionEpc, 3);
  });

  it("splits completed dwellings by the derived SCS Only and SCS + EPC labels", () => {
    const result = conditionSurveyCompletion(bothTypes, [
      group({ assetStatus: "Full Survey", surveyType: "SCS Only", epcRequired: false, count: 2 }),
      group({ assetStatus: "Full Survey", surveyType: "SCS + EPC", epcRequired: true, count: 3 }),
      group({ assetStatus: "Ext-Only", surveyType: "External", epcRequired: true, count: 4 }),
      group({ assetStatus: "No Visit", surveyType: "", epcRequired: true, count: 5 }),
    ]);
    assert.equal(result.conditionOnly, 2);
    assert.equal(result.conditionEpc, 3);
  });
});

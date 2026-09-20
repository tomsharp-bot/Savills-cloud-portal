import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OMITTED_SURVEYED_NOTE, appendSurveyedNote, planStocklistRefresh, type RefreshAsset } from "./stock-refresh.js";
import { flaggedUprnsFromRows, isTruthyFlag } from "./external.js";

function row(partial: Partial<RefreshAsset> & { uprn: string }): RefreshAsset {
  return {
    assetStatus: "No Visit",
    siteComments: "",
    external: "",
    omitAsset: false,
    stockMissing: false,
    ...partial,
  };
}

describe("Stocklist refresh plan", () => {
  it("adds new UPRNs and marks missing ones without deleting", () => {
    const existing = [row({ uprn: "A", assetStatus: "No Visit" }), row({ uprn: "B", assetStatus: "Full Survey" })];
    const plan = planStocklistRefresh(existing, [{ UPRN: "A", Street: "High St" }, { UPRN: "C", Street: "New Rd" }], true);
    assert.deepEqual(
      plan.added.map((a) => a.uprn),
      ["C"]
    );
    assert.deepEqual(plan.removed, ["B"]);
    assert.deepEqual(
      plan.matched.map((m) => m.uprn),
      ["A"]
    );
    assert.equal(plan.matched[0].address.street, "High St");
  });

  it("maps Patch and Surveyor from a stocklist export so they can be re-uploaded", () => {
    const existing = [row({ uprn: "A" })];
    const plan = planStocklistRefresh(
      existing,
      [{ UPRN: "A", Patch: "Patch 4", Surveyor: "AS", Street: "High St" }],
      false
    );
    assert.equal(plan.matched[0].address.patch, "Patch 4");
    assert.equal(plan.matched[0].address.surveyor, "AS");
  });

  it("maps resident, letter and X columns when present (flexible headers)", () => {
    const existing = [row({ uprn: "A" })];
    const plan = planStocklistRefresh(
      existing,
      [
        {
          UPRN: "A",
          "resident name": "Sam Lee",
          "Resident_Number": "01234 567890",
          "Resident E-mail": "sam@example.com",
          "Letter Date1": "15/02/2026",
          "letter-date-2": "01/03/26",
          X1: "flag",
          "X 2": "note",
          x3: "z",
        },
      ],
      false
    );
    const a = plan.matched[0].address;
    assert.equal(a.residentName, "Sam Lee");
    assert.equal(a.residentNumber, "01234 567890");
    assert.equal(a.residentEmail, "sam@example.com");
    assert.equal(a.letterDate1, "15/02/26");
    assert.equal(a.letterDate2, "01/03/26");
    assert.equal(a.x1, "flag");
    assert.equal(a.x2, "note");
    assert.equal(a.x3, "z");
  });

  it("leaves resident fields off the patch when those columns are missing", () => {
    const existing = [row({ uprn: "A" })];
    const plan = planStocklistRefresh(existing, [{ UPRN: "A", Street: "High St" }], false);
    assert.equal(plan.matched[0].address.residentName, undefined);
    assert.equal(plan.matched[0].address.letterDate1, undefined);
    assert.equal(plan.matched[0].address.x1, undefined);
  });

  it("errors when no UPRN values are present", () => {
    const plan = planStocklistRefresh([row({ uprn: "A" })], [{ Street: "Nope" }], true);
    assert.equal(plan.error, "No UPRN column / values found in file");
  });

  it("appends the surveyed-omit note once", () => {
    assert.equal(appendSurveyedNote(""), OMITTED_SURVEYED_NOTE);
    assert.equal(appendSurveyedNote("Letter sent"), `Letter sent · ${OMITTED_SURVEYED_NOTE}`);
    assert.equal(appendSurveyedNote(OMITTED_SURVEYED_NOTE), OMITTED_SURVEYED_NOTE);
  });
});

describe("External-only flags", () => {
  it("treats Yes / True / Y / 1 as flagged", () => {
    assert.equal(isTruthyFlag("Yes"), true);
    assert.equal(isTruthyFlag("TRUE"), true);
    assert.equal(isTruthyFlag("y"), true);
    assert.equal(isTruthyFlag("1"), true);
    assert.equal(isTruthyFlag("no"), false);
  });

  it("collects flagged UPRNs from the named column", () => {
    const rows = [
      { UPRN: "1", External: "Yes" },
      { UPRN: "2", External: "0" },
      { UPRN: "3", External: "Y" },
    ];
    assert.deepEqual(flaggedUprnsFromRows(rows, "External"), ["1", "3"]);
  });
});

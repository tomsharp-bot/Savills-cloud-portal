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

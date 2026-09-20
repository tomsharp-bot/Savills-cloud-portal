import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AssetKind } from "@prisma/client";
import {
  countByKind,
  formatPurgeNotice,
  planMissingStockPurge,
  type PurgeAsset,
} from "./stock-purge.js";
import { isSurveyedStatus } from "./stock-refresh.js";

function asset(
  partial: Partial<PurgeAsset> & { id: string; uprn: string; kind?: AssetKind }
): PurgeAsset {
  return {
    kind: "dwelling",
    assetStatus: "No Visit",
    stockMissing: true,
    ...partial,
  };
}

describe("Missing stocklist purge plan", () => {
  it("leaves unmarked assets alone", () => {
    const plan = planMissingStockPurge(
      [asset({ id: "keep", uprn: "A", stockMissing: false, assetStatus: "No Visit" })],
      true
    );
    assert.deepEqual(plan.deleted, []);
    assert.deepEqual(plan.keptCompleted, []);
  });

  it("deletes only non-completed missing assets when includeCompleted is false", () => {
    const plan = planMissingStockPurge(
      [
        asset({ id: "open", uprn: "A", assetStatus: "No Access" }),
        asset({ id: "full", uprn: "B", assetStatus: "Full Survey" }),
        asset({ id: "ext", uprn: "C", assetStatus: "Ext-Only" }),
        asset({ id: "void", uprn: "D", assetStatus: "Void" }),
        asset({ id: "present", uprn: "E", stockMissing: false, assetStatus: "No Visit" }),
      ],
      false
    );
    assert.deepEqual(
      plan.deleted.map((r) => r.uprn),
      ["A", "D"]
    );
    assert.deepEqual(
      plan.keptCompleted.map((r) => r.uprn),
      ["B", "C"]
    );
  });

  it("also deletes completed missing assets when includeCompleted is true", () => {
    const plan = planMissingStockPurge(
      [
        asset({ id: "open", uprn: "A", assetStatus: "No Access" }),
        asset({ id: "full", uprn: "B", assetStatus: "Full Survey" }),
        asset({ id: "ext", uprn: "C", assetStatus: "Ext-Only" }),
      ],
      true
    );
    assert.deepEqual(
      plan.deleted.map((r) => r.uprn),
      ["A", "B", "C"]
    );
    assert.deepEqual(plan.keptCompleted, []);
  });

  it("applies the same completed rule to blocks and garages", () => {
    const plan = planMissingStockPurge(
      [
        asset({ id: "b1", uprn: "BLK-1", kind: "block", assetStatus: "Full Survey" }),
        asset({ id: "b2", uprn: "BLK-2", kind: "block", assetStatus: "No Visit" }),
        asset({ id: "g1", uprn: "GAR-1", kind: "garage", assetStatus: "Ext-Only" }),
        asset({ id: "g2", uprn: "GAR-2", kind: "garage", assetStatus: "No Access" }),
      ],
      false
    );
    assert.deepEqual(
      plan.deleted.map((r) => r.uprn),
      ["BLK-2", "GAR-2"]
    );
    assert.deepEqual(
      plan.keptCompleted.map((r) => r.uprn),
      ["BLK-1", "GAR-1"]
    );
  });

  it("treats Full Surveys / External Only aliases as completed", () => {
    assert.equal(isSurveyedStatus("Full Surveys"), true);
    assert.equal(isSurveyedStatus("External Only"), true);
    const plan = planMissingStockPurge(
      [
        asset({ id: "a", uprn: "1", assetStatus: "Full Surveys" }),
        asset({ id: "b", uprn: "2", assetStatus: "External Only" }),
      ],
      false
    );
    assert.equal(plan.deleted.length, 0);
    assert.equal(plan.keptCompleted.length, 2);
  });

  it("counts deleted rows by kind and formats the notice", () => {
    const byKind = countByKind([
      { kind: "dwelling" },
      { kind: "dwelling" },
      { kind: "garage" },
    ]);
    assert.deepEqual(byKind, { dwelling: 2, block: 0, garage: 1 });
    assert.equal(
      formatPurgeNotice({
        deleted: 2,
        keptCompleted: 1,
        includeCompleted: false,
        byKind: { dwelling: 2, block: 0, garage: 0 },
      }),
      "Removed 2 asset(s) marked not on the latest stocklist (2 dwelling(s)). Kept 1 completed row(s). Summary counts updated."
    );
    assert.equal(
      formatPurgeNotice({
        deleted: 0,
        keptCompleted: 0,
        includeCompleted: true,
        byKind: { dwelling: 0, block: 0, garage: 0 },
      }),
      "Removed 0 asset(s) marked not on the latest stocklist. Summary counts updated."
    );
  });
});

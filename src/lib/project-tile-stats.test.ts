import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCurrentProjectTileStats,
  buildProjectTileStats,
  tileTarget,
} from "./project-tile-stats.js";
import { formatSamplePercent } from "./sample-analysis.js";

describe("buildProjectTileStats", () => {
  it("counts dwellings, full/relevant surveys, blocks, access %, target, completion %", () => {
    const stats = buildProjectTileStats(tileTarget(75), [
      { kind: "dwelling", patch: "A", assetStatus: "Full Survey", visit1: "01/03/2026" },
      { kind: "dwelling", patch: "A", assetStatus: "No Access", visit1: "02/03/2026" },
      { kind: "dwelling", patch: "B", assetStatus: "No Visit" },
      { kind: "dwelling", omitAsset: true, patch: "A", assetStatus: "Full Survey" },
      { kind: "block", assetStatus: "Full Survey" },
      { kind: "block", assetStatus: "No Visit" },
      { kind: "garage", assetStatus: "Full Survey" },
    ]);

    assert.equal(stats.dwellings, 3);
    assert.equal(stats.surveysFull, 1);
    assert.equal(stats.surveysRelevant, 3);
    assert.equal(stats.surveysLabel, "1/3");
    assert.equal(stats.blocks, 2);
    assert.equal(stats.target, "75%");
    assert.equal(stats.accessPct, formatSamplePercent(1, 2));
    assert.equal(stats.completionPct, formatSamplePercent(1, 3));
  });

  it("falls back to all viable dwellings when none are patched", () => {
    const stats = buildProjectTileStats(tileTarget(10, "count"), [
      { kind: "dwelling", assetStatus: "Full Survey" },
      { kind: "dwelling", assetStatus: "No Visit" },
    ]);
    assert.equal(stats.surveysLabel, "1/2");
    assert.equal(stats.target, "10");
    assert.equal(stats.completionPct, formatSamplePercent(1, 2));
  });
});

describe("buildCurrentProjectTileStats", () => {
  it("only builds stats for current-stage projects", () => {
    const map = buildCurrentProjectTileStats(
      [
        { id: "c1", stage: "current", projectTargetValue: 50, projectTargetUnit: "percent" },
        { id: "u1", stage: "upcoming", projectTargetValue: 50, projectTargetUnit: "percent" },
      ],
      [
        { projectId: "c1", kind: "dwelling", patch: "1", assetStatus: "Full Survey" },
        { projectId: "u1", kind: "dwelling", patch: "1", assetStatus: "Full Survey" },
      ]
    );
    assert.equal(map.size, 1);
    assert.equal(map.get("c1")?.surveysLabel, "1/1");
    assert.equal(map.has("u1"), false);
  });
});

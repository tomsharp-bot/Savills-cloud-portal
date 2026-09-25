import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fullSurveysRemaining, fullSurveysRemainingForAssets } from "./full-surveys-remaining.js";

const eightyPercent = { projectTargetValue: 80, projectTargetUnit: "percent" as const };

describe("fullSurveysRemaining", () => {
  it("rounds MTVH 38837 dwellings at 80% with nothing done to 31070", () => {
    assert.equal(Math.round((38837 * 80) / 100), 31070);
    assert.equal(fullSurveysRemaining(38837, 0, eightyPercent), 31070);
  });

  it("subtracts full surveys already done", () => {
    assert.equal(fullSurveysRemaining(38837, 70, eightyPercent), 31000);
  });

  it("floors at 0 when done is more than the target", () => {
    assert.equal(fullSurveysRemaining(38837, 31071, eightyPercent), 0);
    assert.equal(
      fullSurveysRemaining(10, 9, { projectTargetValue: 50, projectTargetUnit: "percent" }),
      0
    );
  });

  it("falls back to 100% when no target is set, so remaining is total minus done", () => {
    assert.equal(fullSurveysRemaining(38837, 0, null), 38837);
    assert.equal(fullSurveysRemaining(38837, 100, undefined), 38737);
    assert.equal(fullSurveysRemaining(10, 3, {}), 7);
  });

  it("treats a stored 0% as a real target, not as missing", () => {
    assert.equal(
      fullSurveysRemaining(10, 0, { projectTargetValue: 0, projectTargetUnit: "percent" }),
      0
    );
  });

  it("uses a count target as the number of surveys to hit", () => {
    assert.equal(
      fullSurveysRemaining(38837, 40, { projectTargetValue: 100, projectTargetUnit: "count" }),
      60
    );
    assert.equal(
      fullSurveysRemaining(20, 25, { projectTargetValue: 10, projectTargetUnit: "count" }),
      0
    );
  });
});

describe("fullSurveysRemainingForAssets", () => {
  it("uses non-omitted dwellings only and ignores external-only surveys", () => {
    const remaining = fullSurveysRemainingForAssets(
      [
        { kind: "dwelling", assetStatus: "Full Survey" },
        { kind: "dwelling", assetStatus: "Ext-Only", external: "Yes" },
        { kind: "dwelling", assetStatus: "No Visit" },
        { kind: "dwelling", assetStatus: "No Visit" },
        { kind: "dwelling", assetStatus: "Full Survey", omitAsset: true },
        { kind: "block", assetStatus: "Full Survey" },
      ],
      eightyPercent
    );
    // 4 counted dwellings × 80% = 3, minus 1 full survey. The omitted full
    // survey, the block, and the external-only row stay out of it.
    assert.equal(remaining, 2);
  });

  it("counts an open dwelling whose survey type is a full survey, as Sample Analysis does", () => {
    const remaining = fullSurveysRemainingForAssets(
      [
        { kind: "dwelling", assetStatus: "No Visit", surveyType: "Full Survey" },
        { kind: "dwelling", assetStatus: "No Visit" },
      ],
      { projectTargetValue: 100, projectTargetUnit: "percent" }
    );
    assert.equal(remaining, 1);
  });
});

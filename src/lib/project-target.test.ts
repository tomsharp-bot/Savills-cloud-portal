import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatProjectTarget, parseProjectTarget } from "./project-target.js";

describe("Project target", () => {
  it("defaults to percent and 75 when missing or invalid", () => {
    assert.deepEqual(parseProjectTarget({}), { projectTargetValue: 75, projectTargetUnit: "percent" });
    assert.deepEqual(parseProjectTarget({ projectTargetValue: "nope" }), {
      projectTargetValue: 75,
      projectTargetUnit: "percent",
    });
  });

  it("accepts a survey count or a percentage", () => {
    assert.deepEqual(parseProjectTarget({ projectTargetValue: "180", projectTargetUnit: "count" }), {
      projectTargetValue: 180,
      projectTargetUnit: "count",
    });
    assert.deepEqual(parseProjectTarget({ projectTargetValue: "80", projectTargetUnit: "percent" }), {
      projectTargetValue: 80,
      projectTargetUnit: "percent",
    });
  });

  it("clamps percent to 0–100 and count to 0+", () => {
    assert.equal(parseProjectTarget({ projectTargetValue: "140", projectTargetUnit: "percent" }).projectTargetValue, 100);
    assert.equal(parseProjectTarget({ projectTargetValue: "-4", projectTargetUnit: "count" }).projectTargetValue, 0);
  });

  it("formats Summary KPI values", () => {
    assert.equal(formatProjectTarget({ projectTargetValue: 75, projectTargetUnit: "percent" }), "75%");
    assert.equal(formatProjectTarget({ projectTargetValue: 180, projectTargetUnit: "count" }), "180");
  });
});

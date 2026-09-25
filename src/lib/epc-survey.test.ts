import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SURVEY_TYPE_SCS_EPC,
  SURVEY_TYPE_SCS_ONLY,
  applyEpcSurveyType,
  epcRequiredFlag,
  epcRequiredFromSurveyType,
  parseEpcRequired,
} from "./epc-survey.js";

describe("EPC Req. survey type", () => {
  it("sets SCS + EPC when a completed dwelling is marked YES", () => {
    const row = applyEpcSurveyType(
      { kind: "dwelling", assetStatus: "Full Survey", surveyType: "Condition Only", epcRequired: true },
      true
    );
    assert.equal(row.surveyType, SURVEY_TYPE_SCS_EPC);
  });

  it("sets SCS only when EPC Req. is blank", () => {
    const row = applyEpcSurveyType(
      { kind: "dwelling", assetStatus: "Completed", surveyType: "Condition + EPC", epcRequired: false },
      true
    );
    assert.equal(row.surveyType, SURVEY_TYPE_SCS_ONLY);
  });

  it("leaves open dwellings and non-EPC projects unchanged", () => {
    const open = applyEpcSurveyType(
      { kind: "dwelling", assetStatus: "No Visit", surveyType: "Condition + EPC", epcRequired: true },
      true
    );
    assert.equal(open.surveyType, "Condition + EPC");
    const other = applyEpcSurveyType(
      { kind: "dwelling", assetStatus: "Full Survey", surveyType: "Condition Only", epcRequired: true },
      false
    );
    assert.equal(other.surveyType, "Condition Only");
    const block = applyEpcSurveyType(
      { kind: "block", assetStatus: "Full Survey", surveyType: "Blocks", epcRequired: true },
      true
    );
    assert.equal(block.surveyType, "Blocks");
  });

  it("reads YES from imported survey type labels", () => {
    assert.equal(epcRequiredFromSurveyType("Condition + EPC"), true);
    assert.equal(epcRequiredFromSurveyType("SCS + EPC"), true);
    assert.equal(epcRequiredFromSurveyType("Condition Only"), false);
    assert.equal(epcRequiredFromSurveyType("SCS only"), false);
    assert.equal(epcRequiredFromSurveyType("Blocks"), undefined);
  });

  it("parses an EPC Req cell as yes, no, or blank", () => {
    for (const value of ["Yes", "yes", "Y", "TRUE", "1", " Yes ", true, 1, "ticked", "✓"]) {
      assert.equal(parseEpcRequired(value), true, String(value));
      assert.equal(epcRequiredFlag(value), true, String(value));
    }
    for (const value of ["No", "N", "False", "0", " no ", false, 0]) {
      assert.equal(parseEpcRequired(value), false, String(value));
      assert.equal(epcRequiredFlag(value), false, String(value));
    }
    for (const value of ["", "   ", "maybe", null, undefined]) {
      assert.equal(parseEpcRequired(value), undefined, String(value));
      assert.equal(epcRequiredFlag(value), false, String(value));
    }
  });
});

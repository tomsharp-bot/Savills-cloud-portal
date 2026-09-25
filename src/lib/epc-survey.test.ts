import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SURVEY_TYPE_EXTERNAL,
  SURVEY_TYPE_SCS_EPC,
  SURVEY_TYPE_SCS_ONLY,
  applyEpcSurveyType,
  deriveDwellingSurveyType,
  epcRequiredFlag,
  epcRequiredFromSurveyType,
  parseEpcRequired,
} from "./epc-survey.js";

describe("EPC Req. survey type", () => {
  it("uses SCS Only with a capital O", () => {
    assert.equal(SURVEY_TYPE_SCS_ONLY, "SCS Only");
    assert.equal(SURVEY_TYPE_SCS_EPC, "SCS + EPC");
    assert.equal(SURVEY_TYPE_EXTERNAL, "External");
  });

  it("derives a dwelling Survey Type from status and EPC Req on every project", () => {
    assert.equal(deriveDwellingSurveyType("Ext-Only", false), "External");
    assert.equal(deriveDwellingSurveyType("External Only", true), "External");
    assert.equal(deriveDwellingSurveyType("Full Survey", false), "SCS Only");
    assert.equal(deriveDwellingSurveyType("Full Survey", true), "SCS + EPC");
    assert.equal(deriveDwellingSurveyType("Full Surveys", true), "SCS + EPC");
    assert.equal(deriveDwellingSurveyType("Completed", false), "SCS Only");
    for (const status of ["No Visit", "No Access", "Appt Made Not Kept", "Access Refused", "Void", "", "   "]) {
      assert.equal(deriveDwellingSurveyType(status, true), "", status);
    }
    const onAnyProject = applyEpcSurveyType(
      { kind: "dwelling", assetStatus: "Full Survey", surveyType: "Condition Only", epcRequired: true },
      false
    );
    assert.equal(onAnyProject.surveyType, SURVEY_TYPE_SCS_EPC);
    const open = applyEpcSurveyType(
      { kind: "dwelling", assetStatus: "No Visit", surveyType: "Condition + EPC", epcRequired: true },
      true
    );
    assert.equal(open.surveyType, "");
    const block = applyEpcSurveyType(
      { kind: "block", assetStatus: "Full Survey", surveyType: "Blocks", epcRequired: true },
      true
    );
    assert.equal(block.surveyType, "Blocks");
    const garage = applyEpcSurveyType(
      { kind: "garage", assetStatus: "Ext-Only", surveyType: "Garages", epcRequired: false },
      false
    );
    assert.equal(garage.surveyType, "Garages");
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

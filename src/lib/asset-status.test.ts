import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferStockKind, statusFromVisit } from "./asset-status.js";

describe("Asset Status rules", () => {
  it("defaults to No Visit until Visit Type is present", () => {
    assert.deepEqual(statusFromVisit("Successful", ""), {
      assetStatus: "No Visit",
      setSurveyFields: false,
    });
  });

  it("maps No Answer / None to No Access", () => {
    assert.equal(statusFromVisit("No Answer", "RdSAP").assetStatus, "No Access");
    assert.equal(statusFromVisit("None", "SCS").assetStatus, "No Access");
    assert.equal(statusFromVisit("Successful", "RdSAP").setSurveyFields, true);
    assert.equal(statusFromVisit("No Answer", "RdSAP").setSurveyFields, false);
  });

  it("maps Failed Appointment (any visit #) to Appt Made Not Kept", () => {
    assert.equal(statusFromVisit("Failed appointment", "SCS").assetStatus, "Appt Made Not Kept");
    assert.equal(statusFromVisit("Failed Appointment 2", "SCS").assetStatus, "Appt Made Not Kept");
    assert.equal(statusFromVisit("failed appt", "SCS").assetStatus, "Appt Made Not Kept");
  });

  it("maps Refused Access / Not Convenient to Access Refused", () => {
    assert.equal(statusFromVisit("Refused Access", "SCS").assetStatus, "Access Refused");
    assert.equal(statusFromVisit("Not Convenient", "SCS").assetStatus, "Access Refused");
  });

  it("maps Void and Successful", () => {
    assert.equal(statusFromVisit("Void", "SCS").assetStatus, "Void");
    const ok = statusFromVisit("Successful", "SCS");
    assert.equal(ok.assetStatus, "Full Survey");
    assert.equal(ok.setSurveyFields, true);
  });
});

describe("Auto-route to Dwellings / Blocks / Garages", () => {
  it("routes Garage / Garage Sites to garages", () => {
    assert.equal(inferStockKind({ "Survey Design": "MTVH Garage Sites" }), "garage");
    assert.equal(inferStockKind({ Archetype: "Garage" }), "garage");
  });

  it("routes Block(s) / MTVH Blocks to blocks", () => {
    assert.equal(inferStockKind({ "Survey Design": "MTVH Blocks" }), "block");
    assert.equal(inferStockKind({ Archetype: "Low-rise block" }), "block");
  });

  it("defaults everything else to dwellings", () => {
    assert.equal(inferStockKind({ Archetype: "House", "Visit Type": "SCS" }), "dwelling");
    assert.equal(inferStockKind({}), "dwelling");
  });
});

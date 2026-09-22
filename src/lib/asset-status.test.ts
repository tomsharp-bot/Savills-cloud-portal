import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assetStatusFilterOptions,
  inferStockKind,
  statusFromVisit,
  statusFromVisitLogs,
} from "./asset-status.js";

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
    assert.equal(statusFromVisit("Access Refused", "SCS").assetStatus, "Access Refused");
  });

  it("maps the stock-grid labels when they arrive as Access Type", () => {
    assert.equal(statusFromVisit("No Access", "SCS").assetStatus, "No Access");
    assert.equal(statusFromVisit("Appt Made Not Kept", "SCS").assetStatus, "Appt Made Not Kept");
    assert.equal(statusFromVisit("Appointment not kept", "SCS").assetStatus, "Appt Made Not Kept");
    assert.equal(statusFromVisit("Access Refused", "RdSAP").assetStatus, "Access Refused");
  });

  it("maps Void and Successful", () => {
    assert.equal(statusFromVisit("Void", "SCS").assetStatus, "Void");
    const ok = statusFromVisit("Successful", "SCS");
    assert.equal(ok.assetStatus, "Full Survey");
    assert.equal(ok.setSurveyFields, true);
  });

  it("maps Successful aliases to the Full Survey UI label", () => {
    for (const access of ["Successful", "successful", "Full Survey", "full survey", "Completed", "Success"]) {
      assert.equal(statusFromVisit(access, "SCS").assetStatus, "Full Survey", access);
    }
  });
});

describe("Auto-route to Dwellings / Blocks / Garages", () => {
  it("routes Garage / Garages / Garage Sites to garages", () => {
    assert.equal(inferStockKind({ "Survey Design": "MTVH Garage Sites" }), "garage");
    assert.equal(inferStockKind({ Archetype: "Garage" }), "garage");
    assert.equal(inferStockKind({ "Asset Type": "Garages" }), "garage");
    assert.equal(inferStockKind({ asset_type: "garage sites" }), "garage");
  });

  it("routes Block / Blocks / MTVH Blocks to blocks", () => {
    assert.equal(inferStockKind({ "Survey Design": "MTVH Blocks" }), "block");
    assert.equal(inferStockKind({ Archetype: "Low-rise block" }), "block");
    assert.equal(inferStockKind({ "Asset Type": "Block" }), "block");
    assert.equal(inferStockKind({ "Survey Type": "Blocks" }), "block");
  });

  it("does not treat the address Block column as an asset type", () => {
    assert.equal(inferStockKind({ Block: "Harbour Court", Archetype: "House" }), "dwelling");
    assert.equal(inferStockKind({ "Combined Address": "Block A, High Street" }), "dwelling");
  });

  it("defaults everything else to dwellings", () => {
    assert.equal(inferStockKind({ Archetype: "House", "Visit Type": "SCS" }), "dwelling");
    assert.equal(inferStockKind({}), "dwelling");
  });

  it("keeps residential types as dwellings even when the survey design says Blocks", () => {
    for (const archetype of ["House", "Flat", "Bungalow", "Bung.", "Maisonette", "Mais.", "Bedsit", "Room", "Studio"]) {
      assert.equal(
        inferStockKind({ Archetype: archetype, "Survey Design": "MTVH Blocks", "Survey Type": "Blocks" }),
        "dwelling",
        archetype
      );
    }
    assert.equal(inferStockKind({ "Dwelling Type": "End terrace house" }), "dwelling");
    assert.equal(inferStockKind({ "Asset Type": "Commercial Unit" }), "dwelling");
    assert.equal(inferStockKind({ "Asset Type": "Commercial unit", Archetype: "Shop" }), "dwelling");
    assert.equal(inferStockKind({ Archetype: "Block" }), "block");
    assert.equal(inferStockKind({ Archetype: "Low-rise block" }), "block");
  });
});

describe("Asset Status filter options", () => {
  it("always includes the Full Survey UI label used by Dwellings/Blocks/Garages", () => {
    const opts = assetStatusFilterOptions(["No Visit", "Successful"]);
    assert.ok(opts.includes("Full Survey"));
    assert.equal(opts[opts.indexOf("Full Survey")], "Full Survey");
    assert.ok(opts.includes("Successful"));
  });
});

describe("Visit log → stock row status", () => {
  it("uses the latest typed visit so a successful import updates the asset", () => {
    const st = statusFromVisitLogs([
      { visitType: "RdSAP", accessType: "No Answer" },
      { visitType: "SCS", accessType: "Successful" },
    ]);
    assert.equal(st.assetStatus, "Full Survey");
    assert.equal(st.setSurveyFields, true);
  });
});

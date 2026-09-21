import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { statusFromVisit } from "./asset-status.js";
import { normalizeVisit } from "./loader.js";

describe("Visit import column mapping", () => {
  it("reads Access_Type / Visit_Type so Successful is not stored as No Access", () => {
    const row = normalizeVisit(
      {
        UPRN: "635770",
        Access_Type: "Successful",
        Visit_Type: "SCS",
        Survey_Date: "2026-09-18",
        Created_By: "Peter May",
      },
      "visits.xlsx"
    );
    assert.equal(row.uprn, "635770");
    assert.equal(row.accessType, "Successful");
    assert.equal(row.visitType, "SCS");
    assert.equal(row.surveyDate, "18/09/2026");
    assert.equal(row.createdBy, "Peter May");
    assert.equal(statusFromVisit(row.accessType, row.visitType).assetStatus, "Full Survey");
  });

  it("maps the stock status labels when they are used as Access Type", () => {
    const refused = normalizeVisit({ UPRN: "1", "Access Type": "Access Refused", "Visit Type": "SCS" }, "v.xlsx");
    const missed = normalizeVisit(
      { UPRN: "2", "Access Type": "Appt Made Not Kept", "Visit Type": "RdSAP" },
      "v.xlsx"
    );
    assert.equal(statusFromVisit(refused.accessType, refused.visitType).assetStatus, "Access Refused");
    assert.equal(statusFromVisit(missed.accessType, missed.visitType).assetStatus, "Appt Made Not Kept");
  });

  it("does not put the address Block column into the street", () => {
    const row = normalizeVisit(
      {
        UPRN: "8",
        "Visit Type": "SCS",
        "Access Type": "Successful",
        Block: "Harbour Court",
        "Address Line 1": "Quay Street",
        Street: "Ignore me",
        "Post Code": "EX23 8JZ",
      },
      "v.xlsx"
    );
    assert.equal(row.block, "Harbour Court");
    assert.equal(row.addressLine1, "Quay Street");
    assert.equal(row.postcode, "EX23 8JZ");
  });
});

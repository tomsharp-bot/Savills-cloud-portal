import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { newPendingAlerts, pendingAlertSummary } from "./hhsrs-pending-alerts.js";

const root = process.cwd();

describe("HHSRS pending alert summary", () => {
  it("joins category, rating, and a shortened comment", () => {
    const summary = pendingAlertSummary({
      category: "Damp & Mould Growth",
      rating: "High",
      comment: "  black   mould in the cupboard  ",
    });
    assert.equal(summary, "Damp & Mould Growth · High — black mould in the cupboard");
  });

  it("truncates long comments", () => {
    const summary = pendingAlertSummary({
      category: "Electrical Hazards",
      rating: "Medium",
      comment: "x".repeat(180),
    });
    assert.equal(summary.length, "Electrical Hazards · Medium — ".length + 140);
    assert.ok(summary.endsWith("..."));
  });

  it("returns only ids that were not in the last snapshot", () => {
    const fresh = newPendingAlerts(["a", "b"], [
      { id: "c", fullAddress: "3 New Street" },
      { id: "a", fullAddress: "1 High Street" },
      { id: "", fullAddress: "skip" },
    ]);
    assert.deepEqual(
      fresh.map((row) => row.id),
      ["c"]
    );
  });
});

describe("HHSRS Reporter alert wiring", () => {
  it("renders the toast shell and polls from the reporter script", () => {
    const layout = fs.readFileSync(
      path.join(root, "views/hhsrs-reporter/partials/layout-close.ejs"),
      "utf8"
    );
    const pending = fs.readFileSync(path.join(root, "views/hhsrs-reporter/pending.ejs"), "utf8");
    const admin = fs.readFileSync(path.join(root, "views/hhsrs-reporter/admin.ejs"), "utf8");
    const control = fs.readFileSync(
      path.join(root, "views/hhsrs-reporter/partials/desktop-alerts-control.ejs"),
      "utf8"
    );
    const js = fs.readFileSync(path.join(root, "public/js/hhsrs-reporter.js"), "utf8");

    assert.match(layout, /id="hhsrs-alert-toast"/);
    assert.match(layout, /class="alert-toast"/);
    assert.match(layout, /initialPendingIds/);
    assert.match(pending, /desktop-alerts-control/);
    assert.match(admin, /desktop-alerts-control/);
    assert.match(control, /Enable desktop alerts/);
    assert.match(js, /pending-alerts\.json/);
    assert.match(js, /new Notification/);
    assert.match(js, /btn-enable-desktop-alerts/);
    assert.match(js, /requireInteraction:\s*true/);
    assert.match(control, /Turn on desktop alerts/);
    assert.match(control, /Get a Windows notification when a new site issue lands/);
    assert.match(js, /claimStatus === "claimed"/);
    assert.match(js, /is-visible/);
    assert.match(js, /playAlertChime\(\)/);
    assert.match(js, /AudioContext/);
    assert.match(js, /unlockAlertSound/);
    assert.doesNotMatch(js, /\.loop\s*=/);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { newPendingAlerts, pendingAlertSummary } from "./hhsrs-pending-alerts.js";

const root = process.cwd();
const require = createRequire(import.meta.url);
const pendingAlertScript = require("../../public/js/hhsrs-pending-alerts.js") as {
  resolvePendingAlerts: (
    marker: { lastSeenAt: string; seenIds: string[] } | null,
    pending: Array<{ id: string; createdAt?: string; claimStatus?: string; fullAddress?: string }>,
    nowIso: string
  ) => {
    alert: Array<{ id: string }>;
    marker: { lastSeenAt: string; seenIds: string[] };
  };
  shouldPausePoll: (info: {
    ok?: boolean;
    redirected?: boolean;
    contentType?: string;
    pendingIsArray?: boolean;
  }) => boolean;
  leaderHoldsLock: (record: { id?: string; at?: number } | null, now: number, ttl?: number) => boolean;
  homeNoticeText: (count: number) => string;
  desktopAlertCopy: (item: { projectName?: string; rating?: string; fullAddress?: string }) => {
    title: string;
    body: string;
  };
};

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

describe("HHSRS pending alert marker", () => {
  const earlier = {
    id: "case-old",
    createdAt: "2026-09-25T09:00:00.000Z",
    claimStatus: "open",
    fullAddress: "1 High Street",
  };
  const arrived = {
    id: "case-new",
    createdAt: "2026-09-25T10:15:00.000Z",
    claimStatus: "open",
    fullAddress: "9 Harbour Road",
  };

  it("alerts on the second page load for a case created between loads", () => {
    const first = pendingAlertScript.resolvePendingAlerts(null, [earlier], "2026-09-25T09:05:00.000Z");
    assert.deepEqual(first.alert, []);
    assert.equal(first.marker.lastSeenAt, earlier.createdAt);
    assert.deepEqual(first.marker.seenIds, [earlier.id]);

    const second = pendingAlertScript.resolvePendingAlerts(
      first.marker,
      [arrived, earlier],
      "2026-09-25T10:16:00.000Z"
    );
    assert.deepEqual(
      second.alert.map((row) => row.id),
      [arrived.id]
    );

    const again = pendingAlertScript.resolvePendingAlerts(
      second.marker,
      [arrived, earlier],
      "2026-09-25T10:20:00.000Z"
    );
    assert.deepEqual(again.alert, []);
  });

  it("sets a first-run baseline and does not alert the backlog", () => {
    const backlog = [
      arrived,
      earlier,
      { id: "case-mid", createdAt: "2026-09-25T09:30:00.000Z", claimStatus: "open" },
    ];
    const first = pendingAlertScript.resolvePendingAlerts(null, backlog, "2026-09-25T11:00:00.000Z");
    assert.deepEqual(first.alert, []);
    assert.equal(first.marker.lastSeenAt, arrived.createdAt);
    assert.deepEqual(first.marker.seenIds, [arrived.id, earlier.id, "case-mid"]);

    const sameList = pendingAlertScript.resolvePendingAlerts(
      first.marker,
      backlog,
      "2026-09-25T11:01:00.000Z"
    );
    assert.deepEqual(sameList.alert, []);
  });

  it("keeps claimed and stale cases quiet and still advances the marker", () => {
    const baseline = pendingAlertScript.resolvePendingAlerts(null, [], "2026-09-25T08:00:00.000Z");
    const claimed = {
      id: "case-claimed",
      createdAt: "2026-09-25T12:00:00.000Z",
      claimStatus: "claimed",
    };
    const stale = {
      id: "case-stale",
      createdAt: "2026-09-25T12:05:00.000Z",
      claimStatus: "stale",
    };
    const next = pendingAlertScript.resolvePendingAlerts(
      baseline.marker,
      [stale, claimed],
      "2026-09-25T12:06:00.000Z"
    );
    assert.deepEqual(next.alert, []);
    assert.equal(next.marker.lastSeenAt, stale.createdAt);
    assert.ok(next.marker.seenIds.includes(claimed.id));
    assert.ok(next.marker.seenIds.includes(stale.id));
  });

  it("pauses when the poll is a login page, a redirect, or not JSON", () => {
    assert.equal(
      pendingAlertScript.shouldPausePoll({
        ok: true,
        redirected: true,
        contentType: "text/html",
        pendingIsArray: false,
      }),
      true
    );
    assert.equal(
      pendingAlertScript.shouldPausePoll({
        ok: false,
        redirected: false,
        contentType: "application/json",
        pendingIsArray: false,
      }),
      true
    );
    assert.equal(
      pendingAlertScript.shouldPausePoll({
        ok: true,
        redirected: false,
        contentType: "text/html; charset=utf-8",
        pendingIsArray: false,
      }),
      true
    );
    assert.equal(
      pendingAlertScript.shouldPausePoll({
        ok: true,
        redirected: false,
        contentType: "application/json",
        pendingIsArray: false,
      }),
      true
    );
    assert.equal(
      pendingAlertScript.shouldPausePoll({
        ok: true,
        redirected: false,
        contentType: "application/json; charset=utf-8",
        pendingIsArray: true,
      }),
      false
    );
  });

  it("names only the project and rating on the desktop notification", () => {
    assert.deepEqual(
      pendingAlertScript.desktopAlertCopy({
        projectName: "MTVH 2026",
        rating: "Category 1",
        fullAddress: "14 Harbour Lane",
      }),
      { title: "New HHSRS Hazard", body: "MTVH 2026 · Category 1" }
    );
    assert.equal(
      pendingAlertScript.desktopAlertCopy({ projectName: "  MTVH 2026  ", rating: "  " }).body,
      "MTVH 2026"
    );
    assert.equal(pendingAlertScript.desktopAlertCopy({ projectName: "", rating: "High" }).body, "High");
    assert.equal(pendingAlertScript.desktopAlertCopy({}).body, "");
  });

  it("uses one short home notice for a single new case", () => {
    assert.equal(pendingAlertScript.homeNoticeText(1), "New HHSRS case waiting in Pending");
    assert.equal(pendingAlertScript.homeNoticeText(2), "2 new HHSRS cases waiting in Pending");
  });

  it("lets one fresh leader record block every other tab", () => {
    const now = 1_700_000_000_000;
    const leader = { id: "tab-a", at: now - 1000 };
    assert.equal(pendingAlertScript.leaderHoldsLock(leader, now, 150000), true);
    assert.equal(pendingAlertScript.leaderHoldsLock(leader, now + 150000, 150000), false);
    assert.equal(pendingAlertScript.leaderHoldsLock(null, now, 150000), false);
    assert.equal(pendingAlertScript.leaderHoldsLock({ id: "", at: now }, now, 150000), false);
  });
});

describe("HHSRS Reporter alert wiring", () => {
  it("renders the toast shell and polls from the reporter script", () => {
    const layout = fs.readFileSync(
      path.join(root, "views/hhsrs-reporter/partials/layout-close.ejs"),
      "utf8"
    );
    const layoutOpen = fs.readFileSync(
      path.join(root, "views/hhsrs-reporter/partials/layout-open.ejs"),
      "utf8"
    );
    const pending = fs.readFileSync(path.join(root, "views/hhsrs-reporter/pending.ejs"), "utf8");
    const admin = fs.readFileSync(path.join(root, "views/hhsrs-reporter/admin.ejs"), "utf8");
    const control = fs.readFileSync(
      path.join(root, "views/hhsrs-reporter/partials/desktop-alerts-control.ejs"),
      "utf8"
    );
    const reporterJs = fs.readFileSync(path.join(root, "public/js/hhsrs-reporter.js"), "utf8");
    const sharedJs = fs.readFileSync(path.join(root, "public/js/hhsrs-pending-alerts.js"), "utf8");
    const portalHome = fs.readFileSync(path.join(root, "views/admin.ejs"), "utf8");
    const surveyorHome = fs.readFileSync(path.join(root, "views/surveyor.ejs"), "utf8");
    const partial = fs.readFileSync(path.join(root, "views/partials/pending-alerts.ejs"), "utf8");
    const appScripts = fs.readFileSync(path.join(root, "views/partials/app-scripts.ejs"), "utf8");
    const projects = fs.readFileSync(path.join(root, "views/projects.ejs"), "utf8");
    const project = fs.readFileSync(path.join(root, "views/project.ejs"), "utf8");
    const js = `${reporterJs}\n${sharedJs}`;

    assert.match(layout, /hhsrs-pending-alerts\.js/);
    assert.match(layoutOpen, /hhsrs-pending-alerts\.css/);
    assert.doesNotMatch(reporterJs, /initialPendingIds\.forEach/);
    assert.match(sharedJs, /hhsrsPendingAlertMarker/);
    assert.match(sharedJs, /hhsrsPendingAlertLeader/);
    assert.match(sharedJs, /BroadcastChannel/);
    assert.match(sharedJs, /navigator\.locks/);
    assert.match(sharedJs, /LEADER_TTL_MS = 150000/);
    assert.doesNotMatch(sharedJs, /serviceWorker/);
    assert.match(sharedJs, /Alerts are paused/);
    assert.match(sharedJs, /clearInterval/);
    assert.match(partial, /if \(typeof isAdmin !== "undefined" && isAdmin\)/);
    assert.match(partial, /hhsrs-pending-alerts\.js/);
    assert.match(partial, /New HHSRS case waiting in Pending/);
    assert.match(partial, /surface: "portal"/);
    assert.doesNotMatch(partial, /Enable desktop alerts/);
    assert.doesNotMatch(partial, /desktop-alerts-banner/);
    assert.match(appScripts, /pending-alerts/);
    assert.match(projects, /partials\/app-scripts/);
    assert.match(project, /partials\/app-scripts/);
    assert.match(portalHome, /partials\/pending-alerts/);
    for (const page of [
      "views/photos.ejs",
      "views/photos-archived.ejs",
      "views/photos-project.ejs",
      "views/projects-programme.ejs",
      "views/reference-documents.ejs",
    ]) {
      const source = fs.readFileSync(path.join(root, page), "utf8");
      assert.match(source, /partials\/pending-alerts/, page);
    }
    assert.doesNotMatch(surveyorHome, /hhsrs-pending-alerts/);
    assert.doesNotMatch(surveyorHome, /pending-alerts/);

    assert.match(layout, /id="hhsrs-alert-toast"/);
    assert.match(layout, /class="alert-toast"/);
    assert.match(layout, /initialPendingIds/);
    assert.match(pending, /desktop-alerts-control/);
    assert.doesNotMatch(admin, /desktop-alerts-control/);
    assert.match(admin, /id="admin-alerts-status-text"/);
    assert.match(admin, /Desktop alerts are off/);
    assert.match(admin, /id="btn-admin-enable-desktop-alerts"/);
    assert.match(admin, /id="btn-admin-send-test-alert"/);
    assert.match(admin, /Send test alert/);
    assert.match(
      admin,
      /No pop-up\? Turn on notifications for this browser in Windows Settings > System > Notifications, and make sure Do not disturb is off\./
    );
    assert.match(admin, /Simulate alerts turned off/);
    assert.doesNotMatch(admin, /Desktop alerts ready/);
    assert.match(control, /Enable desktop alerts/);
    assert.match(control, /id="desktop-alerts-banner"/);
    assert.doesNotMatch(control, /Not now/);
    assert.doesNotMatch(control, /Desktop alerts ready/);
    assert.match(js, /pending-alerts\.json/);
    assert.match(js, /new Notification/);
    assert.match(js, /btn-enable-desktop-alerts/);
    assert.match(js, /btn-admin-simulate-alerts-off/);
    assert.match(js, /btn-admin-send-test-alert/);
    assert.match(js, /Test · Project · Rating/);
    assert.match(js, /New HHSRS Hazard/);
    assert.doesNotMatch(js, /New HHSRS hazard/);
    assert.doesNotMatch(js, /HHSRS test alert - if you can see this/);
    assert.doesNotMatch(sharedJs, /Math\.min\(unseen\.length, 3\)/);
    assert.match(js, /Permission not granted — Enable/);
    assert.match(reporterJs, /hhsrs-test-/);
    assert.doesNotMatch(reporterJs, /pending-alerts\.json/);
    assert.match(js, /banner\.hidden = on/);
    assert.doesNotMatch(js, /btn-desktop-alerts-not-now/);
    assert.doesNotMatch(js, /is-ready/);
    assert.doesNotMatch(js, /Desktop alerts ready/);
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

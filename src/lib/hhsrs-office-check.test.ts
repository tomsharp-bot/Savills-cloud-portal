import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findStatusLabel } from "./hhsrs-find.js";
import { mainLogDismissedWhere, type MainLogFilters } from "./hhsrs-main-log.js";
import { mergeReviewDraftFields, statusForReviewSave } from "./hhsrs-reporter.js";
import {
  baselineSurveyorCheck,
  dismissLogLine,
  isOfficeHighRating,
  officeDecisionFields,
  officeDroppedHighRating,
  officeRaisedToHigh,
  officeSendBlocked,
  omitClearedHighExtras,
  projectCollectsCallReference,
  restrictorsAfterOfficeDecision,
  surveyorCheckToStore,
} from "./hhsrs-office-check.js";

const blankFilters = (patch: Partial<MainLogFilters> = {}): MainLogFilters => ({
  q: "",
  project: "",
  by: "",
  type: "",
  from: "",
  to: "",
  sort: "",
  dir: "asc",
  page: 1,
  open: "",
  pageGiven: false,
  ...patch,
});

describe("office rating check", () => {
  it("treats both High wordings as High, and not Severe or a plain High", () => {
    assert.equal(isOfficeHighRating("High - Emergency risk"), true);
    assert.equal(isOfficeHighRating("High - Emergency Risk"), true);
    assert.equal(isOfficeHighRating("High - Significant risk"), true);
    assert.equal(isOfficeHighRating("High - Severe Risk"), false);
    assert.equal(isOfficeHighRating("High"), false);
    assert.equal(isOfficeHighRating("Severe"), false);
    assert.equal(isOfficeHighRating("Medium"), false);
    assert.equal(isOfficeHighRating("Low"), false);
  });

  it("clears the High-only extras when High is dropped to Medium or Low", () => {
    assert.equal(officeDroppedHighRating("High - Emergency risk", "Medium"), true);
    assert.equal(officeDroppedHighRating("High - Significant risk", "Low"), true);
    assert.equal(officeDroppedHighRating("Low", "Medium"), false);
    assert.equal(officeDroppedHighRating("High - Emergency risk", "High - Significant risk"), false);
    const cleared = restrictorsAfterOfficeDecision({
      baselineRating: "High - Emergency risk",
      nextRating: "Medium",
      current: {
        restrictorMissingCount: "2",
        restrictorLocations: "Hall",
        restrictorMaterial: "PVC",
      },
      posted: {
        restrictorMissingCount: "2",
        restrictorLocations: "Hall",
        restrictorMaterial: "PVC",
      },
    });
    assert.deepEqual(cleared, {
      restrictorMissingCount: "",
      restrictorLocations: "",
      restrictorMaterial: "",
    });
  });

  it("drops those bullets from a later email and leaves the other lines in order", () => {
    const body = [
      "Hi all,",
      "",
      "• Address: 1 High Street",
      "• Hazard: Falling Between Levels",
      "• Rating: Medium",
      "• Site notes: Hall window.",
      "• How many window restrictors are missing: 2",
      "• Location: Hall",
      "• Window material: PVC",
      "• Any other details: Tenant home.",
    ].join("\n");
    const next = omitClearedHighExtras(body);
    assert.deepEqual(next.split("\n"), [
      "Hi all,",
      "",
      "• Address: 1 High Street",
      "• Hazard: Falling Between Levels",
      "• Rating: Medium",
      "• Site notes: Hall window.",
      "• Any other details: Tenant home.",
    ]);
    assert.match(next, /Hall window/);
  });

  it("asks for the extra details when Low or Medium is raised to High", () => {
    assert.equal(officeRaisedToHigh("Low", "High - Significant risk"), true);
    assert.equal(officeRaisedToHigh("Medium", "High - Emergency Risk"), true);
    assert.equal(officeRaisedToHigh("High - Emergency risk", "High - Significant risk"), false);
    const gateway = officeDecisionFields({
      projectName: "Gateway 2026",
      baseline: {
        rating: "Low",
        clientCallReference: "",
        callOutcome: "",
        callNotes: "",
        restrictorMissingCount: "",
        restrictorLocations: "",
        restrictorMaterial: "",
      },
      nextRating: "High - Significant risk",
      current: {
        restrictorMissingCount: "",
        restrictorLocations: "",
        restrictorMaterial: "",
        clientCallReference: "",
      },
    });
    assert.deepEqual(
      gateway.map((item) => item.key),
      ["restrictorMissingCount", "restrictorMaterial", "restrictorLocations"]
    );
    assert.equal(gateway.every((item) => item.star && !item.filled), true);
    assert.equal(officeSendBlocked(gateway), true);
    assert.equal(projectCollectsCallReference("Gateway 2026", "High - Emergency risk"), false);
  });

  it("prompts for a call reference only when that project collects one", () => {
    assert.equal(projectCollectsCallReference("Onward 2026", "High - Emergency Risk"), true);
    assert.equal(projectCollectsCallReference("MTVH Pilot 2026", "High - Emergency risk"), true);
    assert.equal(projectCollectsCallReference("MTVH Pilot 2026", "High - Significant risk"), false);
    const onward = officeDecisionFields({
      projectName: "Onward 2026",
      baseline: {
        rating: "Medium",
        clientCallReference: "",
        callOutcome: "",
        callNotes: "",
        restrictorMissingCount: "1",
        restrictorLocations: "Hall",
        restrictorMaterial: "Timber",
      },
      nextRating: "High - Emergency Risk",
      current: {
        restrictorMissingCount: "1",
        restrictorLocations: "Hall",
        restrictorMaterial: "Timber",
        clientCallReference: "",
      },
    });
    const call = onward.find((item) => item.key === "clientCallReference");
    assert.equal(call?.star, true);
    assert.equal(call?.filled, false);
    assert.equal(onward.find((item) => item.key === "restrictorMissingCount")?.star, false);
    assert.equal(officeSendBlocked(onward), true);
    const filled = officeDecisionFields({
      projectName: "Onward 2026",
      baseline: {
        rating: "Medium",
        clientCallReference: "CR-9",
        callOutcome: "",
        callNotes: "",
        restrictorMissingCount: "1",
        restrictorLocations: "Hall",
        restrictorMaterial: "Timber",
      },
      nextRating: "High - Emergency Risk",
      current: {
        restrictorMissingCount: "",
        restrictorLocations: "",
        restrictorMaterial: "",
        clientCallReference: "",
      },
    });
    assert.equal(filled.every((item) => !item.star && item.filled), true);
    assert.equal(officeSendBlocked(filled), false);
  });

  it("keeps the surveyor's answers for the first check and does not replace them later", () => {
    const row = {
      rating: "Low",
      clientCallReference: "",
      callOutcome: "",
      callNotes: "",
      restrictorMissingCount: "",
      restrictorLocations: "",
      restrictorMaterial: "",
    };
    const first = surveyorCheckToStore({}, row);
    assert.equal(first?.rating, "Low");
    const again = surveyorCheckToStore(first, { ...row, rating: "High - Emergency risk" });
    assert.equal(again, null);
    assert.equal(baselineSurveyorCheck(first, { ...row, rating: "High - Emergency risk" }).rating, "Low");
  });

  it("records a dismiss in the Main Log and leaves Pending", () => {
    assert.equal(
      dismissLogLine("Tom Sharp", "Not a hazard — the window is fine."),
      "Viewed by Tom Sharp. Decision: Not a hazard — the window is fine. Dismissed. No email sent."
    );
    assert.equal(findStatusLabel("dismissed"), "Dismissed");
    assert.equal(statusForReviewSave("dismissed", "in_review"), "dismissed");
    assert.equal(mainLogDismissedWhere(blankFilters({ type: "not_sent" })), null);
    const all = mainLogDismissedWhere(blankFilters());
    assert.equal(Array.isArray(all?.AND), true);
  });

  it("omits cleared extras from the draft when the office drops High", () => {
    const row = {
      projectName: "MTVH Pilot 2026",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100",
      surveyDate: "2026-09-20",
      category: "Falling Between Levels",
      rating: "High - Emergency risk",
      comment: "Missing restrictors.",
      clientDescription: "",
      clientCallReference: "CR-9",
      callOutcome: "",
      callNotes: "",
      workOrder: "",
      suspectedCause: "",
      includeCause: true,
      vulnerabilities: "",
      escalation: "",
      onwardTopic: "",
      cat1Confirmed: false,
      otherDetails: "Tenant home.",
      restrictorMissingCount: "2",
      restrictorLocations: "Hall",
      restrictorMaterial: "PVC",
      photoPaths: [],
    };
    const fields = mergeReviewDraftFields(row, {
      projectName: "MTVH Pilot 2026",
      rating: "Medium",
      notes: "Missing restrictors.",
      hazard: "Falling Between Levels",
      restrictorMissingCount: "2",
      restrictorLocations: "Hall",
      restrictorMaterial: "PVC",
      clientCallReference: "CR-9",
      includeCause: true,
    });
    assert.equal(fields.rating, "Medium");
    assert.equal(fields.restrictorMissingCount, "");
    assert.equal(fields.restrictorLocations, "");
    assert.equal(fields.restrictorMaterial, "");
    assert.equal(fields.clientCallReference, "CR-9");
  });
});

describe("office check on case details", () => {
  it("puts Dismiss hazard and the red stars on case details, and leaves the finish bar alone", () => {
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const js = readFileSync("public/js/hhsrs-reporter.js", "utf8");
    const log = readFileSync("views/hhsrs-reporter/main-log.ejs", "utf8");
    const finishAt = review.indexOf('id="rv-finish-bar"');
    const caseAt = review.indexOf('id="rv-case-panel"');
    const dismissAt = review.indexOf('id="btn-dismiss-hazard"');
    assert.ok(caseAt >= 0 && dismissAt > caseAt && dismissAt < finishAt);
    assert.match(review, /Dismiss hazard/);
    assert.match(review, /id="rv-decision"/);
    assert.match(review, /data-office-star="restrictorMissingCount"/);
    assert.match(review, /data-office-star="clientCallReference"/);
    assert.match(review, /id="rv-dismiss-form"/);
    assert.match(js, /function syncOfficeCheck/);
    assert.match(js, /Raised to High/);
    assert.match(js, /Dropped below High/);
    assert.match(js, /Add the decision, then press Dismiss hazard again/);
    assert.match(log, /panel\.kind === "dismissed"/);
    assert.match(log, /Viewed by/);
    const finish = review.slice(finishAt);
    assert.match(finish, /id="btn-not-needed"/);
    assert.match(finish, /id="btn-send-email"/);
    assert.doesNotMatch(finish, /btn-dismiss-hazard/);
  });
});

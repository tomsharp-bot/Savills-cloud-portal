import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatTimeAgo,
  ratingDisplayClass,
  actionedStatusLabel,
  photoAttachmentCount,
  reporterCasePhotos,
  mergeReviewDraftFields,
  draftEmailFromReviewFields,
} from "./hhsrs-reporter.js";
import { matchDemoProject, SITE_FORM_PUBLIC_URL } from "./hhsrs-reporter-projects.js";

describe("HHSRS Reporter UI helpers", () => {
  it("formats relative time-ago under 48 hours as urgent", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    const ago = formatTimeAgo(new Date("2026-09-22T11:48:00Z"), now);
    assert.equal(ago.relative, "12 minutes ago");
    assert.equal(ago.urgent, true);
    assert.match(ago.absolute, /22 Sep 2026/);
  });

  it("uses day wording after 48 hours", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    const ago = formatTimeAgo(new Date("2026-09-19T12:00:00Z"), now);
    assert.equal(ago.relative, "3 days ago");
    assert.equal(ago.urgent, false);
  });

  it("maps rating display classes", () => {
    assert.equal(ratingDisplayClass("High"), "rating-cat1");
    assert.equal(ratingDisplayClass("Cat 2"), "rating-cat2");
    assert.equal(ratingDisplayClass("B"), "");
  });

  it("labels actioned statuses for Main Log", () => {
    assert.equal(actionedStatusLabel("email_sent"), "Pack sent");
    assert.equal(actionedStatusLabel("closed"), "Notice filed");
  });

  it("matches demo project rules by name prefix", () => {
    assert.equal(matchDemoProject("Onward Liverpool 2026")?.template, "Onward");
    assert.equal(matchDemoProject("Vico Homes East")?.extras.vulnerabilities, true);
    assert.equal(matchDemoProject("BPHA East 2026")?.name, "BPHA 2026 ACQ");
    assert.match(matchDemoProject("Saxon Weald 2026 Phase 4")?.hint || "", /damp and mould/);
    assert.doesNotMatch(matchDemoProject("Saxon Weald 2026 Phase 4")?.hint || "", /D&M/);
    assert.equal(matchDemoProject("Unknown Client"), null);
  });

  it("exposes the public site-form URL for Admin copy", () => {
    assert.equal(SITE_FORM_PUBLIC_URL, "https://savillscloudportal.co.uk/HHSRS-site-form");
  });

  it("counts surveyor photos from photoPaths", () => {
    assert.equal(photoAttachmentCount(null), 0);
    assert.equal(photoAttachmentCount(["hhsrs-site-form/a/one.jpg", "  "]), 1);
    assert.equal(photoAttachmentCount(["a.jpg", "b.jpg"]), 2);
  });

  it("builds review photo urls from stored paths", () => {
    const photos = reporterCasePhotos(
      { id: "case 1", photoPaths: ["hhsrs-site-form/case 1/stair nosing.jpg", "x/two.png", "c", "d", "e"] },
      "/HHSRSreporter"
    );
    assert.equal(photos.length, 4);
    assert.equal(photos[0].name, "stair nosing.jpg");
    assert.equal(photos[0].url, "/HHSRSreporter/case%201/photos/stair%20nosing.jpg");
  });

  it("keeps surveyor wording until notes are edited, then drafts on request", () => {
    const row = {
      projectName: "Demo Housing",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "123",
      surveyDate: "2026-09-20",
      category: "Electrical Hazards",
      rating: "High",
      comment: "damaged light fitting in lounge",
      clientDescription: "",
      clientCallReference: "",
      callOutcome: "",
      workOrder: "",
      suspectedCause: "",
      includeCause: true,
      vulnerabilities: "",
      escalation: "",
      onwardTopic: "",
      cat1Confirmed: false,
      photoPaths: ["hhsrs-site-form/x/a.jpg", "hhsrs-site-form/x/b.jpg"],
    };
    const unchanged = mergeReviewDraftFields(row, {
      projectName: "Demo Housing",
      address: "1 High Street, EX1 1AA",
      notes: "damaged light fitting in lounge",
      hazard: "Electrical Hazards",
      rating: "High",
      photoCount: 2,
      includeCause: true,
    });
    assert.equal(unchanged.clientDescription, "");
    assert.equal(unchanged.postcode, "EX1 1AA");
    const draft = draftEmailFromReviewFields(unchanged);
    assert.match(draft.subject, /Demo Housing - HHSRS/);
    assert.match(draft.body, /The light fitting in the lounge is damaged/);
    assert.match(draft.body, /Attached are photos taken from/);

    const edited = mergeReviewDraftFields(row, {
      notes: "Loose socket in the kitchen.",
      rating: "High",
      includeCause: true,
    });
    assert.equal(edited.clientDescription, "Loose socket in the kitchen.");
    assert.match(draftEmailFromReviewFields(edited).body, /Loose socket in the kitchen/);
  });

  it("keeps email photos and amend lock out of the case photo box", () => {
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const pending = readFileSync("views/hhsrs-reporter/pending.ejs", "utf8");
    const sidebar = readFileSync("views/hhsrs-reporter/partials/sidebar.ejs", "utf8");
    const js = readFileSync("public/js/hhsrs-reporter.js", "utf8");
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    const photosAt = review.indexOf('id="rv-photos-block"');
    const generateAt = review.indexOf('id="btn-generate-email"');
    const emailPhotosAt = review.indexOf('id="rv-email-photos"');
    const downloadAt = review.indexOf('id="btn-download-photos"');
    const caseFields = review.slice(review.indexOf('id="rv-case-fields"'), generateAt);
    const photosInFields = caseFields.indexOf('id="rv-photos-block"');
    for (const marker of [
      'id="rv-uprn"',
      'id="rv-address"',
      'id="rv-hazard"',
      'id="rv-rating"',
      'id="rv-notes"',
      'data-extra="calls"',
      'data-extra="survey_date"',
      'data-extra="onward"',
      'data-extra="cause"',
      'data-extra="vulnerabilities"',
      'data-extra="escalation"',
      'data-extra="work_order"',
      'data-extra="online_form"',
      'id="rv-internal-notes"',
    ]) {
      const at = caseFields.indexOf(marker);
      assert.ok(at >= 0 && at < photosInFields, `${marker} sits above the case Photos block`);
    }
    assert.ok(photosAt > 0 && generateAt > photosAt);
    assert.ok(emailPhotosAt > generateAt && downloadAt > emailPhotosAt);
    assert.equal(review.slice(photosAt, generateAt).includes("btn-download-photos"), false);
    assert.equal(review.slice(photosAt, generateAt).includes("Drag a photo"), false);
    assert.match(review, /id="rv-email-photos"[^>]*hidden/);
    assert.match(review, /id="btn-amend-case"[^>]*hidden/);
    assert.match(review, /id="btn-create-plain-email"/);
    assert.match(review, /Create new email/);
    assert.match(review, /value=""/);
    assert.match(pending, /photo-att-col/);
    assert.match(pending, /Review Case/);
    assert.doesNotMatch(sidebar, /side-brand/);
    assert.match(js, /function amendCaseDetails/);
    assert.match(js, /caseLocked = true/);
    assert.match(js, /DownloadURL/);
    assert.doesNotMatch(js, /function stubDraft/);
    assert.match(css, /#rv-case-panel\.is-drafted/);
    assert.match(css, /btn-create-email:hover/);
    assert.match(css, /transform-origin: left top/);
    assert.doesNotMatch(css, /transform-origin:\s*(?:right|center)/);
    assert.doesNotMatch(css, /photo-thumb:(?:first|last|nth)-child[\s\S]{0,180}transform-origin/);
    assert.match(css, /btn-photo-fallback/);
  });
});

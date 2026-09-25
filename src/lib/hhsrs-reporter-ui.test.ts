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
  emailRecipientsFromProject,
} from "./hhsrs-reporter.js";
import { HHSRS_PROJECT_ROSTER, hhsrsKey, matchDemoProject, SITE_FORM_PUBLIC_URL } from "./hhsrs-reporter-projects.js";

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
    assert.equal(ratingDisplayClass("High - Emergency Risk"), "rating-cat1");
    assert.equal(ratingDisplayClass("High - Severe Risk"), "rating-cat1");
    assert.equal(ratingDisplayClass("Severe"), "rating-cat1");
    assert.equal(ratingDisplayClass("Moderate"), "rating-cat2");
    assert.equal(ratingDisplayClass("Slight"), "");
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
    assert.equal(matchDemoProject("MTVH 2026")?.name, "MTVH Pilot 2026");
    assert.equal(matchDemoProject("MTVH 2026")?.extras.calls, false);
    assert.equal(matchDemoProject("MTVH Phase 1 2026")?.extras.calls, false);
    assert.match(matchDemoProject("MTVH Pilot 2026")?.hint || "", /Cat 1 Emergency ring/);
    assert.equal(matchDemoProject("Onward 2026")?.extras.calls, true);
    assert.equal(matchDemoProject("A2D 2026 Phase 4")?.extras.calls, true);
    assert.equal(matchDemoProject("Vico 2026 8k")?.extras.calls, true);
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
    assert.equal(draft.to, "");
    assert.equal(draft.cc, "");
    assert.match(draft.subject, /Demo Housing - HHSRS/);
    assert.match(draft.body, /• Site notes: Damaged light fitting in lounge\./);
    assert.doesNotMatch(draft.body, /The light fitting in the lounge is damaged/);
    assert.match(draft.body, /• Hazard: Electrical Hazards/);
    assert.doesNotMatch(draft.body, /Attached are photos/);
    assert.doesNotMatch(draft.body, /One of our surveyors has visited/);
    assert.doesNotMatch(draft.body, /on the HHSRS/);

    const attempted = mergeReviewDraftFields(
      { ...row, callOutcome: "Attempted", callNotes: "Voicemail full" },
      {
        projectName: "Onward 2026",
        address: "1 High Street, EX1 1AA",
        notes: "Exposed wire to hallway ceiling.",
        hazard: "Electrical Hazards",
        rating: "High",
        callOutcome: "Attempted",
        clientCallReference: "",
        callNotes: "Voicemail full",
        onwardTopic: "Electrical",
        cat1Confirmed: true,
        includeCause: true,
        photoCount: 0,
      }
    );
    const attemptedDraft = draftEmailFromReviewFields(attempted);
    assert.equal(attemptedDraft.to, "");
    assert.equal(attemptedDraft.cc, "");
    assert.match(attemptedDraft.body, /• Onward call: Voicemail full/);
    assert.doesNotMatch(attemptedDraft.body, /couldn't get through/i);

    const edited = mergeReviewDraftFields(row, {
      notes: "Loose socket in the kitchen.",
      rating: "High",
      includeCause: true,
    });
    assert.equal(edited.clientDescription, "Loose socket in the kitchen.");
    assert.match(draftEmailFromReviewFields(edited).body, /Loose socket in the kitchen/);
  });

  it("keeps Test Housing as the only roster address and leaves other projects blank", () => {
    const addressed = HHSRS_PROJECT_ROSTER.filter(
      (project) => project.to.length > 0 || project.cc.length > 0 || (project.bcc?.length ?? 0) > 0
    );
    assert.deepEqual(
      addressed.map((project) => project.name),
      ["Test Housing"]
    );
    assert.deepEqual(addressed[0].to, ["cfarrell@savillshousing.co.uk"]);
    assert.deepEqual(addressed[0].cc, []);

    for (const project of HHSRS_PROJECT_ROSTER) {
      const draft = draftEmailFromReviewFields(
        mergeReviewDraftFields(null, {
          projectName: project.name,
          address: "1 High Street",
          notes: "Loose socket in the kitchen.",
          hazard: "Electrical Hazards",
          rating: "High",
          uprn: "100123",
          surveyDate: "2026-09-20",
          callOutcome: "Attempted",
          callNotes: "Voicemail full",
          onwardTopic: "Electrical",
          cat1Confirmed: true,
          includeCause: true,
          photoCount: 0,
        })
      );
      if (project.name === "Test Housing") {
        assert.equal(draft.to, "cfarrell@savillshousing.co.uk");
      } else {
        assert.equal(draft.to, "", project.name);
      }
      assert.equal(draft.cc, "", project.name);
      assert.equal(draft.bcc, "", project.name);
      assert.equal(draft.to.includes("undefined"), false);
      assert.equal(draft.cc.includes("undefined"), false);
      assert.equal(draft.bcc.includes("undefined"), false);
    }
  });

  it("fills Test Housing To and leaves MTVH blank", () => {
    assert.equal(hhsrsKey("Test Housing"), "Test Housing");
    assert.equal(matchDemoProject("Test Housing")?.name, "Test Housing");
    assert.deepEqual(matchDemoProject("Test Housing")?.to, ["cfarrell@savillshousing.co.uk"]);
    assert.deepEqual(matchDemoProject("Test Housing")?.cc, []);

    const fields = {
      address: "1 High Street",
      notes: "Loose socket in the kitchen.",
      hazard: "Electrical Hazards",
      rating: "High",
      uprn: "100123",
      surveyDate: "2026-09-20",
      includeCause: true,
      photoCount: 0,
    };
    const testHousing = draftEmailFromReviewFields(
      mergeReviewDraftFields(null, { ...fields, projectName: "Test Housing" })
    );
    assert.equal(testHousing.to, "cfarrell@savillshousing.co.uk");
    assert.equal(testHousing.cc, "");

    const mtvh = draftEmailFromReviewFields(
      mergeReviewDraftFields(null, { ...fields, projectName: "MTVH 2026" })
    );
    assert.equal(matchDemoProject("MTVH 2026")?.name, "MTVH Pilot 2026");
    assert.equal(mtvh.to, "");
    assert.equal(mtvh.cc, "");
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
    assert.match(review, /id="rv-email-bcc"/);
    assert.match(review, /id="btn-abandon-claim"/);
    assert.match(review, /id="rv-draft-status"/);
    assert.match(js, /skipDraft \|\| opts\.keepEmail/);
    assert.match(js, /Draft kept — come back anytime until sent or abandoned\./);
    assert.match(js, /hhsrs-review-last-key-v1/);
    assert.doesNotMatch(sidebar, /side-brand/);
    assert.match(review, /id="rv-call-notes" name="callNotes"/);
    assert.match(review, /row\.callNotes/);
    assert.match(js, /callNotes:/);
    assert.match(js, /function amendCaseDetails/);
    assert.match(js, /caseLocked = true/);
    assert.match(js, /DownloadURL/);
    assert.doesNotMatch(js, /function stubDraft/);
    assert.match(css, /#rv-case-panel\.is-drafted/);
    assert.match(css, /btn-create-email:hover/);
    assert.match(css, /\.photos-block\s*\{[^}]*margin-top:\s*1\.35rem/);
    assert.match(css, /\.photo-float-preview[\s\S]*pointer-events:\s*none/);
    assert.doesNotMatch(css, /\.photo-thumb:hover[\s\S]{0,240}transform:\s*scale\(/);
    assert.doesNotMatch(css, /\.email-photo-thumb:hover[\s\S]{0,240}transform:\s*scale\(/);
    assert.match(js, /function showPhotoPreview/);
    assert.match(js, /rv-photo-preview/);
    assert.match(css, /btn-photo-fallback/);
    assert.match(css, /#rv-email-body\s*\{[^}]*min-height:\s*300px/);
    assert.match(css, /#rv-email-body\s*\{[^}]*resize:\s*vertical/);
    assert.match(css, /\[data-copy="rv-email-body"\]\s*\{[^}]*align-self:\s*start/);
    assert.match(css, /\[data-copy="rv-email-body"\]\s*\{[^}]*height:\s*42px/);
  });

  it("paints the tool header as a full-width bar and leaves the navy top bar", () => {
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    assert.match(css, /\.topbar\s*\{[^}]*background:\s*var\(--navy\)/);
    assert.match(css, /\.tool-header\s*\{[^}]*background:\s*#dde2e8/);
    assert.match(css, /\.tool-header\s*\{[^}]*margin:\s*-20px -22px 1rem/);
    assert.match(css, /\.tool-header\s*\{[^}]*border-top-left-radius:\s*var\(--radius-panel\)/);
    assert.match(css, /\.tool-header \.tool-sub[^{]*\{[^}]*color:\s*#526070/);
    assert.match(css, /\.tool-header \.tool-meta\s*\{[^}]*color:\s*#526070/);
    assert.match(css, /\.tool-header \.tool-meta strong\s*\{[^}]*color:\s*var\(--text\)/);
  });

  it("keeps finishing actions in a bottom bar inside the review workspace", () => {
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    const actions = review.slice(review.indexOf('class="actions-row"'), review.indexOf('id="review-workspace"'));
    const workspace = review.slice(review.indexOf('id="review-workspace"'), review.indexOf('class="footer-note"'));
    const gridAt = workspace.indexOf('class="review-grid"');
    const finishAt = workspace.indexOf('id="rv-finish-bar"');
    assert.match(actions, /← Back to Pending Issues/);
    assert.match(actions, /id="btn-create-plain-email"/);
    assert.doesNotMatch(actions, /id="btn-mark-actioned"/);
    assert.doesNotMatch(actions, /id="btn-abandon-claim"/);
    assert.ok(gridAt >= 0 && finishAt > gridAt, "finish bar follows the review grid inside the workspace");
    assert.match(workspace, /id="mark-actioned-form"/);
    assert.match(workspace, /name="expectedUpdatedAt"/);
    assert.match(workspace, /id="abandon-claim-form"/);
    assert.match(workspace, /id="btn-abandon-claim"/);
    assert.match(workspace, /showAbandon \? "" : "hidden"/);
    assert.match(workspace, /Abandon claim — return to pending/);
    assert.match(workspace, /Finished\? Mark it as actioned\./);
    assert.match(workspace, /Mark as actioned → Main Log/);
    assert.match(workspace, /Open a waiting case from Pending Issues first/);
    assert.match(workspace, /disabled title="Open a waiting case from Pending Issues first"/);
    assert.match(review, /<strong>Mark as actioned<\/strong> at the bottom when done\./);
    assert.doesNotMatch(review, /Use <strong>Mark as actioned → Main Log<\/strong> when done/);
    assert.match(css, /#review-workspace\s*\{[^}]*padding-bottom:\s*85vh/);
    assert.match(css, /\.finish-bar\s*\{[^}]*background:\s*var\(--surface\)/);
    assert.match(css, /\.finish-bar\s*\{[^}]*border-radius:\s*var\(--radius\)/);
    assert.match(css, /\.finish-bar \.btn\s*\{[^}]*min-height:\s*var\(--tap\)/);
    assert.match(css, /@media \(max-width:\s*720px\)\s*\{[^}]*\.finish-bar\s*\{[^}]*flex-direction:\s*column-reverse/);
    assert.match(css, /\.finish-bar-right \.finish-hint\s*\{[^}]*order:\s*2/);
    assert.match(css, /\.finish-bar \.btn\s*\{[^}]*width:\s*100%/);
  });

  it("fills Bcc from project settings the same way as To and Cc", () => {
    const js = readFileSync("public/js/hhsrs-reporter.js", "utf8");
    const fill = js.slice(js.indexOf("function fillDraftFields"), js.indexOf("function generateEmail"));
    assert.match(fill, /bccEl\.value = draft\.bcc \|\| ""/);
    assert.deepEqual(
      emailRecipientsFromProject({
        to: ["to@example.com"],
        cc: ["cc1@example.com", "cc2@example.com"],
        bcc: ["bcc@example.com"],
      }),
      {
        to: "to@example.com",
        cc: "cc1@example.com; cc2@example.com",
        bcc: "bcc@example.com",
      }
    );
    assert.equal(emailRecipientsFromProject({ to: ["to@example.com"], cc: ["cc@example.com"] }).bcc, "");
    assert.equal(emailRecipientsFromProject(null).bcc, "");
    const gateway = draftEmailFromReviewFields({
      projectName: "Gateway 2026",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "123",
      surveyDate: "2026-09-20",
      category: "Electrical Hazards",
      rating: "High",
      comment: "damaged light fitting in lounge",
      clientDescription: "damaged light fitting in lounge",
      photoCount: 0,
    });
    assert.equal(gateway.to, "");
    assert.equal(gateway.cc, "");
    assert.equal(gateway.bcc, "");

    for (const project of HHSRS_PROJECT_ROSTER) {
      if (project.name === "Test Housing") continue;
      const recipients = emailRecipientsFromProject(project);
      assert.equal(recipients.to, "", project.name);
      assert.equal(recipients.cc, "", project.name);
      assert.equal(recipients.bcc, "", project.name);
      const draft = draftEmailFromReviewFields(
        mergeReviewDraftFields(null, {
          projectName: project.name,
          address: "1 High Street",
          notes: "Loose socket in the kitchen.",
          hazard: "Electrical Hazards",
          rating: "High",
          uprn: "100123",
          surveyDate: "2026-09-20",
          callOutcome: "Attempted",
          callNotes: "Voicemail full",
          onwardTopic: "Electrical",
          cat1Confirmed: true,
          includeCause: true,
          photoCount: 0,
        })
      );
      assert.equal(draft.to, "", project.name);
      assert.equal(draft.cc, "", project.name);
      assert.equal(draft.bcc, "", project.name);
    }
    const testHousing = emailRecipientsFromProject(matchDemoProject("Test Housing"));
    assert.equal(testHousing.to, "cfarrell@savillshousing.co.uk");
    assert.equal(testHousing.cc, "");
    assert.equal(testHousing.bcc, "");
  });

  it("declares review draft storage keys before restore runs", () => {
    const js = readFileSync("public/js/hhsrs-reporter.js", "utf8");
    const draftsAt = js.indexOf('var REVIEW_DRAFTS_KEY = "hhsrs-review-drafts-v1"');
    const lastAt = js.indexOf('var REVIEW_LAST_KEY = "hhsrs-review-last-key-v1"');
    const resumeAt = js.indexOf("var reviewLeavingForResume = initReviewResume()");
    const restoreAt = js.indexOf("restoreReviewDraft(reviewDraftKey())");
    assert.ok(draftsAt >= 0 && lastAt > draftsAt);
    assert.ok(lastAt < resumeAt && draftsAt < restoreAt);
  });
});

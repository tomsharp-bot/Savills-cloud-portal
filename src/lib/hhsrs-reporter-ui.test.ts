import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatTimeAgo,
  ratingDisplayClass,
  actionedStatusLabel,
  statusForReviewSave,
  photoAttachmentCount,
  reporterCasePhotos,
  mergeReviewDraftFields,
  draftEmailFromReviewFields,
  emailRecipientsFromProject,
  readReporterUpdate,
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
    assert.equal(matchDemoProject("Leeds Fed HA 2026")?.name, "LFHA (Leeds)");
    assert.equal(matchDemoProject("Leeds Fed HA 2026")?.template, "LFHA");
    assert.equal(matchDemoProject("Leeds Federation")?.name, "LFHA (Leeds)");
    assert.equal(matchDemoProject("Leeds"), null);
    assert.equal(matchDemoProject("Onward (Leeds)")?.template, "Onward");
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
      escalation: "Significant Severe",
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
    assert.match(draft.body, /• Rating: High/);
    assert.doesNotMatch(draft.body, /Escalation/);
    assert.match(draft.body, /• Survey date: 20\/09\/2026/);
    assert.doesNotMatch(draft.body, /2026-09-20/);
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
      'data-extra="work_order"',
      'data-extra="online_form"',
      'id="rv-internal-notes"',
    ]) {
      const at = caseFields.indexOf(marker);
      assert.ok(at >= 0 && at < photosInFields, `${marker} sits above the case Photos block`);
    }
    assert.equal(caseFields.includes("Escalation category"), false);
    assert.equal(caseFields.includes('id="rv-escalation"'), false);
    assert.match(caseFields, /<label for="rv-rating">Rating<\/label>/);
    assert.ok(photosAt > 0 && generateAt > photosAt);
    assert.ok(emailPhotosAt > generateAt && downloadAt > emailPhotosAt);
    assert.equal(review.slice(photosAt, generateAt).includes("btn-download-photos"), false);
    assert.equal(review.slice(photosAt, generateAt).includes("Drag a photo"), false);
    assert.match(review, /id="rv-email-photos"[^>]*hidden/);
    assert.match(review, /id="btn-amend-case"[^>]*hidden/);
    assert.match(review, /id="btn-create-plain-email"/);
    assert.match(review, /Create new email/);
    assert.match(review, /value=""/);
    const pendingTable = readFileSync("views/hhsrs-reporter/partials/pending-issues-table.ejs", "utf8");
    assert.match(pending, /partials\/pending-issues-table/);
    assert.match(pendingTable, /photo-att-col/);
    assert.match(pendingTable, /Review Case/);
    assert.match(review, /id="hhsrs-bcc"/);
    assert.match(review, /id="btn-abandon-claim"/);
    assert.match(review, /id="rv-draft-status"/);
    assert.match(js, /skipDraft \|\| opts\.keepEmail/);
    assert.match(js, /Draft kept — come back anytime until sent or abandoned\./);
    assert.match(js, /hhsrs-review-last-key-v1/);
    assert.doesNotMatch(sidebar, /side-brand/);
    assert.match(review, /data-extra="cause">/);
    assert.doesNotMatch(review, /data-extra="cause"[^>]*\bhidden\b/);
    assert.match(js, /key === "cause" \? false : !extras\[key\]/);
    assert.match(review, /id="rv-cause" name="suspectedCause"/);
    assert.match(review, /id="rv-include-cause"/);
    assert.match(review, /id="rv-call-notes" name="callNotes"/);
    assert.match(review, /callBlank\.note/);
    const callRefAt = review.indexOf("Client call reference");
    const callWhyAt = review.indexOf("Why the call reference is blank");
    assert.ok(callRefAt >= 0 && callWhyAt > callRefAt);
    assert.doesNotMatch(review, /for="rv-call-status"/);
    assert.match(review, /id="rv-call-reason" name="callRefBlankReason"/);
    assert.match(review, /callBlankReasons/);
    assert.match(review, /Extra detail/);
    assert.match(js, /callNotes:/);
    assert.match(js, /function syncCallRefFields/);
    assert.match(js, /function composeBlankCallNotes/);
    assert.doesNotMatch(js, /rv-call-status/);
    assert.match(css, /#rv-call-blank\[hidden\]/);
    assert.match(js, /function amendCaseDetails/);
    assert.match(js, /caseLocked = true/);
    assert.match(js, /photos\.hidden = caseLocked && cfg\.mode !== "filled"/);
    assert.match(js, /DownloadURL/);
    assert.doesNotMatch(js, /function stubDraft/);
    assert.match(css, /#rv-case-panel\.is-drafted #rv-case-fields/);
    assert.match(css, /#rv-case-panel\.is-sent-case #rv-case-fields/);
    assert.match(css, /#rv-case-panel\.is-drafted #rv-photos-block img/);
    assert.match(css, /#rv-case-panel\.is-sent-case #rv-photos-block img[\s\S]*filter:\s*grayscale\(1\)/);
    assert.match(css, /\.email-draft-panel\.is-sent-lock \.field-with-copy/);
    assert.match(review, /is-sent-case/);
    assert.match(review, /is-sent-lock/);
    assert.match(review, /sentEmail \? "disabled"/);
    assert.match(js, /function lockSentEmailFields/);
    assert.match(js, /fields\.inert = sent/);
    assert.match(js, /if \(sentStage\(\)\) return/);
    assert.match(css, /is-sent-case \.generate-email-row button:disabled/);
    assert.match(css, /btn-create-email:hover/);
    assert.match(css, /\.photos-block\s*\{[^}]*margin-top:\s*1\.35rem/);
    assert.match(css, /\.photo-float-preview[\s\S]*pointer-events:\s*none/);
    assert.doesNotMatch(css, /\.photo-thumb:hover[\s\S]{0,240}transform:\s*scale\(/);
    assert.doesNotMatch(css, /\.email-photo-thumb:hover[\s\S]{0,240}transform:\s*scale\(/);
    assert.match(js, /function showPhotoPreview/);
    assert.match(js, /rv-photo-preview/);
    assert.match(css, /btn-photo-fallback/);
    assert.match(css, /#hhsrs-body\s*\{[^}]*min-height:\s*300px/);
    assert.match(css, /#hhsrs-body\s*\{[^}]*resize:\s*vertical/);
    assert.match(css, /\[data-copy="hhsrs-body"\]\s*\{[^}]*align-self:\s*start/);
    assert.match(css, /\[data-copy="hhsrs-body"\]\s*\{[^}]*height:\s*42px/);
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
    assert.match(actions, /id="btn-abandon-claim"/);
    assert.match(actions, /Abandon claim — return to pending/);
    assert.match(actions, /showAbandon \? "" : "hidden"/);
    assert.ok(gridAt >= 0 && finishAt > gridAt, "finish bar follows the review grid inside the workspace");
    const finish = workspace.slice(finishAt);
    assert.match(finish, /id="btn-send-email"/);
    assert.match(finish, /Send and log/);
    assert.match(finish, /id="btn-not-needed"/);
    assert.match(finish, /Not needed/);
    assert.match(finish, /Duplicate, error or test/);
    assert.match(finish, /Sends the email and adds it to the Main Log/);
    assert.doesNotMatch(finish, /id="btn-abandon-claim"/);
    assert.match(review, /Move to Duplicates &amp; errors\?/);
    assert.match(review, /Nothing is deleted\. You can move it back\./);
    assert.match(review, /showNotNeeded/);
    assert.doesNotMatch(workspace, /id="mark-actioned-form"/);
    assert.doesNotMatch(workspace, /id="btn-mark-actioned"/);
    assert.doesNotMatch(workspace, /Mark as actioned/);
    assert.doesNotMatch(workspace, /Finished\? Mark it as actioned/);
    assert.match(workspace, /name="expectedUpdatedAt"/);
    assert.doesNotMatch(workspace, /id="abandon-claim-form"/);
    assert.match(workspace, /btn-copy/);
    assert.match(workspace, /Download photos/);
    assert.match(review, /Check before sending/);
    assert.match(review, /I've checked the details/);
    assert.match(review, /id="ck-send"[^>]*>Send and log</);
    assert.match(review, /Nothing is sent until you press Send and log\./);
    assert.doesNotMatch(review, /Send now/);
    assert.match(review, /id="rv-email-from"/);
    assert.doesNotMatch(review, /Copy into Outlook/);
    assert.doesNotMatch(review, /Use <strong>Mark as actioned → Main Log<\/strong> when done/);
    assert.doesNotMatch(review, /Attach photos in Outlook/);
    const pending = readFileSync("views/hhsrs-reporter/pending.ejs", "utf8");
    assert.match(pending, /Cases move to Main Log when you press Send and log\./);
    assert.doesNotMatch(pending, /Mark as actioned/);
    const js = readFileSync("public/js/hhsrs-reporter.js", "utf8");
    assert.match(js, /Start a new email\? Your unsent draft will be cleared\./);
    assert.match(js, /Sends the email and adds it to the Main Log\./);
    assert.doesNotMatch(js, /Open a case before sending/);
    assert.doesNotMatch(js, /mark-actioned-form/);
    assert.doesNotMatch(js, /Mark this case as actioned/);
    assert.equal(statusForReviewSave("in_review", "email_sent"), "in_review");
    assert.equal(statusForReviewSave("in_review", "closed"), "in_review");
    assert.equal(statusForReviewSave("in_review", "corrected"), "in_review");
    assert.equal(statusForReviewSave("new", "email_sent"), "in_review");
    assert.equal(statusForReviewSave("new", "in_review"), "in_review");
    assert.equal(statusForReviewSave("in_review", "email_ready"), "email_ready");
    assert.equal(statusForReviewSave("email_ready", "closed"), "email_ready");
    assert.equal(statusForReviewSave("email_sent", "in_review"), "email_sent");
    assert.equal(statusForReviewSave("corrected", "closed"), "corrected");
    assert.equal(statusForReviewSave("closed", "in_review"), "closed");
    assert.equal(statusForReviewSave("not_needed", "in_review"), "not_needed");
    assert.equal(statusForReviewSave("not_needed", "email_sent"), "not_needed");
    assert.match(css, /#review-workspace\s*\{[^}]*padding-bottom:\s*85vh/);
    assert.match(css, /\.finish-bar\s*\{[^}]*position:\s*static/);
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

  it("shares one pending-issues table between Pending Issues and Review and create", () => {
    const pending = readFileSync("views/hhsrs-reporter/pending.ejs", "utf8");
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const table = readFileSync("views/hhsrs-reporter/partials/pending-issues-table.ejs", "utf8");
    const waiting = pending.slice(pending.indexOf('id="not-actioned"'), pending.indexOf('id="last-actioned"'));
    const also = review.slice(review.indexOf('id="rv-also-waiting"'), review.indexOf('id="rv-project-block"'));
    assert.match(waiting, /partials\/pending-issues-table/);
    assert.match(also, /partials\/pending-issues-table/);
    assert.doesNotMatch(waiting, /<thead>/);
    assert.doesNotMatch(also, /<thead>/);
    const head = table.slice(table.indexOf("<thead>"), table.indexOf("</thead>"));
    const headers = [...head.matchAll(/<th[^>]*>([^<]*)/g)].map((match) => match[1].trim()).filter(Boolean);
    assert.deepEqual(headers, ["Reference", "Project", "Address", "Photos", "UPRN", "Surveyor", "Category", "Rating", "Received"]);
    assert.match(table, /row\.reference/);
    assert.match(table, /ref-chip/);
    assert.match(table, /row\.uprn/);
    assert.match(table, /row\.surveyorName/);
    assert.match(table, /row\.rating/);
    assert.match(table, /photo-att-cell/);
    assert.match(table, /Review Case/);
    assert.match(table, />Amend</);

    const last = pending.slice(pending.indexOf('id="last-actioned"'));
    const find = readFileSync("views/hhsrs-reporter/find.ejs", "utf8");
    const main = readFileSync("views/hhsrs-reporter/main-log.ejs", "utf8");
    assert.match(last, /partials\/pending-issues-table/);
    assert.doesNotMatch(last, /<thead>/);
    assert.match(find, /partials\/pending-issues-table/);
    assert.match(find, /pendingAction:\s*"amend"/);
    assert.doesNotMatch(find, /<th>Hazard<\/th>|<th>Status<\/th>/);
    assert.match(main, /partials\/pending-issues-table/);
    assert.doesNotMatch(main, /<th>Sent<\/th>|<th>Hazard<\/th>/);
  });

  it("turns browser autofill off on email compose fields", () => {
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const find = readFileSync("views/hhsrs-reporter/find.ejs", "utf8");
    const card = readFileSync("views/hhsrs-reporter/partials/client-email-card.ejs", "utf8");
    function tagWithId(html: string, id: string): string {
      const match = html.match(new RegExp(`<(?:input|textarea)\\b[^>]*\\bid="${id}"[^>]*>`));
      assert.ok(match, `missing ${id}`);
      return match[0];
    }
    for (const id of ["hhsrs-to", "hhsrs-cc", "hhsrs-bcc", "hhsrs-subject", "hhsrs-body"]) {
      const tag = tagWithId(review, id);
      assert.match(tag, /autocomplete="off"/, id);
      assert.match(tag, new RegExp(`name="${id}"`), id);
      assert.doesNotMatch(tag, /type="email"/, id);
    }
    for (const id of ["hhsrs-to", "hhsrs-cc", "hhsrs-bcc"]) {
      const tag = tagWithId(review, id);
      assert.match(tag, /type="text"/, id);
      assert.match(tag, /inputmode="email"/, id);
    }
    assert.match(review, /id="rv-email-form"[^>]*autocomplete="off"/);
    assert.match(review, /id="rv-send-form"[^>]*autocomplete="off"/);
    assert.match(find, /id="rv-send-form"[^>]*autocomplete="off"/);
    assert.doesNotMatch(find, /type="email"/);
    for (const id of ["f-address", "f-uprn", "f-notes", "f-date", "f-amendment", "f-hazard", "f-rating"]) {
      const tag = find.match(new RegExp(`<(?:input|select)\\b[^>]*\\bid="${id}"[^>]*>`));
      assert.ok(tag, id);
      assert.match(tag[0], /autocomplete="off"/, id);
    }
    for (const id of ["rv-send-to", "rv-send-cc", "rv-send-bcc", "rv-send-subject", "rv-send-body"]) {
      assert.match(tagWithId(review, id), /autocomplete="off"/, id);
    }
    assert.match(card, /class="client-email-row"[^>]*autocomplete="off"/);
    for (const name of ["hhsrs-to", "hhsrs-cc", "hhsrs-bcc"]) {
      const tag = card.match(new RegExp(`<textarea\\b[^>]*\\bname="${name}"[^>]*>`));
      assert.ok(tag, name);
      assert.match(tag[0], /autocomplete="off"/, name);
      assert.match(tag[0], /inputmode="email"/, name);
    }
    assert.doesNotMatch(card, /name="to"|name="cc"|name="bcc"/);
  });

  it("saves a call reference ahead of a blank reason, and composes the reason when the ref is empty", () => {
    const withRef = readReporterUpdate({
      clientCallReference: " CR-9 ",
      callRefBlankReason: "No answer",
      callNotes: "ignored",
    });
    assert.equal(withRef.clientCallReference, "CR-9");
    assert.equal(withRef.callOutcome, "");
    assert.equal(withRef.callNotes, "");

    const blank = readReporterUpdate({
      clientCallReference: "  ",
      callRefBlankReason: "Engaged/busy",
      callNotes: "Line stayed busy",
    });
    assert.equal(blank.clientCallReference, "");
    assert.equal(blank.callOutcome, "Attempted");
    assert.equal(blank.callNotes, "Engaged/busy — Line stayed busy");

    const other = readReporterUpdate({
      clientCallReference: "",
      callRefBlankReason: "Other",
      callNotes: "Voicemail full.",
    });
    assert.equal(other.callOutcome, "Attempted");
    assert.equal(other.callNotes, "Other — Voicemail full.");

    const legacy = readReporterUpdate({
      clientCallReference: "",
      callOutcome: "Attempted",
      callNotes: "Voicemail full",
    });
    assert.equal(legacy.callOutcome, "Attempted");
    assert.equal(legacy.callNotes, "Voicemail full");
  });

  it("wraps Main Log names on word boundaries and keeps address and hazard readable", () => {
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    const view = readFileSync("views/hhsrs-reporter/main-log.ejs", "utf8");
    const clamp = css.slice(css.indexOf(".ml-clamp {"), css.indexOf(".ml-clamp {") + 420);
    assert.match(clamp, /-webkit-line-clamp:\s*2/);
    assert.match(clamp, /line-clamp:\s*2/);
    assert.match(clamp, /overflow-wrap:\s*normal/);
    assert.doesNotMatch(clamp, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(clamp, /word-break:\s*break-all/);
    const addr = css.slice(css.indexOf(".ml-addr {"), css.indexOf(".ml-addr {") + 220);
    const hazard = css.slice(css.indexOf(".ml-hazard {"), css.indexOf(".ml-hazard {") + 180);
    assert.match(addr, /overflow-wrap:\s*normal/);
    assert.match(hazard, /overflow-wrap:\s*normal/);
    assert.doesNotMatch(addr, /overflow-wrap:\s*anywhere|word-break:\s*break-all/);
    assert.doesNotMatch(hazard, /overflow-wrap:\s*anywhere|word-break:\s*break-all/);
    assert.match(css, /\.ml-to \.ml-clamp \{[^}]*line-clamp:\s*3/);
    assert.match(css, /\.ml-page \.ml-table col\.c-addr \{ width: 150px; \}/);
    assert.match(css, /\.ml-page \.ml-table col\.c-haz \{ width: 120px; \}/);
    assert.match(css, /\.ml-page \.ml-table \{[^}]*font-size:\s*13px/);
    assert.match(css, /\.ml-page \.ml-table thead th \{[^}]*white-space:\s*nowrap/);
    assert.doesNotMatch(css, /\.ml-proj\s*\{[^}]*white-space:\s*nowrap/);
    assert.doesNotMatch(css, /\.ml-by\s*\{[^}]*white-space:\s*nowrap/);
    assert.doesNotMatch(css, /\.ml-to\s*\{[^}]*white-space:\s*nowrap/);
    assert.match(css, /\.ml-page \.ml-table thead th\.ml-ph \{[^}]*white-space:\s*nowrap/);
    assert.match(view, /partials\/pending-issues-table/);
    assert.match(view, /photoNames/);
    assert.match(view, /class="panel"/);
    assert.doesNotMatch(view, /<th>Sent<\/th>|<th>To<\/th>/);
    assert.match(css, /\.ml-page \.pending-issues-table \{[^}]*font-size:\s*0\.8125rem/);
    assert.match(css, /\.ml-page \.pending-issues-table thead th \{[^}]*font-size:\s*0\.6875rem/);
    assert.match(css, /\.ml-page \.pending-issues-table \.ref-chip \{[^}]*font-size:\s*12\.5px/);
    assert.match(css, /\.hhsrs-reporter \.pending-issues-wrap \{[^}]*overflow-x:\s*hidden/);
    assert.match(css, /\.hhsrs-reporter \.pending-issues-table col\.c-act \{ width: 12%; \}/);
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

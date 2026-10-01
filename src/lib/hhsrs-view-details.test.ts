import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildViewDetails, correctionParties, CORRECTION_FROM_ADDRESS } from "./hhsrs-view-details.js";

describe("correction email parties", () => {
  it("shows From, the existing To, and Cc only when that email already has one", () => {
    assert.deepEqual(correctionParties({ to: "client@example.com", cc: "cc@example.com" }), [
      { label: "From", value: CORRECTION_FROM_ADDRESS },
      { label: "To", value: "client@example.com" },
      { label: "Cc", value: "cc@example.com" },
    ]);
    assert.equal(CORRECTION_FROM_ADDRESS, "hhsrs@savillshousing.co.uk");
    assert.deepEqual(
      correctionParties({ to: " client@example.com ", cc: "  " }).map((line) => line.label),
      ["From", "To"]
    );
  });

  it("puts those lines on the original send and on a sent correction", () => {
    const details = buildViewDetails({
      projectName: "Gateway 2026",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "1",
      surveyDate: "2026-09-20",
      surveyorName: "Sam",
      hazard: "Damp",
      rating: "High",
      description: "Damp ceiling",
      submissionId: "case-1",
      photoPaths: [],
      surveyorPhotos: [],
      reporterBase: "/HHSRSreporter",
      emails: [
        {
          kind: "original",
          subject: "Gateway - HHSRS",
          body: "Hi all,\n\n• Address: 1 High Street",
          photoNames: [],
          to: "original@example.com",
          cc: "orig-cc@example.com",
        },
        {
          kind: "correction",
          subject: "Gateway - HHSRS",
          body: "Please disregard our previous email, due to an error. See correct details below.\n\n• Address: 2 High Street",
          photoNames: [],
          to: "client@example.com",
          cc: "",
        },
      ],
    });
    assert.deepEqual(details.sent?.parties, [
      { label: "From", value: "hhsrs@savillshousing.co.uk" },
      { label: "To", value: "original@example.com" },
      { label: "Cc", value: "orig-cc@example.com" },
    ]);
    assert.equal(details.corrections.length, 1);
    assert.deepEqual(details.corrections[0].parties, [
      { label: "From", value: "hhsrs@savillshousing.co.uk" },
      { label: "To", value: "client@example.com" },
    ]);
    assert.doesNotMatch(details.corrections[0].copyHtml, /hhsrs@savillshousing/);
    assert.doesNotMatch(details.sent?.copyHtml || "", /hhsrs@savillshousing/);
  });

  it("leaves a send with no stored recipient blank instead of inventing one", () => {
    const details = buildViewDetails({
      projectName: "Test Housing",
      fullAddress: "Test, Testing, TE1 3ST",
      postcode: "",
      uprn: "Gdk",
      surveyDate: "2026-09-30",
      surveyorName: "Admin",
      hazard: "Damp & Mould Growth",
      rating: "High - Emergency risk",
      description: "Vxhb",
      submissionId: "case-blank",
      photoPaths: [],
      surveyorPhotos: [],
      reporterBase: "/HHSRSreporter",
      emails: [
        {
          kind: "original",
          subject: "Test Housing - HHSRS",
          body: "Hi all,\n\n• Address: Test, Testing, TE1 3ST",
          photoNames: [],
          to: "  ",
          cc: "",
        },
      ],
    });
    assert.deepEqual(details.sent?.parties, [
      { label: "From", value: CORRECTION_FROM_ADDRESS },
      { label: "To", value: "" },
    ]);
    assert.equal(details.sent?.parties.some((line) => line.label === "Cc" || line.label === "Bcc"), false);
  });
});

describe("correction preview markup", () => {
  it("shows From and To on the correction preview and both View details cards", () => {
    const find = readFileSync("views/hhsrs-reporter/find.ejs", "utf8");
    const details = readFileSync("views/hhsrs-reporter/view-details.ejs", "utf8");
    const route = readFileSync("src/routes/hhsrs-reporter.ts", "utf8");
    const preview = find.slice(find.indexOf('id="fr-preview"'), find.indexOf('id="fr-preview-copy"'));
    assert.match(preview, /id="fr-preview-parties"/);
    assert.match(preview, /From<\/span> hhsrs@savillshousing\.co\.uk/);
    assert.match(preview, /To<\/span> <%= amend\.to %>/);
    assert.match(preview, /amend\.cc/);
    assert.doesNotMatch(preview, /amend\.bcc/);
    const emailAt = details.indexOf(">Email sent<");
    const correctionAt = details.indexOf(">Correction<");
    const sentCard = details.slice(emailAt, correctionAt);
    assert.match(sentCard, /details\.sent\.parties/);
    assert.match(sentCard, /vd-parties/);
    assert.match(details.slice(correctionAt), /email\.parties/);
    assert.doesNotMatch(details.slice(details.indexOf(">Surveyor entry<"), emailAt), /vd-parties/);
    const handler = route.slice(route.indexOf('"/main-log/:id/details"'), route.indexOf('hhsrsReporterRouter.get("/main-log/:id"'));
    assert.match(handler, /listSentEmails\(row\.id\)/);
    assert.match(handler, /to: email\.to/);
    assert.match(handler, /cc: email\.cc/);
    assert.doesNotMatch(handler, /clientRecipients|HhsrsClientEmail|recipientsFromStoredOrCode/);
  });
});

describe("view details layout", () => {
  it("keeps the surveyor entry and the sent email side by side, with thumbnail photos", () => {
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    const details = readFileSync("views/hhsrs-reporter/view-details.ejs", "utf8");
    const pair = css.slice(css.indexOf(".vd-page .vd-pair {"), css.indexOf(".vd-page .vd-pair {") + 220);
    assert.match(pair, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/);
    assert.match(css, /\.vd-page \.vd-shot img,[\s\S]*\.vd-photo \{[^}]*width:\s*96px;[^}]*height:\s*72px;/);
    assert.doesNotMatch(css, /\.vd-shot,\s*\.vd-photo\s*\{[^}]*max-width:\s*100%/s);
    const stack = css.slice(css.lastIndexOf("@media"));
    assert.doesNotMatch(stack, /max-width:\s*860px[\s\S]*\.vd-pair/);
    const surveyor = details.slice(details.indexOf(">Surveyor entry<"), details.indexOf(">Email sent<"));
    const email = details.slice(details.indexOf(">Email sent<"), details.indexOf(">Correction<"));
    assert.match(surveyor, /class="photo-thumb"><img[\s\S]*?width="96" height="72"/);
    assert.match(email, /class="vd-shot"/);
    assert.match(email, /class="photo-thumb"><img class="vd-photo"[\s\S]*?width="96" height="72"/);
    assert.ok(details.indexOf(">Surveyor entry<") < details.indexOf(">Email sent<"));
    assert.ok(details.indexOf(">Email sent<") < details.indexOf(">Correction<"));
  });
});

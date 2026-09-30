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

  it("puts those lines on a sent correction and leaves the original email without them", () => {
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
    assert.deepEqual(details.sent?.parties, []);
    assert.equal(details.corrections.length, 1);
    assert.deepEqual(details.corrections[0].parties, [
      { label: "From", value: "hhsrs@savillshousing.co.uk" },
      { label: "To", value: "client@example.com" },
    ]);
    assert.doesNotMatch(details.corrections[0].copyHtml, /hhsrs@savillshousing/);
  });
});

describe("correction preview markup", () => {
  it("shows From and To on the correction preview and the View details correction", () => {
    const find = readFileSync("views/hhsrs-reporter/find.ejs", "utf8");
    const details = readFileSync("views/hhsrs-reporter/view-details.ejs", "utf8");
    const preview = find.slice(find.indexOf('id="fr-preview"'), find.indexOf('id="fr-preview-copy"'));
    assert.match(preview, /id="fr-preview-parties"/);
    assert.match(preview, /From<\/span> hhsrs@savillshousing\.co\.uk/);
    assert.match(preview, /To<\/span> <%= amend\.to %>/);
    assert.match(preview, /amend\.cc/);
    assert.doesNotMatch(preview, /amend\.bcc/);
    const correctionAt = details.indexOf(">Correction<");
    assert.match(details.slice(correctionAt), /email\.parties/);
    assert.doesNotMatch(details.slice(0, correctionAt), /vd-parties/);
  });
});

describe("view details layout", () => {
  it("keeps the surveyor entry and the sent email side by side, with thumbnail photos", () => {
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    const pair = css.slice(css.indexOf(".vd-pair {"), css.indexOf(".vd-pair {") + 180);
    assert.match(pair, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/);
    assert.match(css, /\.vd-shot img, \.vd-photo \{[^}]*width:\s*96px;[^}]*height:\s*72px;/s);
    assert.doesNotMatch(css, /\.vd-shot,\s*\.vd-photo\s*\{[^}]*max-width:\s*100%/s);
    const stack = css.slice(css.lastIndexOf("@media"));
    assert.doesNotMatch(stack, /max-width:\s*860px[\s\S]*\.vd-pair/);
  });
});

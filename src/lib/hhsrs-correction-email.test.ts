import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  amendmentListError,
  buildAmendmentEmail,
  parseSentEmail,
  prepareCorrectionEmail,
  stripCorrectionIntro,
} from "./hhsrs-correction-email.js";
import { correctionSubject } from "./hhsrs-find.js";
import { deliverPortalEmail, type OutboundEmail, type SendCommit, type SentEmailRecord } from "./hhsrs-send.js";
import { SIGNATURE_LOGO_CID, composeEmailHtml, composeEmailText } from "./hhsrs-signature.js";

const NAMES = { firstName: "", fullName: "" };

const SUBJECT = "CORRECTION: MTVH 2026 - HHSRS – 14 Example Street, London";
const PREVIOUS_SUBJECT = "MTVH 2026 - HHSRS – 14 Example Street, London";

const ORIGINAL = [
  "Hi all,",
  "",
  "• Address: 14 Example Street, London",
  "• UPRN: 100012345678",
  "• Hazard: Damp and Mould Growth",
  "• Rating: High - Emergency Risk",
  "• Site notes: Damp to the bedroom ceiling.",
  "• Survey date: 28/09/2026",
].join("\n");

function replaceBullet(body: string, label: string, value: string): string {
  return body
    .split("\n")
    .map((line) => (line.startsWith(`• ${label}:`) ? `• ${label}: ${value}` : line))
    .join("\n");
}

const base = {
  previousTo: "client@example.com",
  nextTo: "client@example.com",
  previousPhotos: ["bedroom-ceiling.jpg"] as readonly string[],
  nextPhotos: ["bedroom-ceiling.jpg"] as readonly string[],
  note: "",
};

function htmlLines(messageHtml: string): string[] {
  return messageHtml.split("<br>\n");
}

function bulletLine(messageHtml: string, label: string): string {
  return htmlLines(messageHtml).find((line) => line.includes(`• ${label}:`)) || "";
}

describe("HHSRS correction email wording", () => {
  it("corrects an address, bolds the new value, and leaves the old address in the subject", () => {
    const next = replaceBullet(ORIGINAL, "Address", "15 Example Street, London");
    const prepared = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: next,
      reason: "Wrong address",
    });
    assert.equal(
      prepared.text,
      [
        "Please disregard our previous email, due to an error. See correct details below.",
        "",
        "Hi all,",
        "",
        "• Address: 15 Example Street, London",
        "• UPRN: 100012345678",
        "• Hazard: Damp and Mould Growth",
        "• Rating: High - Emergency Risk",
        "• Site notes: Damp to the bedroom ceiling.",
        "• Survey date: 28/09/2026",
      ].join("\n")
    );
    assert.equal(
      prepared.text.split("\n")[0],
      "Please disregard our previous email, due to an error. See correct details below."
    );
    assert.doesNotMatch(prepared.text, /This corrects/);
    assert.match(bulletLine(prepared.messageHtml, "Address"), /<b>15 Example Street, London<\/b>/);
    for (const label of ["UPRN", "Hazard", "Rating", "Site notes", "Survey date"]) {
      assert.equal(bulletLine(prepared.messageHtml, label).includes("<b>"), false, label);
    }
    assert.equal(correctionSubject(PREVIOUS_SUBJECT), SUBJECT);
    assert.match(SUBJECT, /14 Example Street, London/);
    assert.doesNotMatch(prepared.text, /14 Example Street/);
    assert.doesNotMatch(prepared.text, /was wrong/i);
    assert.doesNotMatch(prepared.text, /Wrong address/);
    assert.doesNotMatch(prepared.messageHtml, /\*\*/);
  });

  it("corrects photos without naming the photo or adding a photo bullet", () => {
    const prepared = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: ORIGINAL,
      previousPhotos: ["bedroom-ceiling.jpg"],
      nextPhotos: ["kitchen.jpg"],
      reason: "Missing photo",
    });
    assert.equal(
      prepared.text,
      [
        "Please disregard our previous email, due to an error. See correct details below.",
        "",
        "The photo was incorrect.",
        "",
        ORIGINAL,
      ].join("\n")
    );
    const lines = htmlLines(prepared.messageHtml);
    assert.equal(lines[0], "Please disregard our previous email, due to an error. See correct details below.");
    assert.equal(lines[2], "The photo was incorrect.");
    assert.doesNotMatch(prepared.text, /The correct photos are now attached/);
    assert.doesNotMatch(lines[0], /bedroom|kitchen|\.jpg|ceiling/i);
    assert.doesNotMatch(lines[2], /bedroom|kitchen|\.jpg|ceiling/i);
    assert.doesNotMatch(prepared.text, /• Photo/);
    assert.equal(bulletLine(prepared.messageHtml, "Address").includes("<b>"), false);
    assert.equal(bulletLine(prepared.messageHtml, "Hazard").includes("<b>"), false);
    assert.doesNotMatch(prepared.text, /was wrong/i);
    assert.doesNotMatch(prepared.messageHtml, /\*\*/);
    assert.equal((prepared.text.match(/Please disregard our previous email/g) || []).length, 1);
  });

  it("uses the photo sentence when the reason is Missing photo and the file names are unchanged", () => {
    const prepared = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: ORIGINAL,
      reason: "Missing photo",
    });
    assert.equal(
      prepared.text.split("\n")[0],
      "Please disregard our previous email, due to an error. See correct details below."
    );
    assert.doesNotMatch(prepared.text, /The photo was incorrect/);
    assert.doesNotMatch(prepared.messageHtml, /The photo was incorrect/);
    assert.doesNotMatch(prepared.text, /The correct photos are now attached/);
    assert.doesNotMatch(prepared.text, /bedroom-ceiling/);
  });

  it("adds the photo line only when the photo set changes", () => {
    const removed = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: ORIGINAL,
      previousPhotos: ["keep.jpg", "wrong.jpg"],
      nextPhotos: ["keep.jpg"],
      reason: "Other",
    });
    const added = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: ORIGINAL,
      previousPhotos: ["keep.jpg"],
      nextPhotos: ["keep.jpg", "replacement.jpg"],
      reason: "Other",
    });
    const replaced = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: ORIGINAL,
      previousPhotos: ["wrong.jpg"],
      nextPhotos: ["replacement.jpg"],
      reason: "Other",
    });
    const reordered = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: ORIGINAL,
      previousPhotos: ["keep.jpg", "wrong.jpg"],
      nextPhotos: ["wrong.jpg", "keep.jpg"],
      reason: "Other",
    });
    const blank = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: ORIGINAL,
      previousPhotos: [],
      nextPhotos: ["  "],
      reason: "Other",
    });
    for (const prepared of [removed, added, replaced]) {
      assert.equal(
        prepared.text.split("\n").slice(0, 4).join("\n"),
        [
          "Please disregard our previous email, due to an error. See correct details below.",
          "",
          "The photo was incorrect.",
          "",
        ].join("\n")
      );
      assert.match(prepared.text, /\nHi all,/);
      assert.equal((prepared.text.match(/The photo was incorrect\./g) || []).length, 1);
      assert.doesNotMatch(prepared.messageHtml, /<b>The photo was incorrect\.<\/b>/);
      assert.equal(parseSentEmail(prepared.text).prose.includes("The photo was incorrect."), false);
    }
    assert.doesNotMatch(reordered.text, /The photo was incorrect/);
    assert.doesNotMatch(blank.text, /The photo was incorrect/);
  });

  it("corrects a hazard and bolds only that value", () => {
    const next = replaceBullet(ORIGINAL, "Hazard", "Excess Cold");
    const prepared = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: next,
      reason: "Wrong details",
    });
    assert.equal(
      prepared.text,
      [
        "Please disregard our previous email, due to an error. See correct details below.",
        "",
        "Hi all,",
        "",
        "• Address: 14 Example Street, London",
        "• UPRN: 100012345678",
        "• Hazard: Excess Cold",
        "• Rating: High - Emergency Risk",
        "• Site notes: Damp to the bedroom ceiling.",
        "• Survey date: 28/09/2026",
      ].join("\n")
    );
    assert.match(prepared.text, /Please disregard our previous email, due to an error\. See correct details below\./);
    assert.doesNotMatch(prepared.messageHtml, /This corrects the hazard/);
    assert.match(bulletLine(prepared.messageHtml, "Hazard"), /<b>Excess Cold<\/b>/);
    for (const label of ["Address", "UPRN", "Rating", "Site notes", "Survey date"]) {
      assert.equal(bulletLine(prepared.messageHtml, label).includes("<b>"), false, label);
    }
    assert.doesNotMatch(prepared.text, /was wrong/i);
    assert.doesNotMatch(prepared.text, /Wrong details/);
    assert.doesNotMatch(prepared.messageHtml, /\*\*/);
  });

  it("names every changed field, including rating, site notes, and recipient", () => {
    let next = replaceBullet(ORIGINAL, "Rating", "Moderate");
    next = replaceBullet(next, "Site notes", "Damp in the kitchen.");
    const prepared = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: next,
      previousTo: "repairs@example.com",
      nextTo: "housing@example.com",
      reason: "Wrong details",
    });
    assert.equal(
      prepared.text.split("\n")[0],
      "Please disregard our previous email, due to an error. See correct details below."
    );
    assert.doesNotMatch(prepared.text, /housing@example\.com/);
    assert.doesNotMatch(prepared.messageHtml, /which is now/);
    assert.match(bulletLine(prepared.messageHtml, "Rating"), /<b>Moderate<\/b>/);
    assert.match(bulletLine(prepared.messageHtml, "Site notes"), /<b>Damp in the kitchen\.<\/b>/);
    assert.equal(bulletLine(prepared.messageHtml, "Address").includes("<b>"), false);
    assert.doesNotMatch(bulletLine(prepared.messageHtml, "Address"), /housing@example/);
  });

  it("names UPRN, cause, and call reference when those lines change", () => {
    let next = replaceBullet(ORIGINAL, "UPRN", "100099988877");
    next += "\n• Cause: Failed pointing.";
    next += "\n• Client call reference: CALL-44";
    const prepared = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: next,
      reason: "Wrong details",
    });
    assert.equal(
      prepared.text.split("\n")[0],
      "Please disregard our previous email, due to an error. See correct details below."
    );
    assert.match(prepared.text, /• UPRN: 100099988877/);
    assert.match(prepared.text, /• Cause: Failed pointing\./);
    assert.match(prepared.text, /• Client call reference: CALL-44/);
    assert.doesNotMatch(prepared.text, /This corrects/);
    assert.match(bulletLine(prepared.messageHtml, "UPRN"), /<b>100099988877<\/b>/);
    assert.match(bulletLine(prepared.messageHtml, "Cause"), /<b>Failed pointing\.<\/b>/);
    assert.equal(bulletLine(prepared.messageHtml, "Hazard").includes("<b>"), false);
  });

  it("puts an Other note in the opening without saying something was wrong", () => {
    const prepared = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: ORIGINAL,
      reason: "Other",
      note: "Survey date should be 27/09/2026",
    });
    assert.equal(
      prepared.text.split("\n")[0],
      "Please disregard our previous email, due to an error. See correct details below."
    );
    assert.doesNotMatch(prepared.text, /Survey date should be 27\/09\/2026/);
    assert.doesNotMatch(prepared.text, /This corrects/);
    assert.doesNotMatch(prepared.text, /was wrong/i);
    assert.equal(bulletLine(prepared.messageHtml, "Survey date").includes("<b>"), false);
  });

  it("names a changed survey date and keeps an Other note as well", () => {
    const next = replaceBullet(ORIGINAL, "Survey date", "27/09/2026");
    const prepared = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: next,
      reason: "Other",
      note: "Called in by the client.",
    });
    assert.equal(
      prepared.text.split("\n")[0],
      "Please disregard our previous email, due to an error. See correct details below."
    );
    assert.match(prepared.text, /• Survey date: 27\/09\/2026/);
    assert.doesNotMatch(prepared.text, /Called in by the client/);
    assert.doesNotMatch(prepared.text, /This corrects/);
    assert.match(bulletLine(prepared.messageHtml, "Survey date"), /<b>27\/09\/2026<\/b>/);
  });

  it("does not treat an unchanged resend as a field change, and does not stack openings", () => {
    const first = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: replaceBullet(ORIGINAL, "Address", "15 Example Street, London"),
      reason: "Wrong address",
    });
    const second = prepareCorrectionEmail({
      ...base,
      previousBody: first.text,
      nextBody: first.text.replaceAll("15 Example Street, London", "16 Example Street, London"),
      reason: "Wrong address",
    });
    assert.equal(stripCorrectionIntro(first.text), replaceBullet(ORIGINAL, "Address", "15 Example Street, London"));
    const openings = second.text.split("Please disregard our previous email, due to an error.").length - 1;
    assert.equal(openings, 1);
    assert.match(second.text, /• Address: 16 Example Street, London/);
    assert.doesNotMatch(second.text, /15 Example Street/);
  });

  it("escapes HTML in the new value and still bolds it", () => {
    const next = replaceBullet(ORIGINAL, "Site notes", "Crack <north> & stair.");
    const prepared = prepareCorrectionEmail({
      ...base,
      previousBody: ORIGINAL,
      nextBody: next,
      reason: "Wrong details",
    });
    assert.match(prepared.messageHtml, /<b>Crack &lt;north&gt; &amp; stair\.<\/b>/);
    assert.doesNotMatch(prepared.messageHtml, /which is now/);
    assert.doesNotMatch(prepared.messageHtml, /<north>/);
  });

  it("renders the correction subject with a bold tag, not only an h2 weight", () => {
    const html = composeEmailHtml("Hi all,", NAMES, `cid:${SIGNATURE_LOGO_CID}`, "<p>Hi all,</p>", {
      subject: SUBJECT,
    });
    assert.match(html, new RegExp(`<b[^>]*>${SUBJECT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</b>`));
    assert.match(html, /<h2\b[^>]*>\s*<b\b/);
    assert.doesNotMatch(html, /<h2\b[^>]*>\s*CORRECTION:/);
  });
});

describe("HHSRS correction send", () => {
  const names = { firstName: "", fullName: "" };

  async function sendPrepared(input: Parameters<typeof prepareCorrectionEmail>[0], photoNames: string[]) {
    const prepared = prepareCorrectionEmail(input);
    const sent: OutboundEmail[] = [];
    const result = await deliverPortalEmail(
      {
        submissionId: "case-1",
        sentBy: "Tom Sharp",
        hasReporterAccess: true,
        passwordSet: true,
        alreadySent: false,
        checked: true,
        to: "client@savillshousing.co.uk",
        cc: "",
        bcc: "",
        subject: correctionSubject(PREVIOUS_SUBJECT),
        body: prepared.text,
        messageHtml: prepared.messageHtml,
        photoNames,
        attachments: photoNames.map((filename) => ({
          filename,
          content: Buffer.from("photo"),
          contentType: "image/jpeg",
        })),
        allowDomainsRaw: "*",
        totalBytes: photoNames.length,
        fromName: "Savills HHSRS",
        fromAddress: "hhsrs@savillshousing.co.uk",
      },
      {
        sendMail: async (mail) => {
          sent.push(mail);
          return { messageId: "<correction@savillshousing.co.uk>", raw: Buffer.from("raw") };
        },
        appendToSent: async () => undefined,
        exclusive: async (run) => {
          const commit: SendCommit = await run();
          const record: SentEmailRecord = { id: "sent-1", submissionId: "case-1", ...commit };
          return record;
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    return { prepared, mail: sent[0] };
  }

  it("sends the address, photo, and hazard corrections with bold HTML and the old subject", async () => {
    const address = await sendPrepared(
      {
        ...base,
        previousBody: ORIGINAL,
        nextBody: replaceBullet(ORIGINAL, "Address", "15 Example Street, London"),
        reason: "Wrong address",
      },
      ["bedroom-ceiling.jpg"]
    );
    const photos = await sendPrepared(
      {
        ...base,
        previousBody: ORIGINAL,
        nextBody: ORIGINAL,
        previousPhotos: ["bedroom-ceiling.jpg"],
        nextPhotos: ["kitchen.jpg"],
        reason: "Missing photo",
      },
      ["kitchen.jpg"]
    );
    const hazard = await sendPrepared(
      {
        ...base,
        previousBody: ORIGINAL,
        nextBody: replaceBullet(ORIGINAL, "Hazard", "Excess Cold"),
        reason: "Wrong details",
      },
      ["bedroom-ceiling.jpg"]
    );

    for (const item of [address, photos, hazard]) {
      assert.equal(item.mail.fromAddress, "hhsrs@savillshousing.co.uk");
      assert.equal(item.mail.fromName, "Savills HHSRS");
      assert.equal(item.mail.subject, SUBJECT);
      assert.match(item.mail.subject, /14 Example Street, London/);
      assert.equal(item.mail.text, composeEmailText(item.prepared.text, names));
      assert.equal(
        item.mail.html,
        composeEmailHtml(item.prepared.text, names, `cid:${SIGNATURE_LOGO_CID}`, item.prepared.messageHtml, {
          subject: item.mail.subject,
          photos: (item.mail.inlinePhotos || []).map((photo) => ({ src: `cid:${photo.cid}`, name: photo.filename })),
        })
      );
      const printAt = item.mail.html.indexOf("Before printing, think about the environment");
      const photoAt = item.mail.html.indexOf("cid:hhsrs-photo-0@savillshousing.co.uk");
      assert.ok(printAt >= 0 && photoAt > printAt, "case photos sit under the signature");
      assert.match(item.mail.html, /background:#e7edf3/);
      assert.match(item.mail.html, /HHSRS Reporting Team/);
      assert.match(item.mail.html, /HHSRS@savillshousing\.co\.uk/);
      assert.match(item.mail.html, /www\.savills\.co\.uk/);
      assert.match(item.mail.html, new RegExp(`cid:${SIGNATURE_LOGO_CID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.doesNotMatch(item.mail.html, /\*\*/);
      assert.doesNotMatch(item.mail.text, /was wrong/i);
      assert.match(item.mail.text, /Please disregard our previous email, due to an error\. See correct details below\./);
      assert.match(item.mail.subject, /^CORRECTION: /);
    }

    assert.match(address.mail.html, /<b>15 Example Street, London<\/b>/);
    assert.doesNotMatch(address.mail.text, /<b>/);
    assert.doesNotMatch(photos.mail.text, /The correct photos are now attached/);
    assert.match(photos.mail.text, /The photo was incorrect\./);
    assert.doesNotMatch(address.mail.text, /The photo was incorrect/);
    assert.doesNotMatch(hazard.mail.text, /The photo was incorrect/);
    assert.match(photos.mail.html, /<h2\b[^>]*>\s*<b\b[^>]*>CORRECTION:/);
    assert.doesNotMatch(photos.mail.html, /<h2\b[^>]*>\s*CORRECTION:/);
    assert.doesNotMatch(photos.mail.text, /kitchen\.jpg|bedroom-ceiling/);
    assert.match(hazard.mail.html, /<b>Excess Cold<\/b>/);
    assert.match(hazard.mail.text, /• Address: 14 Example Street, London/);
    assert.equal(bulletLine(hazard.prepared.messageHtml, "Address").includes("<b>"), false);
  });
});

describe("HHSRS amend and resend", () => {
  const previous = parseSentEmail(ORIGINAL).fields;

  it("bolds only the lines that differ and keeps the short correction opening", () => {
    const built = buildAmendmentEmail({
      previousBody: ORIGINAL,
      previousSubject: PREVIOUS_SUBJECT,
      next: { ...previous, hazard: "Excess Cold", rating: "Low" },
      amendment: "Wrong hazard. It is Excess Cold.",
    });
    assert.match(built.subject, /^CORRECTION: /);
    assert.match(
      built.text,
      /^Please disregard our previous email, due to an error\. See correct details below\.\n\nHi all,/
    );
    assert.doesNotMatch(built.text, /Wrong hazard\. It is Excess Cold/);
    assert.match(built.messageHtml, /<li>Hazard: <b>Excess Cold<\/b><\/li>/);
    assert.match(built.messageHtml, /<li>Rating: <b>Low<\/b><\/li>/);
    assert.match(built.messageHtml, /<li>Address: 14 Example Street, London<\/li>/);
    assert.equal(built.messageHtml.includes("<li>Address: <b>"), false);
    assert.doesNotMatch(built.text, /NOTICE:|Tom Sharp/);
    assert.match(built.note, /Hazard: Damp and Mould Growth → Excess Cold/);
    assert.match(built.note, /Rating: High - Emergency Risk → Low/);
    assert.equal(built.reason, "Wrong details");
  });

  it("starts the next amendment from the newest email", () => {
    const first = buildAmendmentEmail({
      previousBody: ORIGINAL,
      previousSubject: PREVIOUS_SUBJECT,
      next: { ...previous, hazard: "Excess Cold" },
      amendment: "Wrong hazard.",
    });
    const again = parseSentEmail(first.text).fields;
    assert.equal(again.hazard, "Excess Cold");
    assert.equal(again.address, previous.address);
    const second = buildAmendmentEmail({
      previousBody: first.text,
      previousSubject: first.subject,
      next: { ...again, rating: "Moderate" },
      amendment: "Rating was low.",
    });
    assert.equal(second.subject.startsWith("CORRECTION: CORRECTION:"), false);
    assert.match(second.subject, /^CORRECTION: /);
    assert.match(second.messageHtml, /<li>Hazard: Excess Cold<\/li>/);
    assert.match(second.messageHtml, /<li>Rating: <b>Moderate<\/b><\/li>/);
    assert.equal((second.text.match(/Please disregard our previous email/g) || []).length, 1);
  });

  it("adds the photo line on an amendment only when the photo set changes", () => {
    const unchanged = buildAmendmentEmail({
      previousBody: ORIGINAL,
      previousSubject: PREVIOUS_SUBJECT,
      next: previous,
      amendment: "Checked the photos.",
      previousPhotos: ["keep.jpg", "wrong.jpg"],
      nextPhotos: ["wrong.jpg", "keep.jpg"],
    });
    assert.doesNotMatch(unchanged.text, /The photo was incorrect/);
    assert.doesNotMatch(unchanged.messageHtml, /The photo was incorrect/);
    assert.match(
      unchanged.text,
      /^Please disregard our previous email, due to an error\. See correct details below\.\n\nHi all,/
    );

    const removed = buildAmendmentEmail({
      previousBody: ORIGINAL,
      previousSubject: PREVIOUS_SUBJECT,
      next: previous,
      amendment: "Removed the wrong photo.",
      previousPhotos: ["keep.jpg", "wrong.jpg"],
      nextPhotos: ["keep.jpg"],
    });
    const added = buildAmendmentEmail({
      previousBody: ORIGINAL,
      previousSubject: PREVIOUS_SUBJECT,
      next: previous,
      amendment: "Added a replacement.",
      previousPhotos: ["keep.jpg"],
      nextPhotos: ["keep.jpg", "kitchen.jpg"],
    });
    for (const built of [removed, added]) {
      assert.match(
        built.text,
        /^Please disregard our previous email, due to an error\. See correct details below\.\n\nThe photo was incorrect\.\n\nHi all,/
      );
      assert.match(
        built.messageHtml,
        /^<p>Please disregard our previous email, due to an error\. See correct details below\.<\/p><p>The photo was incorrect\.<\/p><p>Hi all,<\/p>/
      );
      assert.equal((built.text.match(/Please disregard our previous email/g) || []).length, 1);
      assert.equal((built.text.match(/The photo was incorrect\./g) || []).length, 1);
      assert.doesNotMatch(built.text, /Removed the wrong photo|Added a replacement|kitchen\.jpg|wrong\.jpg/);
      assert.equal(parseSentEmail(built.text).prose.includes("The photo was incorrect."), false);
    }

    const again = buildAmendmentEmail({
      previousBody: removed.text,
      previousSubject: removed.subject,
      next: previous,
      amendment: "Address only.",
      previousPhotos: ["keep.jpg"],
      nextPhotos: ["keep.jpg"],
    });
    assert.doesNotMatch(again.text, /The photo was incorrect/);
    assert.equal((again.text.match(/Please disregard our previous email/g) || []).length, 1);
  });

  it("rejects a hazard or rating that is not on the set list", () => {
    assert.equal(amendmentListError(previous, { ...previous, hazard: "Something else" }), "Choose a hazard from the list.");
    assert.equal(amendmentListError(previous, { ...previous, rating: "Extreme" }), "Choose a rating from the list.");
    assert.equal(amendmentListError(previous, { ...previous, hazard: "Excess Cold", rating: "Low" }), "");
    assert.equal(amendmentListError(previous, previous), "");
  });
});

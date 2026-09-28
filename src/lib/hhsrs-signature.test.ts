import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendMailboxMessage } from "./hhsrs-send-transport.js";
import {
  MISSING_SENDER_NAME_WARNING,
  SIGNATURE_LEGAL_PARAGRAPHS,
  SIGNATURE_LOGO_CID,
  composeEmailHtml,
  composeEmailText,
  renderSignatureHtml,
  renderSignatureText,
  resolveSenderSignature,
  signatureLogoBytes,
} from "./hhsrs-signature.js";

const personnel = [
  { name: "Tom Sharp", email: "tsharp@savillshousing.co.uk" },
  { name: "Phil Moon", email: "phil.m@savills.com" },
];

describe("HHSRS email signature", () => {
  it("uses the login first name and surname, not Personnel", () => {
    const names = resolveSenderSignature({
      firstName: "Tom",
      surname: "Sharp",
      email: "tsharp@savillshousing.co.uk",
      personnel: [{ name: "Thomas Surveyor", email: "tsharp@savillshousing.co.uk" }],
    });
    assert.equal(names.missing, false);
    assert.equal(names.firstName, "Tom");
    assert.equal(names.fullName, "Tom Sharp");

    const html = renderSignatureHtml(names, `cid:${SIGNATURE_LOGO_CID}`);
    const text = renderSignatureText(names);
    assert.match(html, />Tom</);
    assert.match(html, />Tom Sharp</);
    assert.match(text, /Regards\n\nTom\n\nTom Sharp\nHHSRS Reporting Team/);
    assert.match(html, /mailto:HHSRS@savillshousing\.co\.uk/);
    assert.match(html, /https:\/\/www\.savills\.co\.uk/);
    assert.match(html, />www\.savills\.co\.uk</);
    assert.match(text, /Email: HHSRS@savillshousing\.co\.uk\nWebsite: www\.savills\.co\.uk/);
    assert.match(html, /Before printing, think about the environment/);
    assert.doesNotMatch(html, /dbeafe|#dbeafe|class="name"/);
    assert.doesNotMatch(html, /<a[^>]*>privacy policy<\/a>/i);
    for (const paragraph of SIGNATURE_LEGAL_PARAGRAPHS) {
      assert.equal(text.includes(paragraph), true);
      assert.equal(html.includes(paragraph.replace(/"/g, "&quot;")), true);
    }
  });

  it("falls back to a Personnel email match only when the login has no name", () => {
    const names = resolveSenderSignature({
      firstName: "",
      surname: " ",
      email: "Phil.M@savills.com",
      personnel,
    });
    assert.deepEqual(names, { firstName: "Phil", fullName: "Phil Moon", missing: false });
    const text = composeEmailText("Dear Sir/Madam,", names);
    assert.match(text, /^Dear Sir\/Madam,\n\nRegards\n\nPhil\n\nPhil Moon\nHHSRS Reporting Team/);

    const blankPersonnelName = resolveSenderSignature({
      firstName: "",
      surname: "",
      email: "tsharp@savillshousing.co.uk",
      personnel: [{ name: "   ", email: "tsharp@savillshousing.co.uk" }],
    });
    assert.equal(blankPersonnelName.missing, true);
  });

  it("does not invent a name when none is on file", () => {
    const names = resolveSenderSignature({ firstName: "", surname: "", email: "", personnel });
    assert.deepEqual(names, { firstName: "", fullName: "", missing: true });
    assert.equal(MISSING_SENDER_NAME_WARNING, "No name found for the signature.");
    const text = renderSignatureText(names);
    assert.match(text, /^Regards\n\nHHSRS Reporting Team\n/);
    assert.doesNotMatch(text, /Regards\n\n\n/);
    const html = renderSignatureHtml(names, `cid:${SIGNATURE_LOGO_CID}`);
    assert.match(html, /Regards/);
    assert.doesNotMatch(html, />undefined<|>null</);
  });

  it("sends html and plain text, with the logo inline and not a case photo", async () => {
    const previousMock = process.env.HHSRS_SEND_MOCK;
    const previousEnv = process.env.NODE_ENV;
    process.env.HHSRS_SEND_MOCK = "1";
    if (previousEnv === "production") process.env.NODE_ENV = "test";
    try {
      const names = { firstName: "Tom", fullName: "Tom Sharp" };
      const photos = [{ filename: "kitchen.jpg", content: Buffer.from("jpeg-bytes"), contentType: "image/jpeg" }];
      const sent = await sendMailboxMessage({
        fromName: "Savills HHSRS",
        fromAddress: "hhsrs@savillshousing.co.uk",
        to: ["cfarrell@savillshousing.co.uk"],
        cc: [],
        bcc: [],
        subject: "HHSRS – Damp & Mould Growth – 1 Test Street",
        text: composeEmailText("Dear Sir/Madam,\n\nPlease find details.", names),
        html: composeEmailHtml("Dear Sir/Madam,\n\nPlease find details.", names, `cid:${SIGNATURE_LOGO_CID}`),
        messageId: "<sig-test@savillshousing.co.uk>",
        attachments: photos,
      });
      const raw = sent.raw.toString("utf8");
      assert.match(raw, /text\/plain/);
      assert.match(raw, /text\/html/);
      assert.match(raw, /Dear Sir\/Madam/);
      assert.match(raw, /Tom Sharp/);
      assert.match(raw, /HHSRS Reporting Team/);
      assert.match(raw, new RegExp(`cid:${SIGNATURE_LOGO_CID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(raw, new RegExp(`Content-ID:\\s*<${SIGNATURE_LOGO_CID}>`, "i"));
      assert.match(raw, /Content-Disposition:\s*inline/i);
      assert.match(raw, /filename="?kitchen\.jpg"?/i);
      assert.match(raw, /Content-Disposition:\s*attachment/i);
      const logoStart = signatureLogoBytes().toString("base64").slice(0, 48);
      assert.equal(raw.includes(logoStart), true);
      assert.equal(photos.length, 1);
      assert.equal(photos[0].filename, "kitchen.jpg");
      const inlineAt = raw.search(/Content-Disposition:\s*inline/i);
      const logoNameAt = raw.indexOf("savills-logo.png");
      assert.ok(inlineAt >= 0 && logoNameAt >= 0);
      const inlinePart = raw.slice(Math.max(0, inlineAt - 400), inlineAt + 80);
      assert.match(inlinePart, /savills-logo\.png|image\/png/);
      assert.doesNotMatch(inlinePart, /kitchen\.jpg/);
    } finally {
      if (previousMock === undefined) delete process.env.HHSRS_SEND_MOCK;
      else process.env.HHSRS_SEND_MOCK = previousMock;
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
    }
  });

  it("shows the signature under the body on the review page and the check screen", () => {
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const js = readFileSync("public/js/hhsrs-reporter.js", "utf8");
    const bodyAt = review.indexOf('id="hhsrs-body"');
    const sigAt = review.indexOf('id="rv-signature-preview"');
    const attachAt = review.indexOf('id="rv-attach-block"');
    assert.ok(bodyAt > 0 && sigAt > bodyAt, "signature follows the body");
    assert.ok(attachAt > sigAt, "signature stays out of the photo list");
    assert.match(review, /aria-readonly="true"/);
    assert.doesNotMatch(review.slice(bodyAt, sigAt), /signatureHtml/);
    const openCheck = js.slice(js.indexOf("function openCheck"), js.indexOf("function closeCheck"));
    assert.match(openCheck, /rv-signature-preview/);
    assert.match(openCheck, /ck-signature/);
    assert.match(openCheck, /cfg\.signature\.warning/);
    const bodyInCheck = openCheck.indexOf('aria-label=\\"Email text\\"');
    const sigInCheck = openCheck.indexOf("ck-signature");
    const photosInCheck = openCheck.indexOf('ck-photos-label\\">Attached');
    assert.ok(bodyInCheck >= 0 && sigInCheck > bodyInCheck && photosInCheck > sigInCheck);

    const personnel = readFileSync("views/personnel.ejs", "utf8");
    const admins = personnel.slice(personnel.indexOf("C. Admins"));
    assert.match(admins, /name="firstName"/);
    assert.match(admins, /name="surname"/);
    assert.match(admins, /data-part="surname"/);
    assert.match(admins, /boxes save on their own/);
    const adminHome = readFileSync("views/admin.ejs", "utf8");
    assert.match(adminHome, /section C\. Admins/);
    const appJs = readFileSync("public/js/app.js", "utf8");
    assert.match(appJs, /signature-name/);
    assert.match(appJs, /is-saved/);
    const route = readFileSync("src/routes/hhsrs-reporter.ts", "utf8");
    const lookup = route.slice(route.indexOf("async function senderSignatureFor"), route.indexOf("function signatureLocals"));
    assert.match(lookup, /role: "surveyor"/);
    assert.doesNotMatch(lookup, /displayName|user\?\.name/);
  });
});

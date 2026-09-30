import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendMailboxMessage } from "./hhsrs-send-transport.js";
import {
  MISSING_SENDER_NAME_WARNING,
  SIGNATURE_LOGO_CID,
  SIGNATURE_LOGO_PUBLIC_PATH,
  SIGNATURE_LOGO_PX,
  composeEmailHtml,
  composeEmailText,
  renderSignatureHtml,
  renderSignatureText,
  resolveSenderSignature,
  signatureLogoBytes,
} from "./hhsrs-signature.js";

/** Exact bytes of the yellow square cropped from the approved email. */
const APPROVED_LOGO_SHA256 = "0f4fd034363bd2c955d8f8e6529e234a5018e3ed1d0e566f8c7d212f3b628400";

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
    assert.doesNotMatch(html, />Tom</);
    assert.doesNotMatch(html, /Tom Sharp/);
    assert.doesNotMatch(text, /Tom/);
    assert.match(text, /^Regards\n\nHHSRS Reporting Team\n\nSavills, 33 Margaret Street, London, W1G 0JD\n/);
    assert.match(html, /mailto:HHSRS@savillshousing\.co\.uk/);
    assert.match(html, /https:\/\/www\.savills\.co\.uk/);
    assert.match(html, />www\.savills\.co\.uk</);
    assert.match(text, /Email: HHSRS@savillshousing\.co\.uk\nWebsite: www\.savills\.co\.uk/);
    const printLine = "\u{1F33F} Before printing, think about the environment";
    assert.equal(
      text,
      [
        "Regards",
        "",
        "HHSRS Reporting Team",
        "",
        "Savills, 33 Margaret Street, London, W1G 0JD",
        "",
        "Email: HHSRS@savillshousing.co.uk",
        "Website: www.savills.co.uk",
        "",
        printLine,
      ].join("\n")
    );
    assert.match(html, /<p style="margin:32px 0 16px;">Regards<\/p>/);
    const regardsAt = html.indexOf(">Regards<");
    const teamAt = html.indexOf(">HHSRS Reporting Team<");
    const addressAt = html.indexOf(">Savills, 33 Margaret Street, London, W1G 0JD<");
    const logoAt = html.indexOf("<img ");
    const emailAt = html.indexOf(">Email: ");
    const webAt = html.indexOf(">Website: ");
    const printAt = html.indexOf("Before printing, think about the environment");
    assert.ok(
      regardsAt >= 0 &&
        teamAt > regardsAt &&
        addressAt > teamAt &&
        logoAt > addressAt &&
        emailAt > logoAt &&
        webAt > emailAt &&
        printAt > webAt,
      "signature blocks stay in the approved order"
    );
    assert.match(html, /Before printing, think about the environment<\/p><\/div>$/);
    assert.doesNotMatch(html, /dbeafe|#dbeafe|class="name"/);
    for (const forbidden of ["NOTICE:", "privacy policy", "Savills plc", "Regulated by RICS", "Scottish Letting Agent Register"]) {
      assert.equal(text.includes(forbidden), false, forbidden);
      assert.equal(html.includes(forbidden), false, forbidden);
    }
    const generated = composeEmailText("Dear Sir/Madam,\n\nPlease find details.", names);
    assert.match(generated, new RegExp(`${printLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    assert.doesNotMatch(generated, /NOTICE:|Savills plc|Scottish Letting Agent Register/);
    const generatedHtml = composeEmailHtml("Dear Sir/Madam,\n\nPlease find details.", names, `cid:${SIGNATURE_LOGO_CID}`, undefined, {
      subject: "HHSRS – 1 Test Street",
    });
    assert.match(generatedHtml, /Before printing, think about the environment<\/p><\/div>/);
    assert.match(generatedHtml, /background:#e7edf3/);
    assert.match(generatedHtml, /background:#f7f9fb/);
    assert.match(generatedHtml, /HHSRS – 1 Test Street/);
    assert.match(generatedHtml, /<\/body><\/html>$/);
    assert.doesNotMatch(generatedHtml, /NOTICE:|Savills plc|Scottish Letting Agent Register/);
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
    assert.match(text, /^Dear Sir\/Madam,\n\n\nRegards\n\nHHSRS Reporting Team\n/);
    assert.doesNotMatch(text, /Phil/);

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
      const photos = [{
        filename: "a4a6fb82-7a49-4f8e-9262-e41674058ece.jpg",
        content: Buffer.from("jpeg-bytes"),
        contentType: "image/jpeg",
        cid: "hhsrs-photo-0@savillshousing.co.uk",
      }];
      const html = composeEmailHtml("Dear Sir/Madam,\n\nPlease find details.", names, `cid:${SIGNATURE_LOGO_CID}`, undefined, {
        photos: [{ src: `cid:${photos[0].cid}`, name: photos[0].filename }],
      });
      assert.doesNotMatch(html, /a4a6fb82-7a49-4f8e-9262-e41674058ece\.jpg/);
      assert.doesNotMatch(html, /font-size:11px/);
      const sent = await sendMailboxMessage({
        fromName: "Savills HHSRS",
        fromAddress: "hhsrs@savillshousing.co.uk",
        to: ["cfarrell@savillshousing.co.uk"],
        cc: [],
        bcc: [],
        subject: "HHSRS – Damp & Mould Growth – 1 Test Street",
        text: composeEmailText("Dear Sir/Madam,\n\nPlease find details.", names),
        html,
        messageId: "<sig-test@savillshousing.co.uk>",
        attachments: photos,
        inlinePhotos: photos,
      });
      const raw = sent.raw.toString("utf8");
      const unfolded = raw.replace(/=\r\n/g, "");
      assert.match(raw, /text\/plain/);
      assert.match(raw, /text\/html/);
      assert.match(raw, /Dear Sir\/Madam/);
      assert.doesNotMatch(unfolded, /Tom Sharp/);
      assert.match(unfolded, /HHSRS Reporting Team/);
      assert.match(unfolded, /Before printing, think about the environment/);
      assert.doesNotMatch(unfolded, /NOTICE:/);
      assert.doesNotMatch(unfolded, /Savills plc/);
      assert.doesNotMatch(unfolded, /Scottish Letting Agent Register/);
      assert.match(unfolded, new RegExp(`cid:${SIGNATURE_LOGO_CID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(raw, new RegExp(`Content-ID:\\s*<${SIGNATURE_LOGO_CID}>`, "i"));
      assert.match(raw, /Content-Disposition:\s*inline/i);
      assert.match(raw, /filename="?a4a6fb82-7a49-4f8e-9262-e41674058ece\.jpg"?/i);
      assert.doesNotMatch(raw, /Content-Disposition:\s*attachment/i);
      assert.doesNotMatch(unfolded, />a4a6fb82-7a49-4f8e-9262-e41674058ece\.jpg</);
      const logoStart = signatureLogoBytes().toString("base64").slice(0, 48);
      assert.equal(raw.includes(logoStart), true);
      assert.equal(photos.length, 1);
      assert.equal(photos[0].filename, "a4a6fb82-7a49-4f8e-9262-e41674058ece.jpg");
      const inlineAt = raw.search(/Content-Disposition:\s*inline/i);
      const logoNameAt = raw.indexOf("savills-logo.png");
      assert.ok(inlineAt >= 0 && logoNameAt >= 0);
      const inlinePart = raw.slice(Math.max(0, inlineAt - 400), inlineAt + 80);
      assert.match(inlinePart, /savills-logo\.png|image\/png/);
      assert.doesNotMatch(inlinePart, /a4a6fb82-7a49-4f8e-9262-e41674058ece\.jpg/);
    } finally {
      if (previousMock === undefined) delete process.env.HHSRS_SEND_MOCK;
      else process.env.HHSRS_SEND_MOCK = previousMock;
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
    }
  });

  it("keeps a short signature note on the review panel and the full signature on the check screen", () => {
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const js = readFileSync("public/js/hhsrs-reporter.js", "utf8");
    const bodyAt = review.indexOf('id="hhsrs-body"');
    const noteAt = review.indexOf("Signature added when sent");
    const attachAt = review.indexOf('id="rv-attach-block"');
    const emailPhotosAt = review.indexOf('id="rv-email-photos"');
    const sendAt = review.indexOf('id="rv-send-block"');
    assert.ok(bodyAt > 0 && attachAt > bodyAt && emailPhotosAt > bodyAt, "email photos follow the body");
    assert.ok(noteAt > attachAt && noteAt > emailPhotosAt && sendAt > noteAt, "grey signature line sits under the photos");
    assert.doesNotMatch(review, /rv-signature-preview|email-signature-block|signatureHtml|sig-name-warn|No name found/);
    assert.match(review, /aria-readonly="true"/);
    const openCheck = js.slice(js.indexOf("function openCheck"), js.indexOf("function closeCheck"));
    assert.match(review, /id="ck-title" tabindex="-1"/);
    assert.match(openCheck, /ck-title/);
    assert.match(openCheck, /preventScroll:\s*true/);
    assert.match(openCheck, /ck\.scrollTop = 0/);
    assert.match(openCheck, /pane\.scrollTop = 0/);
    assert.match(openCheck, /\.ck-mail/);
    assert.match(openCheck, /background:#e7edf3/);
    assert.match(openCheck, /sent-card/);
    assert.match(openCheck, /sent-body/);
    assert.doesNotMatch(openCheck, /ckTick\.focus|ckSend\.focus/);
    assert.match(openCheck, /cfg\.signature\.html/);
    assert.doesNotMatch(openCheck, /rv-signature-preview/);
    assert.doesNotMatch(openCheck, /ck-list|ck-photos-label|>Signature</);
    const sigInCheck = openCheck.indexOf("sent-sign");
    const photosInCheck = openCheck.indexOf("sent-photos");
    assert.ok(sigInCheck >= 0 && photosInCheck > sigInCheck, "check-screen photos sit under the signature");

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

    const logo = readFileSync("public/img/savills-logo.png");
    assert.equal(logo.readUInt32BE(16), SIGNATURE_LOGO_PX);
    assert.equal(logo.readUInt32BE(20), SIGNATURE_LOGO_PX);
    assert.equal(createHash("sha256").update(logo).digest("hex"), APPROVED_LOGO_SHA256);
    assert.equal(signatureLogoBytes().equals(logo), true);
    const signed = renderSignatureHtml({ firstName: "Tom", fullName: "Tom Sharp" }, SIGNATURE_LOGO_PUBLIC_PATH);
    assert.match(signed, new RegExp(`width="${SIGNATURE_LOGO_PX}" height="${SIGNATURE_LOGO_PX}"`));
    assert.match(signed, /width:53px;height:53px;object-fit:contain/);
    assert.doesNotMatch(signed, /Tom Sharp/);
    const routeLogo = readFileSync("src/routes/hhsrs-reporter.ts", "utf8");
    assert.match(routeLogo, /SIGNATURE_LOGO_PUBLIC_PATH/);
    assert.doesNotMatch(routeLogo, /savills-logo\.svg|savills-hhsrs-signature\.png/);
    assert.match(readFileSync("views/hhsrs-reporter/partials/tool-header.ejs", "utf8"), /width="53" height="53"/);
    assert.match(readFileSync("views/hhsrs-reporter/partials/layout-open.ejs", "utf8"), /width="53" height="53"/);
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    assert.match(css, /\.topbar \.brand-lockup img \{\s*width: 53px; height: 53px; object-fit: contain/);
    assert.match(css, /\.tool-header \.tool-logo \{\s*width: 53px; height: 53px;\s*object-fit: contain/);
    assert.doesNotMatch(css, /\.tool-header \.tool-logo \{ width: 34px/);
    const route = readFileSync("src/routes/hhsrs-reporter.ts", "utf8");
    const lookup = route.slice(route.indexOf("async function senderSignatureFor"), route.indexOf("function signatureLocals"));
    assert.match(lookup, /role: "surveyor"/);
    assert.doesNotMatch(lookup, /displayName|user\?\.name/);
  });
});

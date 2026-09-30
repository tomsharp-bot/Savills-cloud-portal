import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ALLOW_DOMAIN,
  PortalSendError,
  SEND_FAILED_MESSAGE,
  SENT_COPY_WARNING,
  TEST_MODE_BANNER,
  buildMainLogEntry,
  checkAttachments,
  checkSendRequest,
  deliverPortalEmail,
  domainIsAllowed,
  parseAllowDomains,
  publicSendSettings,
  redactSecrets,
  REVIEW_SENT_CONFIRMATION,
  sentBannerText,
  type OutboundEmail,
  type SendCommit,
  type SentEmailRecord,
} from "./hhsrs-send.js";
import { imapSentFolder } from "./hhsrs-send-transport.js";
import { projectDraft } from "./hhsrs-reporter-draft.js";

const base = {
  hasReporterAccess: true,
  passwordSet: true,
  alreadySent: false,
  checked: true,
  to: "cfarrell@savillshousing.co.uk",
  cc: "",
  bcc: "",
  allowDomainsRaw: undefined as string | undefined,
  totalBytes: 0,
};

describe("HHSRS IMAP sent folder", () => {
  it("defaults to the top-level Sent mailbox and can be overridden", () => {
    const previous = process.env.HHSRS_IMAP_SENT_FOLDER;
    try {
      delete process.env.HHSRS_IMAP_SENT_FOLDER;
      assert.equal(imapSentFolder(), "Sent");
      process.env.HHSRS_IMAP_SENT_FOLDER = "  ";
      assert.equal(imapSentFolder(), "Sent");
      process.env.HHSRS_IMAP_SENT_FOLDER = "Archive/Sent";
      assert.equal(imapSentFolder(), "Archive/Sent");
    } finally {
      if (previous === undefined) delete process.env.HHSRS_IMAP_SENT_FOLDER;
      else process.env.HHSRS_IMAP_SENT_FOLDER = previous;
    }
  });
});

describe("HHSRS send allow-list", () => {
  it("defaults to Savills and names a blocked address", () => {
    assert.deepEqual(parseAllowDomains(undefined), [DEFAULT_ALLOW_DOMAIN]);
    assert.deepEqual(parseAllowDomains(""), [DEFAULT_ALLOW_DOMAIN]);
    assert.equal(parseAllowDomains("*"), "*");
    assert.deepEqual(parseAllowDomains("savillshousing.co.uk, example.com"), [
      "savillshousing.co.uk",
      "example.com",
    ]);
    assert.equal(domainIsAllowed("savillshousing.co.uk", [DEFAULT_ALLOW_DOMAIN]), true);
    assert.equal(domainIsAllowed("mail.savillshousing.co.uk", [DEFAULT_ALLOW_DOMAIN]), true);
    assert.equal(domainIsAllowed("notsavillshousing.co.uk", [DEFAULT_ALLOW_DOMAIN]), false);
    assert.equal(domainIsAllowed("savillshousing.co.uk.evil.com", [DEFAULT_ALLOW_DOMAIN]), false);

    const blocked = checkSendRequest({ ...base, to: "office@example.com" });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error, "Not sent. office@example.com is not allowed.");

    const ccBlocked = checkSendRequest({
      ...base,
      cc: "cfarrell@savillshousing.co.uk, leaks@gmail.com",
    });
    assert.equal(ccBlocked.ok, false);
    if (!ccBlocked.ok) assert.equal(ccBlocked.error, "Not sent. leaks@gmail.com is not allowed.");

    const lifted = checkSendRequest({
      ...base,
      to: "office@example.com",
      allowDomainsRaw: "*",
    });
    assert.equal(lifted.ok, true);

    const settings = publicSendSettings(false);
    assert.equal(settings.testMode, true);
    assert.equal(settings.testBanner, TEST_MODE_BANNER);
    assert.equal("password" in settings, false);
  });
});

describe("HHSRS send fail-safes", () => {
  it("requires the tick box", () => {
    const result = checkSendRequest({ ...base, checked: false });
    assert.deepEqual(result, { ok: false, error: "Tick the box first." });
  });

  it("refuses when the mailbox password is not set", () => {
    const result = checkSendRequest({ ...base, passwordSet: false });
    assert.deepEqual(result, { ok: false, error: "Sending not set up yet." });
  });

  it("refuses a second send once the case is marked sent", () => {
    const result = checkSendRequest({ ...base, alreadySent: true });
    assert.deepEqual(result, { ok: false, error: "Already sent. Can't be sent again." });
  });

  it("requires a To address and a real address", () => {
    assert.equal(checkSendRequest({ ...base, to: "  " }).ok, false);
    const bad = checkSendRequest({ ...base, to: "not-an-email" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /Not a valid address: not-an-email/);
  });

  it("blocks photos over 20 MB and missing files", () => {
    const over = checkAttachments(["a.jpg"], ["a.jpg"], () => 21 * 1024 * 1024);
    assert.equal(over.ok, false);
    if (!over.ok) assert.equal(over.error, "Photos are over 20 MB.");
    const missing = checkAttachments(["a.jpg"], ["a.jpg"], () => null);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "A photo is missing. Not sent.");
    const stranger = checkAttachments(["a.jpg"], ["../secret.jpg"], () => 10);
    assert.equal(stranger.ok, false);
  });

  it("redacts a password if a transport error includes it", () => {
    const previous = process.env.HHSRS_SMTP_PASSWORD;
    process.env.HHSRS_SMTP_PASSWORD = "mailbox-secret-value";
    try {
      const text = redactSecrets("535 auth failed mailbox-secret-value password=mailbox-secret-value");
      assert.equal(text.includes("mailbox-secret-value"), false);
      assert.match(text, /\[redacted\]/);
    } finally {
      if (previous === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = previous;
    }
  });
});

describe("HHSRS portal send and Main Log record", () => {
  const when = new Date(2026, 8, 25, 12, 15, 0);

  function harness() {
    const sent: OutboundEmail[] = [];
    const appended: Buffer[] = [];
    const records: SentEmailRecord[] = [];
    let queue: Promise<unknown> = Promise.resolve();
    let failSend = false;
    let failCopy = false;

    const exclusive = (run: () => Promise<SendCommit>) => {
      const job = queue.then(async () => {
        if (records.length) throw new PortalSendError("Already sent. Can't be sent again.");
        const commit = await run();
        const record: SentEmailRecord = {
          id: "sent-1",
          submissionId: "case-1",
          ...commit,
        };
        records.push(record);
        return record;
      });
      queue = job.then(
        () => undefined,
        () => undefined
      );
      return job;
    };

    const deliver = (overrides: Partial<Parameters<typeof deliverPortalEmail>[0]> = {}) =>
      deliverPortalEmail(
        {
          submissionId: "case-1",
          sentBy: "Tom Sharp",
          hasReporterAccess: true,
          passwordSet: true,
          alreadySent: false,
          checked: true,
          to: "cfarrell@savillshousing.co.uk",
          cc: "office@savillshousing.co.uk",
          bcc: "",
          subject: "Test Housing - HHSRS – 1 jenkins house, B14 6ES",
          body: "Hi all,\n\n• Address: 1 jenkins house, B14 6ES\n",
          photoNames: ["sample-photo-1.jpg", "sample-photo-2.jpg"],
          attachments: [
            { filename: "sample-photo-1.jpg", content: Buffer.from("a"), contentType: "image/jpeg" },
            { filename: "sample-photo-2.jpg", content: Buffer.from("b"), contentType: "image/jpeg" },
          ],
          allowDomainsRaw: undefined,
          totalBytes: 2,
          fromName: "Savills HHSRS",
          fromAddress: "hhsrs@savillshousing.co.uk",
          sentAt: when,
          ...overrides,
        },
        {
          sendMail: async (mail) => {
            if (failSend) throw new Error("SMTP 550 mailbox unavailable");
            sent.push(mail);
            return { messageId: mail.messageId, raw: Buffer.from("raw-message") };
          },
          appendToSent: async (raw) => {
            if (failCopy) throw new Error("IMAP append failed");
            appended.push(raw);
          },
          exclusive,
        }
      );

    return {
      sent,
      appended,
      records,
      deliver,
      setFailSend(value: boolean) {
        failSend = value;
      },
      setFailCopy(value: boolean) {
        failCopy = value;
      },
    };
  }

  it("records one Main Log send and refuses a second", async () => {
    const box = harness();
    const first = await box.deliver();
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.warning, "");
    assert.equal(first.record.sentBy, "Tom Sharp");
    assert.equal(first.record.from, "Savills HHSRS <hhsrs@savillshousing.co.uk>");
    assert.equal(first.record.to, "cfarrell@savillshousing.co.uk");
    assert.equal(first.record.cc, "office@savillshousing.co.uk");
    assert.equal(first.record.bcc, "");
    assert.equal(first.record.subject, "Test Housing - HHSRS – 1 jenkins house, B14 6ES");
    assert.equal(first.record.body, "Hi all,\n\n• Address: 1 jenkins house, B14 6ES");
    assert.deepEqual(first.record.photoNames, ["sample-photo-1.jpg", "sample-photo-2.jpg"]);
    assert.equal(first.record.sentCopySaved, true);
    assert.equal(box.sent.length, 1);
    assert.equal(box.appended.length, 1);
    assert.equal(REVIEW_SENT_CONFIRMATION, "Sent and logged in the Main Log.");
    assert.match(
      sentBannerText(first.record.sentBy, first.record.sentAt),
      /✓ Sent and logged in the Main Log by Tom Sharp · 12:15 · from HHSRS/
    );

    const entry = buildMainLogEntry({
      uprn: "98756",
      address: "1 jenkins house, B14 6ES",
      projectName: "Test Housing",
      sent: first.record,
      markedBy: first.record.sentBy,
      markedAt: first.record.sentAt,
    });
    assert.equal(entry.caseLine, "UPRN 98756 · 1 jenkins house, B14 6ES · Test Housing");
    assert.match(entry.emailLine, /^Sent from HHSRS by Tom Sharp at 12:15 · Fri 25 Sep 2026$/);
    assert.equal(entry.fromLine, first.record.from);
    assert.equal(entry.to, "cfarrell@savillshousing.co.uk");
    assert.equal(entry.cc, "office@savillshousing.co.uk");
    assert.equal(entry.bcc, "");
    assert.equal(entry.subject, first.record.subject);
    assert.equal(entry.body, first.record.body);
    assert.equal(entry.photoLabel, "Photos sent (2)");
    assert.deepEqual(entry.photoNames, ["sample-photo-1.jpg", "sample-photo-2.jpg"]);

    const second = await box.deliver();
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.error, "Already sent. Can't be sent again.");
    assert.equal(box.sent.length, 1);
    assert.equal(box.records.length, 1);
  });

  it("does not mark the case sent when SMTP fails", async () => {
    const box = harness();
    box.setFailSend(true);
    const result = await box.deliver();
    assert.deepEqual(result, { ok: false, error: SEND_FAILED_MESSAGE });
    assert.equal(box.records.length, 0);
    assert.equal(box.appended.length, 0);
  });

  it("keeps the send when the Sent-folder copy fails", async () => {
    const box = harness();
    box.setFailCopy(true);
    const result = await box.deliver();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.warning, SENT_COPY_WARNING);
    assert.equal(result.record.sentCopySaved, false);
    assert.match(result.record.sentCopyError, /IMAP append failed/);
    assert.equal(box.sent.length, 1);
  });

  it("does not call the transport when the tick box is missing", async () => {
    const box = harness();
    const result = await box.deliver({ checked: false });
    assert.equal(result.ok, false);
    assert.equal(box.sent.length, 0);
    assert.equal(box.records.length, 0);
  });

  it("does not call the transport when the password is missing", async () => {
    const box = harness();
    const result = await box.deliver({ passwordSet: false });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Sending not set up yet.");
    assert.equal(box.sent.length, 0);
  });

  it("appends the signature without counting the logo as a case photo", async () => {
    const box = harness();
    const result = await box.deliver({ senderFirstName: "Tom", senderFullName: "Tom Sharp" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.record.sentBy, "Tom Sharp");
    assert.equal(result.record.body, "Hi all,\n\n• Address: 1 jenkins house, B14 6ES");
    assert.deepEqual(result.record.photoNames, ["sample-photo-1.jpg", "sample-photo-2.jpg"]);
    assert.equal(box.sent.length, 1);
    const mail = box.sent[0];
    assert.deepEqual(
      mail.attachments.map((file) => file.filename),
      ["sample-photo-1.jpg", "sample-photo-2.jpg"]
    );
    assert.match(mail.text, /Hi all,\n\n• Address: 1 jenkins house, B14 6ES\n\n\nRegards\n\nHHSRS Reporting Team\n\nSavills, 33 Margaret Street, London, W1G 0JD\n/);
    assert.doesNotMatch(mail.text, /Tom Sharp/);
    assert.match(mail.html, /cid:savills-logo@savillshousing\.co\.uk/);
    assert.match(mail.html, /background:#e7edf3/);
    assert.match(mail.html, /background:#f7f9fb/);
    const printAt = mail.html.indexOf("Before printing, think about the environment");
    const photoAt = mail.html.indexOf("cid:hhsrs-photo-0@savillshousing.co.uk");
    assert.ok(printAt >= 0 && photoAt > printAt, "photos are pictures under the signature");
    assert.ok(mail.html.indexOf("cid:hhsrs-photo-1@savillshousing.co.uk") > photoAt);
    assert.equal((mail.inlinePhotos || []).length, 2);
    assert.doesNotMatch(mail.html, /sample-photo-1\.jpg|sample-photo-2\.jpg/);
    assert.doesNotMatch(mail.html, /font-size:11px/);
    assert.match(mail.html, /width:53px;height:53px;object-fit:contain/);
    assert.doesNotMatch(mail.html, />Tom Sharp</);
    assert.doesNotMatch(mail.html, /dbeafe/);
    assert.equal(mail.html.includes("savills-logo.png"), false);
    assert.equal(result.record.photoNames.includes("savills-logo.png"), false);
  });

  it("sends, resends, and logs the survey date as DD/MM/YYYY", async () => {
    const draft = projectDraft(
      {
        project: "Demo Housing",
        address: "1 high street, ex1 1aa",
        hazard: "Electrical Hazards",
        rating: "High",
        description: "damaged light fitting in lounge",
        uprn: "100123",
        surveyDate: "2026-09-28",
      },
      []
    );
    const box = harness();
    const sent = await box.deliver({
      subject: draft.subject,
      body: draft.body,
      attachments: [],
      photoNames: [],
      totalBytes: 0,
    });
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.record.from, "Savills HHSRS <hhsrs@savillshousing.co.uk>");
    assert.match(sent.record.body, /• Survey date: 28\/09\/2026/);
    assert.doesNotMatch(sent.record.body, /2026-09-28/);
    assert.match(box.sent[0].text, /• Survey date: 28\/09\/2026/);
    assert.doesNotMatch(box.sent[0].text, /2026-09-28/);
    assert.match(box.sent[0].html, /Survey date: 28\/09\/2026/);

    const log = buildMainLogEntry({
      uprn: "100123",
      address: "1 high street, EX1 1AA",
      projectName: "Demo Housing",
      sent: sent.record,
      markedBy: sent.record.sentBy,
      markedAt: sent.record.sentAt,
    });
    assert.equal(log.body, sent.record.body);
    assert.match(log.body, /• Survey date: 28\/09\/2026/);

    const correction = harness();
    const resent = await correction.deliver({
      subject: "CORRECTION: " + draft.subject,
      body: sent.record.body,
      attachments: [],
      photoNames: [],
      totalBytes: 0,
    });
    assert.equal(resent.ok, true);
    if (!resent.ok) return;
    assert.match(resent.record.body, /• Survey date: 28\/09\/2026/);
    assert.match(correction.sent[0].text, /• Survey date: 28\/09\/2026/);
    assert.doesNotMatch(correction.sent[0].text, /2026-09-28/);
  });
});

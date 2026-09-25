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
  sentBannerText,
  type OutboundEmail,
  type SendCommit,
  type SentEmailRecord,
} from "./hhsrs-send.js";

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
    assert.match(sentBannerText(first.record.sentBy, first.record.sentAt), /Sent by Tom Sharp · 12:15 · from HHSRS/);

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
});

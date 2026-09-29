import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma.js";
import { HHSRS_ACTIONED_STATUSES, HHSRS_WAITING_STATUSES } from "./hhsrs-reporter.js";
import { CLOSE_OPEN_SENT_SUBMISSIONS_SQL, closeSubmissionsLeftOpenAfterSend } from "./hhsrs-close-sent.js";
import { sendCaseEmail } from "./hhsrs-send-case.js";
import type { OutboundEmail } from "./hhsrs-send.js";

function sqlBody(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim()
    .replace(/;\s*$/, "");
}

async function dbReady(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function caseData(marker: string, status = "new") {
  return {
    projectName: "Test Housing",
    surveyDate: "2026-09-28",
    uprn: marker,
    fullAddress: `1 ${marker} Street`,
    postcode: "B1 1AA",
    surveyorName: "Tom Sharp",
    category: "Damp & Mould Growth",
    rating: "Low",
    comment: marker,
    photoPaths: [],
    status,
    emailSubject: "",
    emailBody: "",
    emailSentBy: "",
  };
}

describe("HHSRS send closes the case", () => {
  it("keeps the deploy backfill identical to the close used in code", () => {
    const migration = readFileSync(
      "prisma/migrations/20260928201000_hhsrs_close_sent_submissions/migration.sql",
      "utf8"
    );
    assert.equal(sqlBody(migration), CLOSE_OPEN_SENT_SUBMISSIONS_SQL);
    assert.match(migration, /'email_sent'/);
    assert.match(migration, /NOT IN \('email_sent', 'corrected', 'closed'\)/);
  });

  it("writes the case and the sent email together, and closes a case left open", async (t) => {
    if (!(await dbReady())) {
      t.skip("Postgres is not available");
      return;
    }
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const ids: string[] = [];
    const previousPassword = process.env.HHSRS_SMTP_PASSWORD;
    process.env.HHSRS_SMTP_PASSWORD = "test-only-not-a-real-password";
    t.after(async () => {
      if (ids.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: ids } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: ids } } });
      }
      if (previousPassword === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = previousPassword;
    });

    const open = await prisma.hhsrsSiteSubmission.create({ data: caseData(`${stamp}-open`) });
    ids.push(open.id);
    const sent: OutboundEmail[] = [];
    const result = await sendCaseEmail({
      row: open,
      sentBy: "Tom Sharp",
      senderFirstName: "Tom",
      senderFullName: "Tom Sharp",
      hasReporterAccess: true,
      body: {
        checked: "1",
        to: "repairs@savillshousing.co.uk",
        subject: "Test Housing - HHSRS – 1 Street",
        body: "Please arrange a repair.",
      },
      transport: {
        sendMail: async (mail) => {
          sent.push(mail);
          return { messageId: "<close-test@savillshousing.co.uk>", raw: Buffer.from("raw") };
        },
        appendToSent: async () => undefined,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Please arrange a repair\.\n\nRegards\n\nHHSRS Reporting Team\n/);
    assert.doesNotMatch(sent[0].text, /Regards\n\nTom/);

    const closed = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: open.id } });
    assert.equal(closed.status, "email_sent");
    assert.ok(closed.emailSentAt);
    assert.equal(closed.emailSentBy, "Tom Sharp");
    assert.equal(closed.emailSubject, "Test Housing - HHSRS – 1 Street");
    assert.equal(closed.emailBody, "Please arrange a repair.");
    const emails = await prisma.hhsrsSentEmail.findMany({ where: { submissionId: open.id } });
    assert.equal(emails.length, 1);
    assert.equal(emails[0].subject, closed.emailSubject);
    assert.equal(emails[0].body, closed.emailBody);
    assert.equal(emails[0].sentBy, closed.emailSentBy);
    assert.equal(emails[0].sentCopySaved, true);
    assert.equal(
      await prisma.hhsrsSiteSubmission.count({
        where: { id: open.id, status: { in: [...HHSRS_WAITING_STATUSES] } },
      }),
      0
    );
    assert.equal(
      await prisma.hhsrsSiteSubmission.count({
        where: { id: open.id, status: { in: [...HHSRS_ACTIONED_STATUSES] } },
      }),
      1
    );

    const stuck = await prisma.hhsrsSiteSubmission.create({ data: caseData(`${stamp}-stuck`) });
    ids.push(stuck.id);
    const early = new Date("2026-09-28T10:14:00.000Z");
    const later = new Date("2026-09-28T11:14:00.000Z");
    await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: stuck.id,
        sentAt: later,
        sentBy: "Later Person",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "later@savillshousing.co.uk",
        subject: "Later subject",
        body: "Later body",
        photoNames: [],
        sentCopySaved: true,
        kind: "original",
      },
    });
    await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: stuck.id,
        sentAt: early,
        sentBy: "Tom Sharp",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "Earliest subject",
        body: "Earliest body",
        photoNames: [],
        sentCopySaved: true,
        kind: "original",
      },
    });
    const retrySent: OutboundEmail[] = [];
    const stuckRow = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: stuck.id } });
    const retried = await sendCaseEmail({
      row: stuckRow,
      sentBy: "Tom Sharp",
      hasReporterAccess: true,
      body: { checked: "1", to: "repairs@savillshousing.co.uk", subject: "Do not send again", body: "No" },
      transport: {
        sendMail: async (mail) => {
          retrySent.push(mail);
          return { messageId: "<should-not-send@savillshousing.co.uk>", raw: Buffer.from("raw") };
        },
        appendToSent: async () => undefined,
      },
    });
    assert.equal(retried.ok, true);
    assert.equal(retrySent.length, 0);
    const repaired = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: stuck.id } });
    assert.equal(repaired.status, "email_sent");
    assert.equal(repaired.emailSentAt?.toISOString(), early.toISOString());
    assert.equal(repaired.emailSentBy, "Tom Sharp");
    assert.equal(repaired.emailSubject, "Earliest subject");
    assert.equal(repaired.emailBody, "Earliest body");
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: stuck.id } }), 2);
    assert.equal(
      await prisma.hhsrsSiteSubmission.count({
        where: { id: stuck.id, status: { in: [...HHSRS_WAITING_STATUSES] } },
      }),
      0
    );

    const refused = await prisma.hhsrsSiteSubmission.create({ data: caseData(`${stamp}-fail`) });
    ids.push(refused.id);
    const failed = await sendCaseEmail({
      row: refused,
      sentBy: "Tom Sharp",
      hasReporterAccess: true,
      body: { checked: "1", to: "repairs@savillshousing.co.uk", subject: "No", body: "No" },
      transport: {
        sendMail: async () => {
          throw new Error("SMTP 550 mailbox unavailable");
        },
        appendToSent: async () => undefined,
      },
    });
    assert.equal(failed.ok, false);
    const stillOpen = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: refused.id } });
    assert.equal(stillOpen.status, "new");
    assert.equal(stillOpen.emailSentAt, null);
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: refused.id } }), 0);

    const orphan = await prisma.hhsrsSiteSubmission.create({
      data: { ...caseData(`${stamp}-orphan`), claimedBy: "Phil Moon", claimedAt: new Date() },
    });
    ids.push(orphan.id);
    await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: orphan.id,
        sentAt: early,
        sentBy: "Tom Sharp",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "Logged subject",
        body: "Logged body",
        photoNames: [],
        sentCopySaved: true,
        kind: "original",
      },
    });
    await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: orphan.id,
        sentAt: later,
        sentBy: "Someone Else",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "CORRECTION: Logged subject",
        body: "Corrected body",
        photoNames: [],
        sentCopySaved: true,
        kind: "correction",
      },
    });
    const done = await prisma.hhsrsSiteSubmission.create({
      data: {
        ...caseData(`${stamp}-done`, "email_sent"),
        emailSentAt: early,
        emailSentBy: "Keep Sender",
        emailSubject: "Keep subject",
        emailBody: "Keep body",
      },
    });
    ids.push(done.id);
    await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: done.id,
        sentAt: early,
        sentBy: "Other Sender",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "Overwrite me",
        body: "Overwrite me",
        photoNames: [],
        kind: "original",
      },
    });
    const waiting = await prisma.hhsrsSiteSubmission.create({ data: caseData(`${stamp}-wait`) });
    ids.push(waiting.id);

    const closedCount = await closeSubmissionsLeftOpenAfterSend();
    assert.ok(closedCount >= 1);
    const fromMigration = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: orphan.id } });
    assert.equal(fromMigration.status, "corrected");
    assert.equal(fromMigration.emailSentAt?.toISOString(), early.toISOString());
    assert.equal(fromMigration.emailSentBy, "Tom Sharp");
    assert.equal(fromMigration.emailSubject, "Logged subject");
    assert.equal(fromMigration.emailBody, "Logged body");
    assert.equal(fromMigration.claimedBy, "");
    assert.equal(fromMigration.claimedAt, null);
    const untouched = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: done.id } });
    assert.equal(untouched.status, "email_sent");
    assert.equal(untouched.emailSentBy, "Keep Sender");
    assert.equal(untouched.emailSubject, "Keep subject");
    assert.equal(untouched.emailBody, "Keep body");
    const stillWaiting = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: waiting.id } });
    assert.equal(stillWaiting.status, "new");
    assert.equal(stillWaiting.emailSentAt, null);
  });
});

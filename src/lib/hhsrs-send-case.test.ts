process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

import { readFileSync } from "node:fs";
import http from "node:http";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { prisma } from "./prisma.js";
import { hashPassword } from "./passwords.js";
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
    assert.match(sent[0].text, /Please arrange a repair\.\n\n\nRegards\n\nHHSRS Reporting Team\n/);
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

  it("lets only the claimer send, logs that send once, and takes the case off Pending", async (t) => {
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

    const claimed = await prisma.hhsrsSiteSubmission.create({
      data: {
        ...caseData(`${stamp}-claim`),
        reference: `LOCK-${stamp}`.slice(0, 24),
        uprn: `58227${stamp}`.slice(0, 32),
        claimedBy: "Phil Moon",
        claimedAt: new Date(),
      },
    });
    ids.push(claimed.id);
    const blockedMail: OutboundEmail[] = [];
    const blocked = await sendCaseEmail({
      row: claimed,
      sentBy: "Peter May",
      actor: "Peter May",
      hasReporterAccess: true,
      body: { checked: "1", to: "repairs@savillshousing.co.uk", subject: "Do not send", body: "No" },
      transport: {
        sendMail: async (mail) => {
          blockedMail.push(mail);
          return { messageId: "<blocked@savillshousing.co.uk>", raw: Buffer.from("raw") };
        },
        appendToSent: async () => undefined,
      },
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /claimed by Phil Moon/);
    assert.equal(blockedMail.length, 0);
    const stillClaimed = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: claimed.id } });
    assert.equal(stillClaimed.status, "new");
    assert.equal(stillClaimed.claimedBy, "Phil Moon");
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: claimed.id } }), 0);
    assert.equal(
      await prisma.hhsrsSiteSubmission.count({
        where: { id: claimed.id, status: { in: [...HHSRS_WAITING_STATUSES] } },
      }),
      1
    );

    const sent: OutboundEmail[] = [];
    const transport = {
      sendMail: async (mail: OutboundEmail) => {
        sent.push(mail);
        return { messageId: `<once-${sent.length}@savillshousing.co.uk>`, raw: Buffer.from("raw") };
      },
      appendToSent: async () => undefined,
    };
    const [first, second] = await Promise.all([
      sendCaseEmail({
        row: claimed,
        sentBy: "Phil Moon",
        actor: "Phil Moon",
        hasReporterAccess: true,
        body: { checked: "1", to: "repairs@savillshousing.co.uk", subject: "Logged once", body: "Repair this." },
        transport,
      }),
      sendCaseEmail({
        row: claimed,
        sentBy: "Phil Moon",
        actor: "Phil Moon",
        hasReporterAccess: true,
        body: { checked: "1", to: "repairs@savillshousing.co.uk", subject: "Logged once", body: "Repair this." },
        transport,
      }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(sent.length, 1);
    const closed = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: claimed.id } });
    assert.equal(closed.status, "email_sent");
    assert.ok(closed.emailSentAt);
    assert.equal(closed.claimedBy, "");
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: claimed.id } }), 1);
    assert.equal(
      await prisma.hhsrsSiteSubmission.count({
        where: { id: claimed.id, status: { in: [...HHSRS_WAITING_STATUSES] } },
      }),
      0
    );
    assert.equal(
      await prisma.hhsrsSiteSubmission.count({
        where: { id: claimed.id, status: { in: [...HHSRS_ACTIONED_STATUSES] } },
      }),
      1
    );

    const stale = await prisma.hhsrsSiteSubmission.create({
      data: {
        ...caseData(`${stamp}-stale`),
        claimedBy: "Phil Moon",
        claimedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
      },
    });
    ids.push(stale.id);
    const staleMail: OutboundEmail[] = [];
    const staleBlocked = await sendCaseEmail({
      row: stale,
      sentBy: "Peter May",
      actor: "Peter May",
      hasReporterAccess: true,
      body: { checked: "1", to: "repairs@savillshousing.co.uk", subject: "No", body: "No" },
      transport: {
        sendMail: async (mail) => {
          staleMail.push(mail);
          return { messageId: "<stale@savillshousing.co.uk>", raw: Buffer.from("raw") };
        },
        appendToSent: async () => undefined,
      },
    });
    assert.equal(staleBlocked.ok, false);
    assert.equal(staleMail.length, 0);
    const staleRow = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: stale.id } });
    assert.equal(staleRow.status, "new");
    assert.equal(staleRow.claimedBy, "Phil Moon");
  });
});

type Hit = { status: number; location: string; body: string; setCookie: string[] };

function request(app: Express, method: string, url: string, opts: { body?: string; cookie?: string } = {}): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const headers: Record<string, string | number> = {};
      if (opts.body) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        headers["content-length"] = Buffer.byteLength(opts.body);
      }
      if (opts.cookie) headers.cookie = opts.cookie;
      const req = http.request({ host: "127.0.0.1", port, path: url, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          server.close();
          resolve({
            status: res.statusCode || 0,
            location: String(res.headers.location || ""),
            body: Buffer.concat(chunks).toString("utf8"),
            setCookie: ([] as string[]).concat(res.headers["set-cookie"] || []),
          });
        });
      });
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end(opts.body);
    });
  });
}

function cookieHeader(setCookie: string[], previous = ""): string {
  const next = new Map<string, string>();
  for (const part of previous.split(";").map((item) => item.trim()).filter(Boolean)) {
    const name = part.split("=")[0];
    if (name) next.set(name, part);
  }
  for (const item of setCookie) {
    const part = item.split(";")[0];
    const name = part.split("=")[0];
    if (name) next.set(name, part);
  }
  return [...next.values()].join("; ");
}

describe("claimed HHSRS case on the reporter", () => {
  it("lets a second person view a claimed case, but not edit, send, or abandon it", async (t) => {
    if (!(await dbReady())) {
      t.skip("Postgres is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!admin) {
      t.skip("Seeded admin is not available");
      return;
    }
    const stamp = `${Date.now().toString().slice(-6)}${Math.random().toString(16).slice(2, 6)}`;
    const username = `lock${stamp}`;
    const other = await prisma.user.create({
      data: {
        username,
        name: "Peter May",
        role: "admin",
        passwordHash: await hashPassword("LockTest2468"),
      },
    });
    const row = await prisma.hhsrsSiteSubmission.create({
      data: {
        ...caseData(`open-${stamp}`),
        reference: `CLM-${stamp}`,
        uprn: `58227${stamp}`,
        claimedBy: "Phil Moon",
        claimedAt: new Date(),
      },
    });
    t.after(async () => {
      await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: row.id } });
      await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: row.id } });
      await prisma.user.delete({ where: { id: other.id } }).catch(() => undefined);
    });

    const { createApp } = await import("../app.js");
    const app = createApp({ basePath: "" });
    const philLogin = await request(app, "POST", "/login", {
      body: "username=phil.m&password=PhilMoon2468",
    });
    assert.equal(philLogin.status, 302);
    const phil = cookieHeader(philLogin.setCookie);
    const owner = await request(app, "GET", `/HHSRSreporter/review/${row.id}`, { cookie: phil });
    assert.equal(owner.status, 200);
    assert.doesNotMatch(owner.body, /is-claim-locked/);
    assert.match(owner.body, /Abandon claim — return to pending/);
    assert.match(owner.body, /id="btn-send-email"/);
    assert.doesNotMatch(owner.body, /id="btn-send-email"[^>]*disabled/);

    const otherLogin = await request(app, "POST", "/login", {
      body: `username=${encodeURIComponent(username)}&password=LockTest2468`,
    });
    assert.equal(otherLogin.status, 302);
    let otherCookie = cookieHeader(otherLogin.setCookie);
    const viewed = await request(app, "GET", `/HHSRSreporter/review/${row.id}?claim=1`, { cookie: otherCookie });
    assert.equal(viewed.status, 200);
    assert.match(viewed.body, new RegExp(`CLM-${stamp}`));
    assert.match(viewed.body, /id="review-case-work"[^>]*class="is-claim-locked"[^>]*inert/);
    assert.match(viewed.body, /claimed by Phil Moon/);
    assert.match(viewed.body, /id="btn-send-email"[^>]*disabled/);
    assert.match(viewed.body, /id="btn-generate-email"[^>]*disabled/);
    assert.match(viewed.body, /id="btn-abandon-claim"[^>]*hidden/);
    assert.doesNotMatch(viewed.body, /id="ck-overlay"/);
    assert.doesNotMatch(viewed.body, /id="btn-dismiss-hazard"/);
    otherCookie = cookieHeader(viewed.setCookie, otherCookie);

    const send = await request(app, "POST", `/HHSRSreporter/review/${row.id}/send`, {
      cookie: otherCookie,
      body: "checked=1&to=repairs@savillshousing.co.uk&subject=No&body=No",
    });
    assert.equal(send.status, 302);
    assert.equal(send.location, "/HHSRSreporter");
    const abandon = await request(app, "POST", `/HHSRSreporter/review/${row.id}/abandon`, { cookie: otherCookie });
    assert.equal(abandon.status, 302);
    const stored = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.status, "new");
    assert.equal(stored.claimedBy, "Phil Moon");
    assert.equal(stored.emailSentAt, null);
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: row.id } }), 0);

    const released = await request(app, "POST", `/HHSRSreporter/review/${row.id}/abandon`, { cookie: phil });
    assert.equal(released.status, 302);
    const open = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(open.claimedBy, "");
    assert.equal(open.status, "new");
    const taken = await request(app, "GET", `/HHSRSreporter/review/${row.id}`, { cookie: otherCookie });
    assert.equal(taken.status, 200);
    assert.doesNotMatch(taken.body, /is-claim-locked/);
    assert.match(taken.body, /id="btn-abandon-claim"/);
    assert.doesNotMatch(taken.body, /id="btn-send-email"[^>]*disabled/);
    const takenRow = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(takenRow.claimedBy, "Peter May");
    assert.equal(takenRow.status, "new");
  });
});

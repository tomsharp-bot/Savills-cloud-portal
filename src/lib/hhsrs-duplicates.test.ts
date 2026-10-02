import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import { HHSRS_CASE_SEND, HHSRS_PHOTO_COPY } from "../routes/hhsrs-reporter.js";
import { HHSRS_SITE_PHOTO_STORAGE } from "./hhsrs-site-photos.js";
import { createSubmissionWithReference } from "./hhsrs-reference.js";
import { splitAddressPostcode } from "./hhsrs-office-case.js";
import { toDuplicateCompareRow, type CompareCase } from "./hhsrs-duplicate-compare.js";
import { validateNotNeededMove } from "./hhsrs-not-needed.js";

function refNumber(reference: string | null): number {
  return Number(String(reference || "").split("-").pop());
}

describe("not needed checks", () => {
  it("requires a real other reference for a duplicate, and a note for Other", async () => {
    const find = async (reference: string) =>
      reference === "MTVH-012" ? { id: "other", reference: "MTVH-012" } : null;
    const missing = await validateNotNeededMove({
      reason: "duplicate",
      duplicateOf: "NOPE-1",
      note: "",
      selfReference: "MTVH-015",
      findReference: find,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "That reference does not exist.");

    const self = await validateNotNeededMove({
      reason: "duplicate",
      duplicateOf: "mtvh-015",
      note: "",
      selfReference: "MTVH-015",
      findReference: async () => ({ id: "self", reference: "MTVH-015" }),
    });
    assert.equal(self.ok, false);
    if (!self.ok) assert.match(self.error, /itself/);

    const other = await validateNotNeededMove({
      reason: "other",
      duplicateOf: "",
      note: "   ",
      selfReference: "MTVH-015",
      findReference: find,
    });
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.error, "Add a short note.");

    const ok = await validateNotNeededMove({
      reason: "duplicate",
      duplicateOf: "mtvh-012",
      note: "Same mould report.",
      selfReference: "MTVH-015",
      findReference: find,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.duplicateOf, "MTVH-012");
      assert.equal(ok.note, "Same mould report.");
    }

    const test = await validateNotNeededMove({
      reason: "test",
      duplicateOf: "",
      note: "",
      selfReference: null,
      findReference: find,
    });
    assert.equal(test.ok, true);
    if (test.ok) assert.equal(test.duplicateOf, "");
  });

  it("splits a trailing postcode from an office address", () => {
    assert.deepEqual(splitAddressPostcode("Flat 2, 8 Pretend Street, Sampleton, ZZ1 2AB"), {
      fullAddress: "Flat 2, 8 Pretend Street, Sampleton",
      postcode: "ZZ1 2AB",
    });
    assert.equal(splitAddressPostcode("12 High Street").postcode, "");
  });

  it("describes the duplicates tab and hides Not needed until there is a case", () => {
    const page = readFileSync("views/hhsrs-reporter/duplicates.ejs", "utf8");
    const side = readFileSync("views/hhsrs-reporter/partials/sidebar.ejs", "utf8");
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    assert.match(page, /page-section-title/);
    assert.match(page, /Click the later case to compare it with the one already sent\./);
    assert.match(page, /View duplicate/);
    assert.match(page, /Close duplicate/);
    assert.match(page, /Not a duplicate/);
    assert.match(page, /\/duplicates\/<%= item.id %>\/not-duplicate/);
    assert.match(page, /Amend and resend/);
    assert.match(page, /already sent/);
    assert.match(page, /Where the first is/);
    assert.doesNotMatch(page, /delete/i);
    assert.match(side, /Duplicates &amp; Errors/);
    assert.match(side, /summary\.duplicates > 0 \? 'needs-attention'/);
    assert.match(side, /summary\.waiting > 0 \? ' needs-attention' : ' is-clear'/);
    assert.match(
      readFileSync("public/css/hhsrs-reporter.css", "utf8"),
      /\.side-tabs \.tab-link\.needs-attention\s*\{[\s\S]*?background:\s*var\(--savills-red\)/
    );
    assert.match(review, /showDismissHazard/);
    assert.match(review, /review\/office-send/);
  });

  it("puts the sent case on the left and offers amend only when the later case differs", () => {
    const sent: CompareCase = {
      id: "sent-id",
      reference: "MTVH-014",
      uprn: "98756",
      fullAddress: "1 Jenkins House",
      postcode: "B14 6ES",
      category: "Damp & Mould Growth",
      rating: "Medium",
      comment: "Mould around window",
      surveyDate: "2026-09-20",
      status: "email_sent",
      emailSentAt: new Date("2026-09-20T12:00:00.000Z"),
      createdAt: new Date("2026-09-20T09:00:00.000Z"),
      notNeededReason: "",
      notNeededDuplicateOf: "",
    };
    const later: CompareCase = {
      ...sent,
      id: "later-id",
      reference: "MTVH-021",
      rating: "High",
      comment: "Visible mould in bathroom",
      surveyDate: "2026-09-28",
      status: "not_needed",
      emailSentAt: null,
      createdAt: new Date("2026-09-28T09:00:00.000Z"),
      notNeededReason: "duplicate",
      notNeededDuplicateOf: "MTVH-014",
    };
    const row = toDuplicateCompareRow(later, sent, { open: false, reporterBase: "/HHSRSreporter" });
    assert.equal(row.address, "1 Jenkins House, B14 6ES");
    assert.equal(row.matches, "Case MTVH-014");
    assert.equal(row.whereFirst, "Main Log, emailed 20/09/2026");
    assert.equal(row.left?.heading, "Case MTVH-014 · already sent");
    assert.equal(row.right?.heading, "Later case · not emailed");
    assert.equal(row.diff.address, false);
    assert.equal(row.diff.uprn, false);
    assert.equal(row.diff.hazard, false);
    assert.equal(row.diff.rating, true);
    assert.equal(row.diff.siteNotes, true);
    assert.equal(row.diff.surveyDate, true);
    assert.equal(row.amendUrl, "/HHSRSreporter/find?case=sent-id&view=amend");

    const same = toDuplicateCompareRow(
      { ...later, rating: "Medium", comment: "Mould around window", surveyDate: "2026-09-20", uprn: "98 756" },
      sent,
      { open: true, reporterBase: "/HHSRSreporter" }
    );
    assert.equal(same.diff.rating, false);
    assert.equal(same.diff.siteNotes, false);
    assert.equal(same.diff.surveyDate, false);
    assert.equal(same.diff.uprn, false);
    assert.equal(same.amendUrl, "");
    assert.equal(same.open, true);
  });
});

type Hit = { status: number; location: string; body: string; setCookie: string[] };

function listen(app: ReturnType<typeof createApp>): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

async function request(
  port: number,
  method: string,
  urlPath: string,
  opts: { cookie?: string; form?: Record<string, string>; raw?: Buffer; contentType?: string } = {}
): Promise<Hit> {
  const headers: Record<string, string> = {};
  let body: string | Buffer | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.raw) {
    headers["content-type"] = opts.contentType || "application/octet-stream";
    body = opts.raw;
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers,
    body: typeof body === "string" || body == null ? body : new Uint8Array(body),
    redirect: "manual",
  });
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get("location") || "",
    setCookie,
  };
}

function cookieHeader(setCookie: string[], previous = ""): string {
  const jar = new Map<string, string>();
  for (const part of previous.split(";").map((item) => item.trim()).filter(Boolean)) {
    const name = part.split("=")[0];
    if (name) jar.set(name, part);
  }
  for (const item of setCookie) {
    const part = item.split(";")[0];
    const name = part.split("=")[0];
    if (name) jar.set(name, part);
  }
  return [...jar.values()].join("; ");
}

describe("duplicates and office emails with the database", () => {
  it("moves a case out of Pending, keeps an audit trail, and blocks a sent case", async (t) => {
    try {
      await prisma.$queryRaw`SELECT "notNeededReason" FROM "HhsrsSiteSubmission" LIMIT 1`;
    } catch {
      t.skip("Postgres with the not-needed columns is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!admin) {
      t.skip("Seeded admin is not available");
      return;
    }
    const stamp = Date.now();
    const project = await prisma.project.create({
      data: {
        name: `Dup Project ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: "DUPX",
      },
    });
    const created: string[] = [];
    const app = createApp({ basePath: "" });
    app.set(HHSRS_PHOTO_COPY, async () => undefined);
    const { server, port } = await listen(app);
    t.after(async () => {
      server.close();
      if (created.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: created } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
      }
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const make = async (uprn: string, address: string) => {
      const row = await createSubmissionWithReference({ projectId: project.id, projectName: project.name }, (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-27",
            uprn,
            fullAddress: address,
            postcode: "ZZ1 2AB",
            surveyorName: "Sam Surveyor",
            category: "Damp & Mould Growth",
            rating: "Severe",
            comment: "Black mould on the bedroom ceiling.",
            otherDetails: "Tenant says this was reported last week.",
            photoPaths: [],
            reference,
            status: "in_review",
          },
        })
      );
      created.push(row.id);
      return row;
    };

    const original = await make(`8${stamp}`, `8 Original Street ${stamp}`);
    const duplicate = await make(`9${stamp}`, `9 Duplicate Street ${stamp}`);
    const sent = await make(`7${stamp}`, `7 Sent Street ${stamp}`);

    const prevMock = process.env.HHSRS_SEND_MOCK;
    const prevPass = process.env.HHSRS_SMTP_PASSWORD;
    process.env.HHSRS_SEND_MOCK = "1";
    process.env.HHSRS_SMTP_PASSWORD = prevPass || "test-not-sent";
    try {
      const login = await request(port, "POST", "/login", {
        form: { username: "phil.m", password: "PhilMoon2468" },
      });
      assert.equal(login.status, 302);
      let cookie = cookieHeader(login.setCookie);

      const blank = await request(port, "GET", "/HHSRSreporter/review", { cookie });
      assert.equal(blank.status, 200);
      assert.match(blank.body, /Send and log/);
      assert.doesNotMatch(blank.body, /id="btn-dismiss-hazard"/);

      const review = await request(port, "GET", `/HHSRSreporter/review/${duplicate.id}`, { cookie });
      assert.equal(review.status, 200);
      assert.match(review.body, /id="btn-dismiss-hazard"/);
      assert.match(review.body, /No email is sent/);
      assert.doesNotMatch(review.body, /id="btn-not-needed"/);
      assert.match(review.body, /Sends the email and adds it to the Main Log/);
      assert.match(review.body, /Abandon claim — return to pending/);
      const actions = review.body.slice(review.body.indexOf('class="actions-row"'), review.body.indexOf('id="review-workspace"'));
      assert.match(actions, /Abandon claim — return to pending/);
      assert.doesNotMatch(review.body.slice(review.body.indexOf('id="rv-finish-bar"')), /Abandon claim/);

      const missing = await request(port, "POST", `/HHSRSreporter/review/${duplicate.id}/not-needed`, {
        cookie,
        form: { reason: "duplicate", duplicateOf: "NONE-999", note: "" },
      });
      assert.equal(missing.status, 302);
      cookie = cookieHeader(missing.setCookie, cookie);
      const missingPage = await request(port, "GET", missing.location, { cookie });
      assert.match(missingPage.body, /That reference does not exist/);

      const noNote = await request(port, "POST", `/HHSRSreporter/review/${duplicate.id}/not-needed`, {
        cookie,
        form: { reason: "other", duplicateOf: "", note: "" },
      });
      assert.equal(noNote.status, 302);
      cookie = cookieHeader(noNote.setCookie, cookie);
      const noNotePage = await request(port, "GET", noNote.location, { cookie });
      assert.match(noNotePage.body, /Add a short note/);

      const moved = await request(port, "POST", `/HHSRSreporter/review/${duplicate.id}/not-needed`, {
        cookie,
        form: { reason: "duplicate", duplicateOf: original.reference || "", note: "Same mould report, sent again from site." },
      });
      assert.equal(moved.status, 302);
      assert.equal(moved.location, "/HHSRSreporter");
      cookie = cookieHeader(moved.setCookie, cookie);
      const pending = await request(port, "GET", moved.location, { cookie });
      assert.match(pending.body, /Moved to Duplicates &amp; Errors\./);
      const waiting = pending.body.slice(
        pending.body.indexOf('id="waiting-table"'),
        pending.body.indexOf('id="last-actioned"')
      );
      const dupeRow = waiting.split("<tr").find((part) => part.includes(`9 Duplicate Street ${stamp}`));
      assert.ok(dupeRow);
      assert.match(dupeRow, /\bpending-dupe\b/);
      assert.match(dupeRow, new RegExp(`${duplicate.uprn}</span> <span class="pending-dupe-tag">Dupe</span>`));
      const addrCell = dupeRow.match(/<td class="addr-cell[^"]*">[\s\S]*?<\/td>/);
      assert.ok(addrCell);
      assert.doesNotMatch(addrCell[0], /Dupe/);
      assert.equal(pending.body.slice(pending.body.indexOf('id="last-actioned"')).includes(`9 Duplicate Street ${stamp}`), false);

      const stored = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: duplicate.id } });
      assert.equal(stored?.status, "not_needed");
      assert.equal(stored?.notNeededReason, "duplicate");
      assert.equal(stored?.notNeededDuplicateOf, original.reference);
      assert.equal(stored?.emailSentAt, null);
      assert.ok(stored?.notNeededBy);

      const tab = await request(port, "GET", "/HHSRSreporter/duplicates", { cookie });
      assert.equal(tab.status, 200);
      assert.match(tab.body, /tab-link[^"]*needs-attention/);
      assert.match(tab.body, /Click the later case to compare it with the one already sent\./);
      assert.match(tab.body, /Duplicates &amp; Errors/);
      assert.match(tab.body, /View duplicate/);
      assert.match(tab.body, new RegExp(`9 Duplicate Street ${stamp}`));
      assert.match(tab.body, new RegExp(`Case ${original.reference}`));
      assert.match(tab.body, /class="tool-header"/);
      assert.doesNotMatch(tab.body, /class="step-tabs"/);

      const mainLog = await request(port, "GET", "/HHSRSreporter/main-log", { cookie });
      assert.doesNotMatch(mainLog.body, new RegExp(duplicate.reference || "no-ref"));

      const panel = await request(
        port,
        "GET",
        `/HHSRSreporter/duplicates?q=${encodeURIComponent(duplicate.uprn)}&open=${duplicate.id}`,
        { cookie }
      );
      assert.match(panel.body, /Close duplicate/);
      assert.match(panel.body, /Black mould on the bedroom ceiling/);
      assert.match(panel.body, new RegExp(`8 Original Street ${stamp}`));
      assert.match(panel.body, new RegExp(`9 Duplicate Street ${stamp}`));
      assert.match(panel.body, /Pending/);
      assert.doesNotMatch(panel.body, /Amend and resend/);

      const back = await request(port, "POST", `/HHSRSreporter/duplicates/${duplicate.id}/restore`, { cookie });
      assert.equal(back.status, 302);
      cookie = cookieHeader(back.setCookie, cookie);
      const restored = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: duplicate.id } });
      assert.equal(restored?.status, "new");
      assert.equal(restored?.notNeededReason, "");
      assert.equal(restored?.notNeededDuplicateOf, "");
      assert.equal(restored?.notNeededNote, "");
      assert.equal(restored?.notNeededAt, null);
      const log = Array.isArray(restored?.notNeededLog) ? restored.notNeededLog : [];
      assert.equal(log.length, 2);
      assert.equal((log[0] as { action?: string }).action, "moved");
      assert.equal((log[1] as { action?: string }).action, "restored");
      const backPage = await request(port, "GET", back.location, { cookie });
      assert.match(backPage.body, new RegExp(`${duplicate.reference} moved back to Pending`));

      const send = await request(port, "POST", `/HHSRSreporter/review/${sent.id}/send`, {
        cookie,
        form: {
          checked: "1",
          to: "housing.team@savillshousing.co.uk",
          subject: "HHSRS hazard",
          body: "Logged from the portal.",
        },
      });
      assert.equal(send.status, 302);
      cookie = cookieHeader(send.setCookie, cookie);
      const blocked = await request(port, "POST", `/HHSRSreporter/review/${sent.id}/not-needed`, {
        cookie,
        form: { reason: "test", note: "" },
      });
      assert.equal(blocked.status, 302);
      cookie = cookieHeader(blocked.setCookie, cookie);
      const blockedPage = await request(port, "GET", blocked.location, { cookie });
      assert.match(blockedPage.body, /already sent/i);
      const stillSent = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: sent.id } });
      assert.equal(stillSent?.status, "email_sent");
      assert.ok(stillSent?.emailSentAt);
    } finally {
      if (prevMock === undefined) delete process.env.HHSRS_SEND_MOCK;
      else process.env.HHSRS_SEND_MOCK = prevMock;
      if (prevPass === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = prevPass;
    }
  });

  it("creates an office case on the same reference sequence and leaves it pending if send fails", async (t) => {
    try {
      await prisma.$queryRaw`SELECT "source" FROM "HhsrsSiteSubmission" LIMIT 1`;
    } catch {
      t.skip("Postgres with the office-case columns is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!admin) {
      t.skip("Seeded admin is not available");
      return;
    }
    const stamp = Date.now();
    const project = await prisma.project.create({
      data: {
        name: `Office Project ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: "OFFC",
      },
    });
    const created: string[] = [];
    const prevMock = process.env.HHSRS_SEND_MOCK;
    const prevPass = process.env.HHSRS_SMTP_PASSWORD;
    process.env.HHSRS_SEND_MOCK = "1";
    process.env.HHSRS_SMTP_PASSWORD = prevPass || "test-not-sent";
    const app = createApp({ basePath: "" });
    app.set(HHSRS_PHOTO_COPY, async () => undefined);
    const { server, port } = await listen(app);
    t.after(async () => {
      server.close();
      if (created.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: created } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
      }
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
      if (prevMock === undefined) delete process.env.HHSRS_SEND_MOCK;
      else process.env.HHSRS_SEND_MOCK = prevMock;
      if (prevPass === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = prevPass;
    });

    const first = await createSubmissionWithReference({ projectId: project.id, projectName: project.name }, (tx, reference) =>
      tx.hhsrsSiteSubmission.create({
        data: {
          projectId: project.id,
          projectName: project.name,
          surveyDate: "2026-09-27",
          uprn: `1${stamp}`,
          fullAddress: "1 First Street",
          postcode: "ZZ1 1AA",
          surveyorName: "Sam Surveyor",
          category: "Damp & Mould Growth",
          rating: "Low",
          comment: "first",
          photoPaths: [],
          reference,
          status: "new",
        },
      })
    );
    created.push(first.id);

    const login = await request(port, "POST", "/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    let cookie = cookieHeader(login.setCookie);
    const uprn = `2${stamp}`;
    const sent = await request(port, "POST", "/HHSRSreporter/review/office-send", {
      cookie,
      form: {
        checked: "1",
        project: project.name,
        address: `2 Office Street ${stamp}, ZZ2 2BB`,
        uprn,
        hazard: "Excess Cold",
        rating: "Severe",
        surveyor: "Office Surveyor",
        notes: "Office-created hazard.",
        to: "repairs@savillshousing.co.uk",
        subject: "OFFC - HHSRS – 2 Office Street",
        body: "Please arrange a repair.",
      },
    });
    assert.equal(sent.status, 302, sent.body.slice(0, 300));
    assert.match(sent.location, /\/HHSRSreporter\/review\//);
    cookie = cookieHeader(sent.setCookie, cookie);
    const officeId = sent.location.split("/").pop() || "";
    created.push(officeId);
    const office = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: officeId } });
    assert.ok(office);
    assert.equal(office?.source, "office");
    assert.ok(office?.createdBy);
    assert.equal(office?.status, "email_sent");
    assert.ok(office?.emailSentAt);
    assert.equal(office?.postcode, "ZZ2 2BB");
    assert.equal(refNumber(office?.reference || ""), refNumber(first.reference) + 1);
    assert.equal(String(office?.reference || "").split("-")[0], String(first.reference || "").split("-")[0]);
    const emails = await prisma.hhsrsSentEmail.findMany({ where: { submissionId: officeId } });
    assert.equal(emails.length, 1);
    assert.equal(emails[0].kind, "original");

    const logged = await request(port, "GET", "/HHSRSreporter/main-log", { cookie });
    assert.match(logged.body, new RegExp(office?.reference || "missing"));
    const found = await request(port, "GET", `/HHSRSreporter/find?q=${encodeURIComponent(office?.reference || "")}`, {
      cookie,
    });
    assert.match(found.body, new RegExp(office?.reference || "missing"));

    const failApp = createApp({ basePath: "" });
    failApp.set(HHSRS_PHOTO_COPY, async () => undefined);
    failApp.set(HHSRS_CASE_SEND, async () => ({ ok: false, error: "Mailbox refused." }));
    const failListen = await listen(failApp);
    t.after(() => failListen.server.close());
    const failLogin = await request(failListen.port, "POST", "/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    const failCookie = cookieHeader(failLogin.setCookie);
    const failUprn = `3${stamp}`;
    const failed = await request(failListen.port, "POST", "/HHSRSreporter/review/office-send", {
      cookie: failCookie,
      form: {
        checked: "1",
        project: project.name,
        address: "3 Fail Street",
        uprn: failUprn,
        hazard: "Lighting",
        rating: "Low",
        to: "repairs@savillshousing.co.uk",
        subject: "Not sent",
        body: "Try again.",
      },
    });
    assert.equal(failed.status, 302, failed.body.slice(0, 300));
    const failId = failed.location.split("/").pop() || "";
    created.push(failId);
    const failCookie2 = cookieHeader(failed.setCookie, failCookie);
    const failPage = await request(failListen.port, "GET", failed.location, { cookie: failCookie2 });
    assert.match(failPage.body, /Not sent\. The case is in Pending so you can try again\./);
    const pendingRow = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: failId } });
    assert.equal(pendingRow?.status, "new");
    assert.equal(pendingRow?.emailSentAt, null);
    assert.equal(pendingRow?.source, "office");
    const failMails = await prisma.hhsrsSentEmail.findMany({ where: { submissionId: failId } });
    assert.equal(failMails.length, 0);

    const photoApp = createApp({ basePath: "" });
    photoApp.set(HHSRS_SITE_PHOTO_STORAGE, {
      put: async () => false,
      get: async () => null,
      remove: async () => true,
    });
    const photoListen = await listen(photoApp);
    t.after(() => photoListen.server.close());
    const photoLogin = await request(photoListen.port, "POST", "/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    const boundary = "----hhsrsOffice";
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const photoUprn = `4${stamp}`;
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="checked"\r\n\r\n1\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="project"\r\n\r\n${project.name}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="address"\r\n\r\n4 Photo Street\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="uprn"\r\n\r\n${photoUprn}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="hazard"\r\n\r\nLighting\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="rating"\r\n\r\nLow\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="to"\r\n\r\nrepairs@savillshousing.co.uk\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\nPhoto\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="body"\r\n\r\nBody\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="room.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ];
    const raw = Buffer.concat([
      Buffer.from(parts.join("")),
      jpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const photoRes = await request(photoListen.port, "POST", "/HHSRSreporter/review/office-send", {
      cookie: cookieHeader(photoLogin.setCookie),
      raw,
      contentType: `multipart/form-data; boundary=${boundary}`,
    });
    assert.equal(photoRes.status, 302);
    assert.equal(photoRes.location, "/HHSRSreporter/review");
    const photoPage = await request(photoListen.port, "GET", photoRes.location, {
      cookie: cookieHeader(photoRes.setCookie, cookieHeader(photoLogin.setCookie)),
    });
    assert.match(photoPage.body, /Photos could not be saved|Nothing was kept/);
    const leftover = await prisma.hhsrsSiteSubmission.findFirst({ where: { uprn: photoUprn } });
    assert.equal(leftover, null);
  });
});

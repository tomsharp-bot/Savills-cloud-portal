import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import { HHSRS_PHOTO_COPY } from "../routes/hhsrs-reporter.js";
import { createSubmissionWithReference } from "./hhsrs-reference.js";
import {
  DISMISS_HAZARD_REASONS,
  dismissHazardLogLine,
  isDismissHazardReason,
} from "./hhsrs-dismiss.js";
import { dismissLogLine } from "./hhsrs-office-check.js";

describe("dismiss hazard reasons", () => {
  it("uses two fixed lines and leaves an older free-text decision alone", () => {
    assert.deepEqual(
      DISMISS_HAZARD_REASONS.map((item) => item.label),
      ["Test case", "Dismiss hazard"]
    );
    assert.equal(DISMISS_HAZARD_REASONS[0].hint, "");
    assert.equal(dismissHazardLogLine("test"), "Test case");
    assert.equal(dismissHazardLogLine("hazard"), "Reviewed, hazard rating not required.");
    assert.equal(isDismissHazardReason("duplicate"), false);
    assert.equal(isDismissHazardReason("surveyor_error"), false);
    assert.equal(
      dismissHazardLogLine("Not a hazard — the window is fine.", "Tom Sharp"),
      dismissLogLine("Tom Sharp", "Not a hazard — the window is fine.")
    );
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const dialog = review.slice(review.indexOf('id="dh-overlay"'));
    assert.match(dialog, /Dismiss hazard\?/);
    assert.match(dialog, /id="dh-cancel"/);
    assert.match(dialog, /id="dh-confirm"[^>]*>Dismiss</);
    assert.match(dialog, /Reason <abbr title="required">/);
    assert.doesNotMatch(dialog, /surveyor_error|Surveyor correction|value="duplicate"|value="other"/);
    assert.match(review, /id="btn-restore-dismiss"/);
    assert.match(review, /Abandon — return to dismissed/);
    const log = readFileSync("views/hhsrs-reporter/main-log.ejs", "utf8");
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    const js = readFileSync("public/js/hhsrs-reporter.js", "utf8");
    assert.doesNotMatch(log, /View pack/);
    assert.match(log, />Open case</);
    assert.match(review, /is-dismissed-case/);
    assert.match(review, /is-dismissed-lock/);
    assert.match(review, /sentEmail \|\| caseDismissed \? "disabled"/);
    assert.match(css, /#rv-case-panel\.is-dismissed-case #rv-case-fields/);
    assert.match(css, /#rv-project-block\.is-dismissed-case/);
    assert.match(css, /\.email-draft-panel\.is-dismissed-lock \.field-with-copy/);
    assert.match(js, /function dismissedStage/);
    assert.match(js, /fields\.inert = sent \|\| dismissed/);
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
  opts: { cookie?: string; form?: Record<string, string> } = {}
): Promise<Hit> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers,
    body,
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

describe("dismiss hazard flow with the database", () => {
  it("dismisses, restores, abandons back, and sends as a normal Main Log row", async (t) => {
    try {
      await prisma.$queryRaw`SELECT "dismissedDecision" FROM "HhsrsSiteSubmission" LIMIT 1`;
    } catch {
      t.skip("Postgres with the dismiss columns is not available");
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
        name: `Dismiss Project ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: "DSMX",
      },
    });
    const created: string[] = [];
    const app = createApp({ basePath: "" });
    app.set(HHSRS_PHOTO_COPY, async () => undefined);
    const { server, port } = await listen(app);
    const prevMock = process.env.HHSRS_SEND_MOCK;
    const prevPass = process.env.HHSRS_SMTP_PASSWORD;
    const prevEnv = process.env.NODE_ENV;
    process.env.HHSRS_SEND_MOCK = "1";
    process.env.HHSRS_SMTP_PASSWORD = prevPass || "test-not-sent";
    if (process.env.NODE_ENV === "production") process.env.NODE_ENV = "test";
    t.after(async () => {
      server.close();
      if (prevMock === undefined) delete process.env.HHSRS_SEND_MOCK;
      else process.env.HHSRS_SEND_MOCK = prevMock;
      if (prevPass === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = prevPass;
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
      if (created.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: created } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
      }
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const make = async (address: string) => {
      const row = await createSubmissionWithReference(
        { projectId: project.id, projectName: project.name },
        (tx, reference) =>
          tx.hhsrsSiteSubmission.create({
            data: {
              projectId: project.id,
              projectName: project.name,
              surveyDate: "2026-10-02",
              uprn: `4${stamp}${created.length}`,
              fullAddress: address,
              postcode: "ZZ1 2AB",
              surveyorName: "Sam Surveyor",
              category: "Damp & Mould Growth",
              rating: "Low",
              comment: "A waiting hazard.",
              photoPaths: [],
              reference,
              status: "in_review",
              claimedBy: "Phil Moon",
              claimedAt: new Date(),
            },
          })
      );
      created.push(row.id);
      return row;
    };

    const testCase = await make(`1 Test Dismiss ${stamp}`);
    const hazardCase = await make(`2 Hazard Dismiss ${stamp}`);

    const login = await request(port, "POST", "/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    assert.equal(login.status, 302);
    let cookie = cookieHeader(login.setCookie);

    const missing = await request(port, "POST", `/HHSRSreporter/review/${testCase.id}/dismiss`, {
      cookie,
      form: { reason: "" },
    });
    assert.equal(missing.status, 302);
    cookie = cookieHeader(missing.setCookie, cookie);
    const missingPage = await request(port, "GET", missing.location, { cookie });
    assert.match(missingPage.body, /Pick a reason/);

    const dismissed = await request(port, "POST", `/HHSRSreporter/review/${testCase.id}/dismiss`, {
      cookie,
      form: { reason: "test" },
    });
    assert.equal(dismissed.status, 302);
    assert.match(dismissed.location, /main-log\?open=case:/);
    cookie = cookieHeader(dismissed.setCookie, cookie);
    const stored = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: testCase.id } });
    assert.equal(stored?.status, "dismissed");
    assert.equal(stored?.dismissedDecision, "test");
    assert.equal(stored?.emailSentAt, null);
    assert.equal(stored?.claimedBy, "");
    const dismissedAt = stored?.dismissedAt?.toISOString();
    assert.ok(dismissedAt);
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: testCase.id } }), 0);

    const pending = await request(port, "GET", "/HHSRSreporter", { cookie });
    const waiting = pending.body.slice(
      pending.body.indexOf('id="waiting-table"'),
      pending.body.indexOf('id="last-actioned"')
    );
    assert.equal(waiting.includes(`1 Test Dismiss ${stamp}`), false);

    const log = await request(port, "GET", dismissed.location, { cookie });
    assert.match(log.body, /Test case/);
    assert.match(log.body, new RegExp(`1 Test Dismiss ${stamp}`));
    assert.match(log.body, /\/restore/);
    assert.match(log.body, /Open case/);
    assert.doesNotMatch(log.body, /View pack/);

    const opened = await request(port, "GET", `/HHSRSreporter/review/${testCase.id}`, { cookie });
    assert.equal(opened.status, 200);
    assert.match(opened.body, /id="btn-restore-dismiss"/);
    assert.match(opened.body, /Test case/);
    assert.match(opened.body, /Restore it before sending/);
    assert.match(opened.body, /is-dismissed-case/);
    assert.match(opened.body, /is-dismissed-lock/);
    assert.match(opened.body, /id="rv-case-fields"[^>]*disabled/);
    assert.match(opened.body, /id="rv-project"[^>]*disabled/);
    assert.match(opened.body, /disabled[^>]*>Save review</);
    assert.match(opened.body, /id="btn-generate-email"[^>]*disabled/);
    assert.match(opened.body, /id="btn-send-email"[^>]*disabled/);
    assert.match(opened.body, /id="hhsrs-body"[^>]*readonly/);
    assert.doesNotMatch(opened.body, /id="btn-dismiss-hazard"/);
    assert.doesNotMatch(opened.body, /View pack/);

    const tamper = await request(port, "POST", `/HHSRSreporter/review/${testCase.id}`, {
      cookie,
      form: {
        expectedUpdatedAt: stored?.updatedAt.toISOString() || "",
        status: "in_review",
        rating: "High - Emergency risk",
        clientDescription: "Changed while dismissed",
      },
    });
    assert.equal(tamper.status, 302);
    cookie = cookieHeader(tamper.setCookie, cookie);
    const tamperPage = await request(port, "GET", tamper.location, { cookie });
    assert.match(tamperPage.body, /Restore it before editing/);
    assert.match(tamperPage.body, /is-dismissed-case/);
    const untouched = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: testCase.id } });
    assert.equal(untouched?.status, "dismissed");
    assert.equal(untouched?.rating, "Low");
    assert.notEqual(untouched?.clientDescription, "Changed while dismissed");
    assert.equal(untouched?.dismissedAt?.toISOString(), dismissedAt);

    const blockedSend = await request(port, "POST", `/HHSRSreporter/review/${testCase.id}/send`, {
      cookie,
      form: {
        checked: "1",
        to: "housing.team@savillshousing.co.uk",
        subject: "HHSRS hazard",
        body: "Should not send.",
        rating: "High - Emergency risk",
      },
    });
    assert.equal(blockedSend.status, 302);
    cookie = cookieHeader(blockedSend.setCookie, cookie);
    const stillDismissed = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: testCase.id } });
    assert.equal(stillDismissed?.status, "dismissed");
    assert.equal(stillDismissed?.rating, "Low");
    assert.equal(stillDismissed?.emailSentAt, null);
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: testCase.id } }), 0);

    const restored = await request(port, "POST", `/HHSRSreporter/review/${testCase.id}/restore`, { cookie });
    assert.equal(restored.status, 302);
    assert.equal(restored.location, `/HHSRSreporter/review/${testCase.id}`);
    cookie = cookieHeader(restored.setCookie, cookie);
    const back = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: testCase.id } });
    assert.equal(back?.status, "in_review");
    assert.equal(back?.claimedBy, "Phil Moon");
    assert.equal(back?.dismissedDecision, "test");
    assert.equal(back?.dismissedAt?.toISOString(), dismissedAt);
    const review = await request(port, "GET", restored.location, { cookie });
    assert.match(review.body, /Restored to Review &amp; Create/);
    assert.match(review.body, /id="btn-dismiss-hazard"/);
    assert.match(review.body, /Abandon — return to dismissed/);
    assert.match(review.body, /<strong>Test case<\/strong>/);
    assert.match(review.body, /Reviewed, hazard rating not required\./);
    assert.doesNotMatch(review.body, /is-dismissed-case/);
    assert.doesNotMatch(review.body, /is-dismissed-lock/);
    assert.doesNotMatch(review.body, /disabled[^>]*>Save review</);
    assert.match(review.body, /id="btn-generate-email"\s*>/);
    assert.doesNotMatch(review.body, /id="btn-send-email"[^>]*disabled/);
    assert.doesNotMatch(review.body, /id="rv-case-fields"[^>]*disabled/);

    const abandoned = await request(port, "POST", `/HHSRSreporter/review/${testCase.id}/abandon`, { cookie });
    assert.equal(abandoned.status, 302);
    assert.match(abandoned.location, /main-log\?open=case:/);
    cookie = cookieHeader(abandoned.setCookie, cookie);
    const parked = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: testCase.id } });
    assert.equal(parked?.status, "dismissed");
    assert.equal(parked?.dismissedDecision, "test");
    assert.equal(parked?.dismissedAt?.toISOString(), dismissedAt);
    assert.equal(parked?.claimedBy, "");
    const parkedLog = await request(port, "GET", abandoned.location, { cookie });
    assert.match(parkedLog.body, /<span class="ml-row-note">Test case<\/span>/);

    const again = await request(port, "POST", `/HHSRSreporter/review/${testCase.id}/restore`, { cookie });
    assert.equal(again.status, 302);
    cookie = cookieHeader(again.setCookie, cookie);
    const send = await request(port, "POST", `/HHSRSreporter/review/${testCase.id}/send`, {
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
    const sent = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: testCase.id } });
    assert.equal(sent?.status, "email_sent");
    assert.ok(sent?.emailSentAt);
    assert.equal(sent?.dismissedDecision, "");
    assert.equal(sent?.dismissedBy, "");
    assert.equal(sent?.dismissedAt, null);
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: testCase.id } }), 1);
    const sentLog = await request(
      port,
      "GET",
      `/HHSRSreporter/main-log?q=${encodeURIComponent(`1 Test Dismiss ${stamp}`)}`,
      { cookie }
    );
    assert.match(sentLog.body, new RegExp(`1 Test Dismiss ${stamp}`));
    assert.doesNotMatch(sentLog.body, /ml-row-note">Test case/);
    assert.doesNotMatch(sentLog.body, /Reviewed, hazard rating not required/);

    const hazard = await request(port, "POST", `/HHSRSreporter/review/${hazardCase.id}/dismiss`, {
      cookie,
      form: { reason: "hazard" },
    });
    assert.equal(hazard.status, 302);
    cookie = cookieHeader(hazard.setCookie, cookie);
    const hazardRow = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: hazardCase.id } });
    assert.equal(hazardRow?.status, "dismissed");
    assert.equal(hazardRow?.dismissedDecision, "hazard");
    assert.equal(hazardRow?.emailSentAt, null);
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: hazardCase.id } }), 0);
    const hazardLog = await request(port, "GET", hazard.location, { cookie });
    assert.match(hazardLog.body, /Reviewed, hazard rating not required\./);
    const hazardOpen = await request(port, "GET", `/HHSRSreporter/review/${hazardCase.id}`, { cookie });
    assert.match(hazardOpen.body, /id="btn-restore-dismiss"/);
    assert.match(hazardOpen.body, /Reviewed, hazard rating not required\./);
  });
});

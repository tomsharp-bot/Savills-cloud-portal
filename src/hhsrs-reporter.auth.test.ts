import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

type CreateApp = (options?: { basePath?: string }) => Express;

type Hit = {
  status: number;
  location: string;
  body: string;
  setCookie: string[];
};

let createApp: CreateApp;
let dbReady = false;

function request(
  app: Express,
  method: string,
  url: string,
  opts: { body?: string; cookie?: string; contentType?: string } = {}
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const payload = opts.body;
      const headers: Record<string, string | number> = {};
      if (payload) {
        headers["content-type"] = opts.contentType || "application/x-www-form-urlencoded";
        headers["content-length"] = Buffer.byteLength(payload);
      }
      if (opts.cookie) headers.cookie = opts.cookie;
      const req = http.request(
        { host: "127.0.0.1", port, path: url, method, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode || 0,
              location: String(res.headers.location || ""),
              body: Buffer.concat(chunks).toString("utf8"),
              setCookie: ([] as string[]).concat(res.headers["set-cookie"] || []),
            });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end(payload);
    });
  });
}

function cookieHeader(setCookie: string[]): string {
  return setCookie
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function login(app: Express, username: string, password: string, basePath = ""): Promise<string> {
  const res = await request(app, "POST", `${basePath}/login`, {
    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
  });
  assert.equal(res.status, 302, `login failed for ${username}: ${res.body.slice(0, 200)}`);
  const cookie = cookieHeader(res.setCookie);
  assert.match(cookie, /scp_session=/);
  return cookie;
}

before(async () => {
  ({ createApp } = await import("./app.js"));
  const { prisma } = await import("./lib/prisma.js");
  try {
    await prisma.$queryRaw`SELECT 1`;
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    dbReady = Boolean(admin);
  } catch {
    dbReady = false;
  }
});

describe("HHSRS Reporter auth and queue", () => {
  it("lets admins open the Reporter and blocks surveyors and clients", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const app = createApp({ basePath: "/projectprogress" });

    const adminCookie = await login(app, "phil.m", "PhilMoon2468", "/projectprogress");
    const admin = await request(app, "GET", "/HHSRSreporter", { cookie: adminCookie });
    assert.equal(admin.status, 200);
    assert.match(admin.body, /HHSRS Reporter/);
    assert.match(admin.body, /Pending Issues/);
    assert.match(admin.body, /Pending issues/);
    assert.match(admin.body, /side-tabs/);
    assert.match(admin.body, /HOUSING · SURVEY REPORTING/);
    assert.match(admin.body, /id="hhsrs-alert-toast"/);
    assert.match(admin.body, /class="alert-toast"/);
    assert.match(admin.body, /Enable desktop alerts/);
    assert.match(admin.body, /Turn on desktop alerts/);
    assert.doesNotMatch(admin.body, /Not now/);
    assert.doesNotMatch(admin.body, /Desktop alerts ready/);
    assert.match(admin.body, /initialPendingIds/);

    const surveyorCookie = await login(app, "peter.m", "PeterMay2468", "/projectprogress");
    const surveyor = await request(app, "GET", "/HHSRSreporter", { cookie: surveyorCookie });
    assert.equal(surveyor.status, 403);
    assert.match(surveyor.body, /Admin only/);

    const clientCookie = await login(app, "client.j", "ClientJones2468", "/projectprogress");
    const client = await request(app, "GET", "/HHSRSreporter", { cookie: clientCookie });
    assert.equal(client.status, 403);
    assert.match(client.body, /Admin only/);
  });

  it("opens shell screens for review, main log, and admin", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const app = createApp({ basePath: "" });
    const cookie = await login(app, "phil.m", "PhilMoon2468");

    const blank = await request(app, "GET", "/HHSRSreporter/review", { cookie });
    assert.equal(blank.status, 200);
    assert.match(blank.body, /Review and create/);
    assert.match(blank.body, /Select a project/);
    assert.match(blank.body, /Mark as actioned/);
    assert.match(blank.body, /Create new email/);
    assert.match(blank.body, /id="btn-generate-email"/);
    assert.match(blank.body, /id="btn-amend-case"/);
    assert.match(blank.body, /Fill case details, then click Generate email below Case details/);
    assert.match(blank.body, /id="rv-email-photos"[^>]*hidden/);
    assert.doesNotMatch(blank.body, /class="side-brand"/);
    assert.doesNotMatch(blank.body, /Send pack/);
    assert.doesNotMatch(blank.body, /Preview PDF/);
    assert.doesNotMatch(blank.body, /Save draft/);

    const mainLog = await request(app, "GET", "/HHSRSreporter/main-log", { cookie });
    assert.equal(mainLog.status, 200);
    assert.match(mainLog.body, /Main Log archive/);
    assert.match(mainLog.body, /panel-head review-head/);
    assert.doesNotMatch(mainLog.body, /dealt-head/);
    assert.match(mainLog.body, /Export CSV/);

    const overview = await request(app, "GET", "/HHSRSreporter/project-overview", { cookie });
    assert.equal(overview.status, 200);
    assert.match(overview.body, /Project overview/);
    assert.match(overview.body, /Total overview/);
    assert.match(overview.body, /By project/);
    assert.match(overview.body, /List comes from Project Progress/);
    assert.doesNotMatch(overview.body, /id="po-archive-confirm"/);
    assert.match(overview.body, /tab-label">Dashboard/);
    assert.match(overview.body, /tab-label">Project overview/);
    assert.doesNotMatch(overview.body, /po-by-hint/);
    assert.doesNotMatch(overview.body, /class="tab-ico"[^>]*>0[123]</);

    const adminPage = await request(app, "GET", "/HHSRSreporter/admin", { cookie });
    assert.equal(adminPage.status, 200);
    assert.match(adminPage.body, /Surveyor site form link/);
    assert.match(adminPage.body, /https:\/\/savillscloudportal\.co\.uk\/HHSRS-site-form/);
    assert.match(adminPage.body, /Copy link/);
    assert.match(adminPage.body, /Enable desktop alerts/);
    assert.match(adminPage.body, /Desktop alerts are off/);
    assert.match(adminPage.body, /Simulate alerts turned off/);
    assert.doesNotMatch(adminPage.body, /Desktop alerts ready/);
    assert.doesNotMatch(adminPage.body, /id="desktop-alerts-banner"/);
    assert.match(adminPage.body, /id="hhsrs-alert-toast"/);
  });

  it("returns pending hazard ids to admins and hides them from other roles", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const { prisma } = await import("./lib/prisma.js");
    const row = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: "Alert Homes",
        surveyDate: "2026-09-22",
        uprn: "reporter-alert-" + Date.now(),
        fullAddress: "9 Harbour Road",
        postcode: "EX23 8AB",
        surveyorName: "Sam Surveyor",
        category: "Damp & Mould Growth",
        rating: "High",
        comment: "black mould behind the wardrobe",
        photoPaths: [],
        status: "new",
      },
    });
    const actioned = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: "Alert Homes",
        surveyDate: "2026-09-22",
        uprn: "reporter-alert-done-" + Date.now(),
        fullAddress: "10 Harbour Road",
        postcode: "EX23 8AB",
        surveyorName: "Sam Surveyor",
        category: "Electrical Hazards",
        rating: "Low",
        comment: "already actioned",
        photoPaths: [],
        status: "email_sent",
      },
    });
    try {
      const app = createApp({ basePath: "" });
      const adminCookie = await login(app, "phil.m", "PhilMoon2468");
      const anon = await request(app, "GET", "/HHSRSreporter/pending-alerts.json");
      assert.equal(anon.status, 302);

      const surveyorCookie = await login(app, "peter.m", "PeterMay2468");
      const surveyor = await request(app, "GET", "/HHSRSreporter/pending-alerts.json", {
        cookie: surveyorCookie,
      });
      assert.equal(surveyor.status, 403);
      assert.match(surveyor.body, /Admin only/);

      const alerts = await request(app, "GET", "/HHSRSreporter/pending-alerts.json", {
        cookie: adminCookie,
      });
      assert.equal(alerts.status, 200);
      const payload = JSON.parse(alerts.body) as {
        pending: Array<{ id: string; fullAddress: string; summary: string; projectName: string }>;
      };
      const match = payload.pending.find((item) => item.id === row.id);
      assert.ok(match, "new pending submission is in the poll payload");
      assert.equal(match?.fullAddress, "9 Harbour Road");
      assert.equal(match?.projectName, "Alert Homes");
      assert.match(match?.summary || "", /Damp & Mould Growth/);
      assert.match(match?.summary || "", /black mould behind the wardrobe/);
      assert.equal(
        payload.pending.some((item) => item.id === actioned.id),
        false
      );
    } finally {
      await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: [row.id, actioned.id] } } });
    }
  });

  it("opens a case and generates a Standard draft from the submission", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const { prisma } = await import("./lib/prisma.js");
    const row = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: "Demo Housing",
        surveyDate: "2026-09-20",
        uprn: "reporter-std-" + Date.now(),
        fullAddress: "1 High Street",
        postcode: "EX1 1AA",
        surveyorName: "Alex Surveyor",
        category: "Electrical Hazards",
        rating: "High",
        comment: "damaged light fitting in lounge",
        photoPaths: ["hhsrs-site-form/placeholder/lounge.jpg"],
        status: "new",
      },
    });
    try {
      const app = createApp({ basePath: "" });
      const cookie = await login(app, "phil.m", "PhilMoon2468");
      const legacy = await request(app, "GET", `/HHSRSreporter/${row.id}`, { cookie });
      assert.equal(legacy.status, 302);
      assert.equal(legacy.location, `/HHSRSreporter/review/${row.id}`);

      const page = await request(app, "GET", `/HHSRSreporter/review/${row.id}`, { cookie });
      assert.equal(page.status, 200);
      assert.match(page.body, /Client email draft/);
      assert.match(page.body, /• Site notes: Damaged light fitting in lounge/);
      assert.doesNotMatch(page.body, /The light fitting in the lounge is damaged/);
      assert.match(page.body, /Demo Housing - HHSRS/);
      assert.match(page.body, /Mark as actioned/);
      assert.match(page.body, /btn-copy/);
      assert.match(page.body, /<textarea id="rv-email-body"[^>]*>\s*<\/textarea>/);
      assert.match(page.body, /case-photo-thumb/);
      assert.match(page.body, /photos\/lounge\.jpg/);
      assert.match(page.body, /id="rv-email-photos"[^>]*hidden/);
      const photosAt = page.body.indexOf('id="rv-photos-block"');
      const generateAt = page.body.indexOf('id="btn-generate-email"');
      assert.ok(photosAt > 0 && generateAt > photosAt);
      assert.equal(page.body.slice(photosAt, generateAt).includes("Download photos"), false);

      const dash = await request(app, "GET", "/HHSRSreporter", { cookie });
      assert.match(dash.body, /photo-att-col/);
      assert.match(dash.body, /1 photo attached/);
      assert.doesNotMatch(dash.body, /class="side-brand"/);

      const drafted = await request(app, "POST", "/HHSRSreporter/draft.json", {
        cookie,
        contentType: "application/json",
        body: JSON.stringify({
          caseId: row.id,
          projectName: "Demo Housing",
          address: "1 High Street, EX1 1AA",
          uprn: row.uprn,
          hazard: "Electrical Hazards",
          rating: "High",
          notes: "damaged light fitting in lounge",
          photoCount: 1,
          includeCause: true,
        }),
      });
      assert.equal(drafted.status, 200);
      const payload = JSON.parse(drafted.body) as { ok: boolean; subject: string; body: string };
      assert.equal(payload.ok, true);
      assert.match(payload.subject, /Demo Housing - HHSRS/);
      assert.match(payload.body, /• Site notes: Damaged light fitting in lounge\./);
      assert.doesNotMatch(payload.body, /The light fitting in the lounge is damaged/);
    } finally {
      await prisma.hhsrsSiteSubmission.delete({ where: { id: row.id } });
    }
  });

  it("generates a BPHA draft as bullets without the surveyor-visit intro", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const { prisma } = await import("./lib/prisma.js");
    const row = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: "BPHA East 2026",
        surveyDate: "2026-09-21",
        uprn: "reporter-bpha-" + Date.now(),
        fullAddress: "12 Nursery Road",
        postcode: "MK1 1AA",
        surveyorName: "Greg Kowalski",
        category: "Damp & Mould Growth",
        rating: "Medium",
        comment: "black mould in cupboard in hallway",
        photoPaths: [],
        status: "new",
      },
    });
    try {
      const app = createApp({ basePath: "" });
      const cookie = await login(app, "phil.m", "PhilMoon2468");
      const page = await request(app, "GET", `/HHSRSreporter/review/${row.id}`, { cookie });
      assert.equal(page.status, 200);
      assert.match(page.body, /BPHA - HHSRS/);
      assert.match(page.body, /• Site notes: Black mould in cupboard in hallway/);
      assert.doesNotMatch(page.body, /There is mould in the cupboard in the hallway/);
      assert.doesNotMatch(page.body, /One of our surveyors has visited/);
      assert.doesNotMatch(page.body, /on the HHSRS/);
      assert.match(page.body, /data-extra="calls"/);
    } finally {
      await prisma.hhsrsSiteSubmission.delete({ where: { id: row.id } });
    }
  });

  it("mirrors Project Progress and does not archive from HHSRS", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const { prisma } = await import("./lib/prisma.js");
    const onward = await prisma.project.findFirst({ where: { name: "Onward" } });
    const createdOnward = onward
      ? null
      : await prisma.project.create({
          data: { name: "Onward " + Date.now(), projectManager: "Tom Sharp", stage: "current" },
        });
    const progressName = (onward || createdOnward)!.name;
    const waiting = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: progressName === "Onward" ? "Onward 2026" : progressName,
        surveyDate: "2026-09-22",
        uprn: "overview-wait-" + Date.now(),
        fullAddress: "2 Archive Lane",
        postcode: "EX1 1AA",
        surveyorName: "Sam Surveyor",
        category: "Fire & Explosions",
        rating: "High",
        comment: "still waiting",
        photoPaths: ["hhsrs-site-form/placeholder/socket.jpg"],
        status: "new",
      },
    });
    try {
      const app = createApp({ basePath: "" });
      const cookie = await login(app, "phil.m", "PhilMoon2468");
      const page = await request(app, "GET", "/HHSRSreporter/project-overview", { cookie });
      assert.equal(page.status, 200);
      assert.match(page.body, /Project Progress/);
      assert.match(page.body, /Test 1/);
      assert.match(page.body, /Old Demo Job/);
      assert.match(page.body, /Completed on Project Progress/);
      assert.doesNotMatch(page.body, /data-archive-project/);
      assert.doesNotMatch(page.body, /<details[^>]*\sopen/);

      const blocked = await request(app, "POST", "/HHSRSreporter/project-overview/archive", {
        cookie,
        body: `projectName=${encodeURIComponent(progressName)}`,
      });
      assert.equal(blocked.status, 302);
      const blockedCookie = blocked.setCookie.length ? cookieHeader(blocked.setCookie) : cookie;
      const blockedPage = await request(app, "GET", blocked.location, { cookie: blockedCookie });
      assert.match(blockedPage.body, /Change this on Project Progress/);

      const review = await request(app, "GET", `/HHSRSreporter/review/${waiting.id}`, { cookie: blockedCookie });
      assert.equal(review.status, 200);
      assert.match(review.body, /Abandon claim — return to pending/);
      assert.match(review.body, /id="rv-email-bcc"/);
      const pending = await request(app, "GET", "/HHSRSreporter", { cookie: blockedCookie });
      assert.match(pending.body, /Claimed — Phil Moon/);
      assert.match(pending.body, /data-photos=/);
      assert.doesNotMatch(pending.body, /Abandon claim/);

      const abandoned = await request(app, "POST", `/HHSRSreporter/review/${waiting.id}/abandon`, {
        cookie: blockedCookie,
      });
      assert.equal(abandoned.status, 302);
      const openAgain = await request(app, "GET", "/HHSRSreporter", {
        cookie: abandoned.setCookie.length ? cookieHeader(abandoned.setCookie) : blockedCookie,
      });
      assert.doesNotMatch(openAgain.body, /Claimed — Phil Moon/);
    } finally {
      await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: waiting.id } });
      if (createdOnward) await prisma.project.delete({ where: { id: createdOnward.id } }).catch(() => undefined);
    }
  });
});

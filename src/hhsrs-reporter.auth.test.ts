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
    assert.match(overview.body, /Archive when project is complete\./);
    assert.match(overview.body, /id="po-archive-confirm"/);
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
        photoPaths: [],
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
      assert.match(page.body, /The light fitting in the lounge is damaged/);
      assert.match(page.body, /Demo Housing - HHSRS/);
      assert.match(page.body, /Mark as actioned/);
      assert.match(page.body, /btn-copy/);
    } finally {
      await prisma.hhsrsSiteSubmission.delete({ where: { id: row.id } });
    }
  });

  it("generates a BPHA draft that keeps surveyor-visit intro wording", async (t) => {
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
      assert.match(page.body, /One of our surveyors has visited/);
      assert.match(page.body, /There is mould in the cupboard in the hallway/);
      assert.match(page.body, /data-extra="calls"/);
    } finally {
      await prisma.hhsrsSiteSubmission.delete({ where: { id: row.id } });
    }
  });

  it("confirms archive only when a project is complete and restore reverses it", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const { prisma } = await import("./lib/prisma.js");
    const name = "Overview Complete " + Date.now();
    const row = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: name,
        surveyDate: "2026-09-22",
        uprn: "overview-done-" + Date.now(),
        fullAddress: "1 Archive Lane",
        postcode: "EX1 1AA",
        surveyorName: "Sam Surveyor",
        category: "Electrical Hazards",
        rating: "Low",
        comment: "already actioned for overview",
        photoPaths: [],
        status: "email_sent",
      },
    });
    const waiting = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: "Onward 2026",
        surveyDate: "2026-09-22",
        uprn: "overview-wait-" + Date.now(),
        fullAddress: "2 Archive Lane",
        postcode: "EX1 1AA",
        surveyorName: "Sam Surveyor",
        category: "Fire & Explosions",
        rating: "High",
        comment: "still waiting",
        photoPaths: [],
        status: "new",
      },
    });
    try {
      const app = createApp({ basePath: "" });
      const cookie = await login(app, "phil.m", "PhilMoon2468");
      const blocked = await request(app, "POST", "/HHSRSreporter/project-overview/archive", {
        cookie,
        body: `projectName=${encodeURIComponent("Onward 2026")}`,
      });
      assert.equal(blocked.status, 302);
      assert.match(blocked.location, /\/HHSRSreporter\/project-overview$/);
      const blockedCookie = blocked.setCookie.length ? cookieHeader(blocked.setCookie) : cookie;
      const blockedPage = await request(app, "GET", blocked.location, { cookie: blockedCookie });
      assert.match(blockedPage.body, /complete yet/);
      assert.match(blockedPage.body, /Onward 2026/);

      const archived = await request(app, "POST", "/HHSRSreporter/project-overview/archive", {
        cookie: blockedCookie,
        body: `projectName=${encodeURIComponent(name)}`,
      });
      assert.equal(archived.status, 302);
      const archivedCookie = archived.setCookie.length ? cookieHeader(archived.setCookie) : blockedCookie;
      const archivedPage = await request(app, "GET", archived.location, { cookie: archivedCookie });
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(archivedPage.body, /Archived projects/);
      assert.match(archivedPage.body, new RegExp(`data-restore-project="${escaped}"`));
      assert.doesNotMatch(archivedPage.body, /<details[^>]*\sopen/);

      const restored = await request(app, "POST", "/HHSRSreporter/project-overview/restore", {
        cookie: archivedCookie,
        body: `projectName=${encodeURIComponent(name)}`,
      });
      assert.equal(restored.status, 302);
      const restoredCookie = restored.setCookie.length ? cookieHeader(restored.setCookie) : archivedCookie;
      const restoredPage = await request(app, "GET", restored.location, { cookie: restoredCookie });
      assert.match(restoredPage.body, new RegExp(`data-archive-project="${escaped}"`));
    } finally {
      await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: [row.id, waiting.id] } } });
      await prisma.hhsrsReporterProjectArchive.deleteMany({ where: { name } }).catch(() => undefined);
    }
  });
});

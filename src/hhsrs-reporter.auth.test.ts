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
    assert.match(admin.body, /Shared queue of site-form submissions/);

    const surveyorCookie = await login(app, "peter.m", "PeterMay2468", "/projectprogress");
    const surveyor = await request(app, "GET", "/HHSRSreporter", { cookie: surveyorCookie });
    assert.equal(surveyor.status, 403);
    assert.match(surveyor.body, /Admin only/);

    const clientCookie = await login(app, "client.j", "ClientJones2468", "/projectprogress");
    const client = await request(app, "GET", "/HHSRSreporter", { cookie: clientCookie });
    assert.equal(client.status, 403);
    assert.match(client.body, /Admin only/);
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
      const page = await request(app, "GET", `/HHSRSreporter/${row.id}`, { cookie });
      assert.equal(page.status, 200);
      assert.match(page.body, /Client email draft/);
      assert.match(page.body, /The light fitting in the lounge is damaged/);
      assert.match(page.body, /Demo Housing - HHSRS/);
      assert.match(page.body, /Mark email as sent/);
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
      const page = await request(app, "GET", `/HHSRSreporter/${row.id}`, { cookie });
      assert.equal(page.status, 200);
      assert.match(page.body, /BPHA - HHSRS/);
      assert.match(page.body, /One of our surveyors has visited/);
      assert.match(page.body, /There is mould in the cupboard in the hallway/);
    } finally {
      await prisma.hhsrsSiteSubmission.delete({ where: { id: row.id } });
    }
  });
});

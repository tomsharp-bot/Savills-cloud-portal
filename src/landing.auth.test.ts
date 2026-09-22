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
  opts: { body?: string; cookie?: string } = {}
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const payload = opts.body;
      const headers: Record<string, string | number> = {};
      if (payload) {
        headers["content-type"] = "application/x-www-form-urlencoded";
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

async function login(app: Express, username: string, password: string): Promise<Hit> {
  return request(app, "POST", "/projectprogress/login", {
    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
  });
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

describe("post-login landing by role", () => {
  it("sends admins to the hub and surveyors and clients to Project Progress", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const app = createApp({ basePath: "/projectprogress" });

    const admin = await login(app, "phil.m", "PhilMoon2468");
    assert.equal(admin.status, 302);
    assert.equal(admin.location, "/projectprogress/admin");

    const surveyor = await login(app, "peter.m", "PeterMay2468");
    assert.equal(surveyor.status, 302);
    assert.equal(surveyor.location, "/projectprogress/projects");

    const client = await login(app, "client.j", "ClientJones2468");
    assert.equal(client.status, 302);
    assert.equal(client.location, "/projectprogress/projects");
  });

  it("renders hub tiles at the live paths and keeps surveyors off the hub", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const app = createApp({ basePath: "/projectprogress" });
    const adminLogin = await login(app, "phil.m", "PhilMoon2468");
    const adminCookie = cookieHeader(adminLogin.setCookie);

    const hub = await request(app, "GET", "/projectprogress/admin", { cookie: adminCookie });
    assert.equal(hub.status, 200);
    assert.match(hub.body, /href="\/HHSRSreporter"/);
    assert.doesNotMatch(hub.body, /\/projectprogress\/HHSRSreporter/);
    assert.match(hub.body, /href="\/projectprogress\/projects"/);
    assert.match(hub.body, /href="\/projectprogress\/personnel"/);
    assert.match(hub.body, /href="\/projectprogress\/photos"/);
    assert.match(hub.body, /href="\/projectprogress\/projects-programme"/);
    assert.match(hub.body, /class="brand" href="\/projectprogress\/admin"/);

    const home = await request(app, "GET", "/projectprogress", { cookie: adminCookie });
    assert.equal(home.status, 302);
    assert.equal(home.location, "/projectprogress/admin");

    const again = await request(app, "GET", "/projectprogress/login", { cookie: adminCookie });
    assert.equal(again.status, 302);
    assert.equal(again.location, "/projectprogress/admin");

    const photos = await request(app, "GET", "/projectprogress/photos", { cookie: adminCookie });
    assert.equal(photos.status, 200);
    assert.match(photos.body, /Shared photo storage is not available/);
    assert.match(photos.body, /href="\/projectprogress\/admin"/);

    const surveyorLogin = await login(app, "peter.m", "PeterMay2468");
    const surveyorCookie = cookieHeader(surveyorLogin.setCookie);
    const surveyorHome = await request(app, "GET", "/projectprogress", { cookie: surveyorCookie });
    assert.equal(surveyorHome.status, 302);
    assert.equal(surveyorHome.location, "/projectprogress/projects");

    const surveyorHub = await request(app, "GET", "/projectprogress/admin", { cookie: surveyorCookie });
    assert.equal(surveyorHub.status, 403);

    const surveyorPhotos = await request(app, "GET", "/projectprogress/photos", { cookie: surveyorCookie });
    assert.equal(surveyorPhotos.status, 403);

    const projects = await request(app, "GET", "/projectprogress/projects", { cookie: surveyorCookie });
    assert.equal(projects.status, 200);
    assert.match(projects.body, /class="brand" href="\/projectprogress\/projects"/);
    assert.doesNotMatch(projects.body, /href="\/projectprogress\/admin"/);
  });
});

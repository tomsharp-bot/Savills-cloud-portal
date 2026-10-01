import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import { hashPassword } from "./passwords.js";
import {
  mapChoiceProjects,
  mapPinProjects,
  parseMapPosition,
  projectCanBePinned,
  type MapProject,
} from "./project-map.js";

process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

const root = process.cwd();

function project(partial: Partial<MapProject> & Pick<MapProject, "id" | "name" | "stage">): MapProject {
  return { mapX: null, mapY: null, ...partial };
}

describe("UK map pin rules", () => {
  it("pins Current and Upcoming only, and only once a position is stored", () => {
    assert.equal(projectCanBePinned("current"), true);
    assert.equal(projectCanBePinned("upcoming"), true);
    assert.equal(projectCanBePinned("archive"), false);

    const current = project({ id: "c", name: "Live", stage: "current", mapX: 40, mapY: 55 });
    const upcoming = project({ id: "u", name: "Next", stage: "upcoming", mapX: 10, mapY: 20 });
    const unpinned = project({ id: "n", name: "Bare", stage: "current" });
    const archived = project({ id: "a", name: "Old", stage: "archive", mapX: 70, mapY: 80 });
    const half = project({ id: "h", name: "Half", stage: "upcoming", mapX: 12, mapY: null });

    assert.deepEqual(
      mapPinProjects([current, upcoming, unpinned, archived, half]).map((row) => row.id),
      ["c", "u"]
    );
    assert.deepEqual(
      mapChoiceProjects([current, upcoming, unpinned, archived, half]).map((row) => row.id),
      ["c", "u", "n", "h"]
    );
  });

  it("accepts a point on the map and rejects anything off it", () => {
    assert.deepEqual(parseMapPosition(42.5, 61.25), { x: 42.5, y: 61.25 });
    assert.deepEqual(parseMapPosition(" 10 ", "20.004"), { x: 10, y: 20 });
    assert.deepEqual(parseMapPosition(0, 100), { x: 0, y: 100 });
    assert.equal(parseMapPosition("", "10"), null);
    assert.equal(parseMapPosition("nope", 10), null);
    assert.equal(parseMapPosition(-0.1, 10), null);
    assert.equal(parseMapPosition(10, 100.1), null);
    assert.equal(parseMapPosition(null, 10), null);
    assert.equal(parseMapPosition(10, undefined), null);
  });
});

describe("Projects Progress UK map", () => {
  it("is a fixed outline in the bottom right, with a name-only hover label", () => {
    const page = readFileSync(join(root, "views/projects.ejs"), "utf8");
    const css = readFileSync(join(root, "public/css/app.css"), "utf8");
    const script = readFileSync(join(root, "public/js/uk-map.js"), "utf8");
    const migration = readFileSync(
      join(root, "prisma/migrations/20261001133000_project_map_position/migration.sql"),
      "utf8"
    );
    const map = page.slice(page.indexOf('id="uk-map"'), page.indexOf("/js/uk-map.js"));

    assert.match(page, /class="projects-page"/);
    assert.match(page, /id="uk-map" class="uk-map"/);
    assert.match(page, /aria-label="Outline of the United Kingdom"/);
    assert.match(map, /class="uk-map-outline"/);
    assert.match(map, /class="uk-map-pin-label"><%= pin\.name %>/);
    assert.match(map, /data-can-place="1"/);
    assert.match(map, /id="uk-map-project"/);
    assert.doesNotMatch(map, /projectManager|hhsrsCode|tile-stats|leaflet|mapbox|google/i);
    assert.doesNotMatch(page, /apiKey|maps\.googleapis|openstreetmap/i);

    const widget = css.slice(css.indexOf(".uk-map{"), css.indexOf(".uk-map-canvas"));
    assert.match(widget, /position:\s*fixed/);
    assert.match(widget, /right:\s*12px/);
    assert.match(widget, /bottom:\s*12px/);
    assert.match(css, /\.projects-page \.main\{[^}]*padding-right:\s*196px/);
    assert.match(css, /\.uk-map-pin:hover \.uk-map-pin-label/);
    assert.match(css, /\.uk-map-pin-label\{[^}]*display:\s*none/);

    assert.match(script, /\/projects\/" \+ encodeURIComponent\(id\) \+ "\/map"/);
    assert.match(script, /uk-map-pin-label/);
    assert.match(script, /textContent = name/);
    assert.doesNotMatch(script, /leaflet|mapbox|google/i);

    assert.match(migration, /ADD COLUMN "mapX" DOUBLE PRECISION/);
    assert.match(migration, /ADD COLUMN "mapY" DOUBLE PRECISION/);
  });
});

function cookieHeader(setCookie: string[]): string {
  return setCookie.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
}

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

async function request(
  port: number,
  method: string,
  urlPath: string,
  opts: { cookie?: string; fields?: Record<string, string>; json?: Record<string, unknown> } = {}
) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.fields) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.fields).toString();
  }
  if (opts.json) {
    headers["content-type"] = "application/json";
    headers.accept = "application/json";
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body, redirect: "manual" });
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get("location") || "",
    setCookie,
  };
}

function mapSection(html: string): string {
  const start = html.indexOf('id="uk-map"');
  const end = html.indexOf("/js/uk-map.js");
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

describe("saving a UK map pin", () => {
  it("keeps Current and Upcoming pins, and refuses an archived project", async (t) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      t.skip("Postgres is not available");
      return;
    }

    const stamp = Date.now().toString(36);
    const password = "MapPinTest-2468";
    const passwordHash = await hashPassword(password);
    const admin = await prisma.user.create({
      data: { username: `map-admin-${stamp}`, passwordHash, role: "admin", name: "Map Admin" },
    });
    const surveyor = await prisma.user.create({
      data: { username: `map-surveyor-${stamp}`, passwordHash, role: "surveyor", name: "Map Surveyor" },
    });
    const currentName = `Map Current ${stamp}`;
    const upcomingName = `Map Upcoming ${stamp}`;
    const archiveName = `Map Archive ${stamp}`;
    const current = await prisma.project.create({
      data: { name: currentName, projectManager: "Tom Sharp", stage: "current" },
    });
    const upcoming = await prisma.project.create({
      data: { name: upcomingName, projectManager: "Tom Sharp", stage: "upcoming" },
    });
    const archived = await prisma.project.create({
      data: {
        name: archiveName,
        projectManager: "Tom Sharp",
        stage: "archive",
        mapX: 12,
        mapY: 34,
      },
    });
    await prisma.projectAccess.create({ data: { userId: surveyor.id, projectId: current.id } });
    t.after(async () => {
      await prisma.projectAccess.deleteMany({ where: { userId: surveyor.id } }).catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: { in: [current.id, upcoming.id, archived.id] } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, surveyor.id] } } }).catch(() => undefined);
    });

    const app = createApp({ basePath: "" });
    const { server, port } = await listen(app);
    t.after(() => server.close());

    const login = await request(port, "POST", "/login", {
      fields: { username: admin.username, password },
    });
    assert.equal(login.status, 302);
    const cookie = cookieHeader(login.setCookie);

    const before = await request(port, "GET", "/projects", { cookie });
    assert.equal(before.status, 200);
    const beforeMap = mapSection(before.body);
    assert.match(beforeMap, /class="uk-map"/);
    assert.match(beforeMap, /Outline of the United Kingdom/);
    assert.match(beforeMap, new RegExp(`<option value="${current.id}">${currentName}</option>`));
    assert.match(beforeMap, new RegExp(`<option value="${upcoming.id}">${upcomingName}</option>`));
    assert.equal(beforeMap.includes(archiveName), false);
    assert.equal(beforeMap.includes(`data-map-pin="${archived.id}"`), false);
    assert.equal(beforeMap.includes(`data-map-pin="${current.id}"`), false);

    const dropped = await request(port, "POST", `/projects/${current.id}/map`, {
      cookie,
      json: { x: 42.5, y: 61.25 },
    });
    assert.equal(dropped.status, 200, dropped.body);
    assert.deepEqual(JSON.parse(dropped.body), {
      ok: true,
      id: current.id,
      name: currentName,
      mapX: 42.5,
      mapY: 61.25,
    });

    const upcomingDrop = await request(port, "POST", `/projects/${upcoming.id}/map`, {
      cookie,
      json: { x: 15, y: 80 },
    });
    assert.equal(upcomingDrop.status, 200, upcomingDrop.body);

    const refused = await request(port, "POST", `/projects/${archived.id}/map`, {
      cookie,
      json: { x: 50, y: 50 },
    });
    assert.equal(refused.status, 400, refused.body);
    assert.match(refused.body, /Archived projects cannot be pinned/);
    const stillArchived = await prisma.project.findUnique({ where: { id: archived.id } });
    assert.equal(stillArchived?.mapX, 12);
    assert.equal(stillArchived?.mapY, 34);

    const offMap = await request(port, "POST", `/projects/${current.id}/map`, {
      cookie,
      json: { x: 120, y: 10 },
    });
    assert.equal(offMap.status, 400);

    const placed = await request(port, "GET", "/projects", { cookie });
    const placedMap = mapSection(placed.body);
    assert.match(placedMap, new RegExp(`class="uk-map-pin" style="left:42.5%;top:61.25%" data-map-pin="${current.id}"`));
    assert.match(placedMap, new RegExp(`class="uk-map-pin-label">${currentName}</span>`));
    assert.match(placedMap, new RegExp(`class="uk-map-pin" style="left:15%;top:80%" data-map-pin="${upcoming.id}"`));
    assert.match(placedMap, new RegExp(`class="uk-map-pin-label">${upcomingName}</span>`));
    assert.equal(placedMap.includes(archiveName), false);
    assert.equal(placedMap.includes(`data-map-pin="${archived.id}"`), false);
    const currentPin = placedMap.slice(
      placedMap.indexOf(`class="uk-map-pin" style="left:42.5%;top:61.25%" data-map-pin="${current.id}"`),
      placedMap.indexOf(`class="uk-map-pin" style="left:42.5%;top:61.25%" data-map-pin="${current.id}"`) + 500
    );
    assert.match(currentPin, new RegExp(`<span class="uk-map-pin-label">${currentName}</span>`));
    assert.equal(currentPin.includes("Tom Sharp"), false);
    assert.equal(currentPin.includes("stage"), false);

    const moved = await request(port, "POST", `/projects/${current.id}/map`, {
      cookie,
      json: { x: 70, y: 22 },
    });
    assert.equal(moved.status, 200, moved.body);
    const refreshed = await request(port, "GET", "/projects", { cookie });
    const refreshedMap = mapSection(refreshed.body);
    assert.match(refreshedMap, new RegExp(`style="left:70%;top:22%" data-map-pin="${current.id}"`));
    assert.doesNotMatch(refreshedMap, new RegExp(`data-map-pin="${current.id}"[^>]*left:42\\.5%`));
    assert.match(refreshedMap, new RegExp(`class="uk-map-pin-label">${currentName}</span>`));

    const surveyorLogin = await request(port, "POST", "/login", {
      fields: { username: surveyor.username, password },
    });
    assert.equal(surveyorLogin.status, 302);
    const surveyorCookie = cookieHeader(surveyorLogin.setCookie);
    const surveyorDenied = await request(port, "POST", `/projects/${current.id}/map`, {
      cookie: surveyorCookie,
      json: { x: 5, y: 5 },
    });
    assert.equal(surveyorDenied.status, 403);
    const unchanged = await prisma.project.findUnique({ where: { id: current.id } });
    assert.equal(unchanged?.mapX, 70);
    assert.equal(unchanged?.mapY, 22);
    const surveyorPage = await request(port, "GET", "/projects", { cookie: surveyorCookie });
    const surveyorMap = mapSection(surveyorPage.body);
    assert.match(surveyorMap, /class="uk-map"/);
    assert.match(surveyorMap, new RegExp(`style="left:70%;top:22%" data-map-pin="${current.id}"`));
    assert.match(surveyorMap, new RegExp(`class="uk-map-pin-label">${currentName}</span>`));
    assert.equal(surveyorMap.includes("data-can-place"), false);
    assert.equal(surveyorMap.includes("uk-map-project"), false);
    assert.equal(surveyorMap.includes(upcomingName), false);
    assert.equal(surveyorMap.includes(archiveName), false);
  });
});

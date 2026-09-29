import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import {
  SITE_FORM_ARCHIVE_WINDOW_DAYS,
  SITE_FORM_ARCHIVE_WINDOW_MS,
  archivedAtForStageChange,
  siteFormArchiveCutoff,
  siteFormProjectWhere,
} from "./hhsrs-site-form-projects.js";

process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("HHSRS site form archive window", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");

  it("keeps a project for 14 days after it is archived, then drops it", () => {
    assert.equal(SITE_FORM_ARCHIVE_WINDOW_DAYS, 14);
    assert.equal(SITE_FORM_ARCHIVE_WINDOW_MS, 14 * DAY_MS);
    const cutoff = siteFormArchiveCutoff(now);
    assert.equal(cutoff.toISOString(), "2026-09-15T12:00:00.000Z");

    const where = siteFormProjectWhere(now);
    assert.deepEqual(where, {
      OR: [
        { stage: "current" },
        { stage: "archive", archivedAt: { gt: cutoff } },
      ],
    });
  });

  it("stamps archivedAt only when stage becomes archive", () => {
    const stamped = archivedAtForStageChange("current", "archive", now);
    assert.equal(stamped?.toISOString(), now.toISOString());
    assert.equal(archivedAtForStageChange("upcoming", "archive", now)?.toISOString(), now.toISOString());
    assert.equal(archivedAtForStageChange("archive", "archive", now), undefined);
    assert.equal(archivedAtForStageChange("archive", "current", now), null);
    assert.equal(archivedAtForStageChange("current", "upcoming", now), null);
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
  opts: { cookie?: string; fields?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.fields) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.fields).toString();
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

function optionNames(html: string): string[] {
  return [...html.matchAll(/<option[^>]*value="[^"]+"[^>]*>([^<]*)<\/option>/g)].map((match) => match[1]);
}

describe("HHSRS site form lists a project for 2 weeks after archive", () => {
  it("offers stock for a recent archive and drops the project after 2 weeks", async (t) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      t.skip("Postgres is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!admin) {
      t.skip("Seeded admin is not available");
      return;
    }

    const stamp = Date.now().toString(36);
    const recentName = `AAA Recent Archive ${stamp}`;
    const currentName = `AAA Current ${stamp}`;
    const oldName = `AAA Old Archive ${stamp}`;
    const upcomingName = `AAA Upcoming ${stamp}`;
    const recent = await prisma.project.create({
      data: { name: recentName, projectManager: "Tom Sharp", stage: "current" },
    });
    const current = await prisma.project.create({
      data: { name: currentName, projectManager: "Tom Sharp", stage: "current" },
    });
    const old = await prisma.project.create({
      data: {
        name: oldName,
        projectManager: "Tom Sharp",
        stage: "archive",
        archivedAt: new Date(Date.now() - 15 * DAY_MS),
      },
    });
    const upcoming = await prisma.project.create({
      data: { name: upcomingName, projectManager: "Tom Sharp", stage: "upcoming" },
    });
    const asset = await prisma.asset.create({
      data: {
        projectId: recent.id,
        kind: "dwelling",
        uprn: `9${stamp}`.slice(0, 12),
        number: "8",
        street: "Archive Lane",
        city: "Leeds",
        postcode: "LS1 4DY",
      },
    });
    t.after(async () => {
      await prisma.asset.deleteMany({ where: { projectId: recent.id } }).catch(() => undefined);
      await prisma.project
        .deleteMany({ where: { id: { in: [recent.id, current.id, old.id, upcoming.id] } } })
        .catch(() => undefined);
    });

    const app = createApp({ basePath: "" });
    const { server, port } = await listen(app);
    t.after(() => server.close());

    const login = await request(port, "POST", "/login", {
      fields: { username: "phil.m", password: "PhilMoon2468" },
    });
    assert.equal(login.status, 302);
    const cookie = cookieHeader(login.setCookie);

    const archived = await request(port, "POST", `/projects/${recent.id}/stage`, {
      cookie,
      fields: { stage: "archive" },
    });
    assert.equal(archived.status, 302);
    const stamped = await prisma.project.findUnique({ where: { id: recent.id } });
    assert.equal(stamped?.stage, "archive");
    assert.ok(stamped?.archivedAt);
    assert.ok(Date.now() - stamped.archivedAt.getTime() < 60_000);
    const archiveMoment = stamped.archivedAt;

    const edited = await request(port, "POST", `/projects/${recent.id}/edit`, {
      cookie,
      fields: {
        name: recentName,
        projectManager: "Tom Sharp",
        stage: "archive",
        types: "typeConditionOnly",
        projectTargetValue: "80",
        projectTargetUnit: "percent",
      },
    });
    assert.equal(edited.status, 302, edited.body);
    const afterEdit = await prisma.project.findUnique({ where: { id: recent.id } });
    assert.equal(afterEdit?.archivedAt?.toISOString(), archiveMoment.toISOString());
    assert.equal(afterEdit?.projectTargetValue, 80);

    const open = await request(port, "GET", "/HHSRS-site-form/new");
    assert.equal(open.status, 200);
    const names = optionNames(open.body);
    assert.equal(names.includes(recentName), true);
    assert.equal(names.includes(currentName), true);
    assert.equal(names.includes(oldName), false);
    assert.equal(names.includes(upcomingName), false);

    const lookup = await request(
      port,
      "GET",
      `/HHSRS-site-form/stock-lookup?projectId=${encodeURIComponent(recent.id)}&uprn=${encodeURIComponent(asset.uprn)}`
    );
    assert.equal(lookup.status, 200, lookup.body);
    assert.match(lookup.body, /Archive Lane/);

    const stillInside = new Date(Date.now() - SITE_FORM_ARCHIVE_WINDOW_MS + 60_000);
    await prisma.project.update({ where: { id: recent.id }, data: { archivedAt: stillInside } });
    const inside = await request(port, "GET", "/HHSRS-site-form/new");
    assert.equal(optionNames(inside.body).includes(recentName), true);

    const exactly = new Date(Date.now() - SITE_FORM_ARCHIVE_WINDOW_MS);
    await prisma.project.update({ where: { id: recent.id }, data: { archivedAt: exactly } });
    const dropped = await request(port, "GET", "/HHSRS-site-form/new");
    const droppedNames = optionNames(dropped.body);
    assert.equal(droppedNames.includes(recentName), false);
    assert.equal(droppedNames.includes(currentName), true);

    const blocked = await request(
      port,
      "GET",
      `/HHSRS-site-form/stock-lookup?projectId=${encodeURIComponent(recent.id)}&uprn=${encodeURIComponent(asset.uprn)}`
    );
    assert.equal(blocked.status, 400);

    const restored = await request(port, "POST", `/projects/${recent.id}/stage`, {
      cookie,
      fields: { stage: "current" },
    });
    assert.equal(restored.status, 302);
    const back = await prisma.project.findUnique({ where: { id: recent.id } });
    assert.equal(back?.stage, "current");
    assert.equal(back?.archivedAt, null);
    const afterRestore = await request(port, "GET", "/HHSRS-site-form/new");
    assert.equal(optionNames(afterRestore.body).includes(recentName), true);
  });
});

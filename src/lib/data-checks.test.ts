import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import "dotenv/config";
import {
  DATA_REVIEW_MARKERS,
  assembleDataChecksPage,
  readDataReviewPage,
} from "./data-checks-page.js";

const TOPBAR = `<header class="topbar"><div class="right"><a class="linkish data-checks-nav" href="/data-checks">Data Checks</a></div></header>`;

describe("Data Review practice page hosting", () => {
  it("keeps the v4 tool and adds the portal bar above it", () => {
    const source = readDataReviewPage();
    assert.ok(Buffer.byteLength(source) > 2_000_000);
    for (const marker of DATA_REVIEW_MARKERS) {
      assert.equal(source.includes(marker), true, marker);
    }

    const page = assembleDataChecksPage(source, TOPBAR);
    assert.match(page, /<title>Data Checks — Savills Cloud Portal<\/title>/);
    assert.match(page, /class="scp-host"/);
    assert.match(page, />Data Checks</);
    assert.match(page, /id="scp-app"/);
    for (const marker of DATA_REVIEW_MARKERS) {
      assert.equal(page.includes(marker), true, marker);
    }
    assert.ok(page.indexOf('class="scp-host"') < page.indexOf('id="scp-app"'));
    assert.ok(page.indexOf('id="cellRead"') > page.indexOf('id="scp-app"'));
    assert.ok(page.indexOf('id="cellRead"') < page.indexOf('<div id="lb">'));
    assert.ok(page.indexOf('<div id="lb">') < page.indexOf('<script id="xlsxlib">'));
    assert.match(page, /id="bSaveMaster"/);
    assert.match(page, /id="mdfDrop"/);
    assert.match(page, /id="baseDrop"/);
    assert.match(page, /id="basePreview"/);
    assert.ok(page.indexOf('id="pCreate"') < page.indexOf('id="baseDrop"'));
    assert.ok(page.indexOf('id="baseDrop"') < page.indexOf("Import data from an existing MDF"));
    assert.match(page, /B\.exactColumns/);
    assert.match(page, /function pickListHtml/);
    assert.match(page, /pickListHtml\('mdf'/);
    assert.match(page, /pickListHtml\('base'/);
    assert.match(page, /wirePickList\('mdf'\)/);
    assert.match(page, /wirePickList\('base'\)/);
    assert.match(page, /Not already in this master/);
    assert.match(page, /Tick at least one column\./);
    assert.match(page, /cols\.splice\(0, cols\.length, \.\.\.out\)/);
    assert.match(page, /Hide HHSRS Section/);
    assert.match(page, /Selected cell/);
    assert.match(page, /Load photo folder/);
  });
});

async function listen(app: Express): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

async function request(
  port: number,
  method: string,
  path: string,
  opts: { cookie?: string; form?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
  });
  const text = await res.text();
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return {
    status: res.status,
    body: text,
    setCookie,
    location: res.headers.get("location"),
    cache: res.headers.get("cache-control"),
    type: res.headers.get("content-type"),
  };
}

function cookieHeader(setCookie: string[]): string {
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

describe("Data Checks route", () => {
  it("shows the full page only to Tom Sharp’s admin login", async (t) => {
    if (!process.env.DATABASE_URL?.trim()) {
      t.skip("Postgres not available");
      return;
    }
    const { createApp } = await import("../app.js");
    const { prisma } = await import("./prisma.js");
    const { hashPassword } = await import("./passwords.js");
    try {
      await prisma.user.findFirst({ where: { username: "phil.m" } });
    } catch {
      t.skip("Postgres not available");
      return;
    }

    const createdIds: string[] = [];
    const app = createApp({ basePath: "/projectprogress" });
    const { server, port } = await listen(app);
    t.after(async () => {
      server.close();
      if (createdIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
      }
    });

    const password = "DataChecksTest-2468";
    const passwordHash = await hashPassword(password);

    async function tempAdmin(input: { username: string; name: string; email: string }) {
      const row = await prisma.user.create({
        data: { ...input, role: "admin", passwordHash },
      });
      createdIds.push(row.id);
      const login = await request(port, "POST", "/projectprogress/login", {
        form: { username: input.username, password },
      });
      assert.equal(login.status, 302, input.username);
      return cookieHeader(login.setCookie);
    }

    const adminLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    if (adminLogin.status !== 302) {
      t.skip("Seeded admin login is not available");
      return;
    }
    const phil = cookieHeader(adminLogin.setCookie);

    const philProjects = await request(port, "GET", "/projectprogress/projects", { cookie: phil });
    assert.equal(philProjects.status, 200);
    assert.match(philProjects.body, /Projects Progress/);
    assert.doesNotMatch(philProjects.body, /Data Checks/);
    assert.doesNotMatch(philProjects.body, /\/data-checks/);

    const philPage = await request(port, "GET", "/projectprogress/data-checks", { cookie: phil });
    assert.equal(philPage.status, 403);
    assert.equal(philPage.body, "Only Tom Sharp can open Data Checks.");
    assert.doesNotMatch(philPage.body, /id="cellRead"/);
    assert.doesNotMatch(philPage.body, /Master Data File/);

    const carly = await tempAdmin({
      username: "cfarrell-data-checks-test",
      name: "Carly Farrell",
      email: "cfarrell-data-checks-test@example.com",
    });
    const carlyHome = await request(port, "GET", "/projectprogress/admin", { cookie: carly });
    assert.equal(carlyHome.status, 200);
    assert.doesNotMatch(carlyHome.body, /Data Checks/);
    const carlyPage = await request(port, "GET", "/projectprogress/data-checks", { cookie: carly });
    assert.equal(carlyPage.status, 403);
    assert.equal(carlyPage.body, "Only Tom Sharp can open Data Checks.");

    const nameOnly = await tempAdmin({
      username: "tom-name-data-checks-test",
      name: "Tom Sharp",
      email: "tom-name-data-checks-test@example.com",
    });
    const nameOnlyHome = await request(port, "GET", "/projectprogress/personnel", { cookie: nameOnly });
    assert.equal(nameOnlyHome.status, 200);
    assert.doesNotMatch(nameOnlyHome.body, /Data Checks/);
    const nameOnlyPage = await request(port, "GET", "/projectprogress/data-checks", { cookie: nameOnly });
    assert.equal(nameOnlyPage.status, 403);

    const surveyorLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "peter.m", password: "PeterMay2468" },
    });
    assert.equal(surveyorLogin.status, 302);
    const surveyor = cookieHeader(surveyorLogin.setCookie);
    const surveyorHome = await request(port, "GET", "/projectprogress/surveyor", { cookie: surveyor });
    assert.equal(surveyorHome.status, 200);
    assert.doesNotMatch(surveyorHome.body, /Data Checks/);
    const surveyorPage = await request(port, "GET", "/projectprogress/data-checks", { cookie: surveyor });
    assert.equal(surveyorPage.status, 403);
    assert.doesNotMatch(surveyorPage.body, /File builder/);

    const existingTom = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: "tsharp", mode: "insensitive" } },
          { email: { equals: "tsharp@savillshousing.co.uk", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    if (existingTom) {
      t.diagnostic("Tom Sharp’s login already exists; skipping the live page assertion");
      return;
    }

    const tom = await tempAdmin({
      username: "tsharp",
      name: "Tom Sharp",
      email: "tsharp@savillshousing.co.uk",
    });
    const tomProjects = await request(port, "GET", "/projectprogress/projects", { cookie: tom });
    assert.equal(tomProjects.status, 200);
    assert.match(tomProjects.body, /Projects Progress/);
    assert.match(tomProjects.body, /Programme/);
    assert.match(tomProjects.body, /Personnel/);
    assert.match(tomProjects.body, /href="\/projectprogress\/data-checks"/);
    assert.match(tomProjects.body, />Data Checks</);
    const reportsAt = tomProjects.body.indexOf("HHSRS site reports");
    const checksAt = tomProjects.body.indexOf(">Data Checks<");
    const nameAt = tomProjects.body.indexOf("Tom Sharp");
    assert.ok(reportsAt >= 0 && reportsAt < checksAt && checksAt < nameAt);

    const page = await request(port, "GET", "/projectprogress/data-checks", { cookie: tom });
    assert.equal(page.status, 200);
    assert.match(page.type || "", /text\/html/);
    assert.match(page.cache || "", /no-store/);
    assert.ok(Buffer.byteLength(page.body) > 2_000_000);
    assert.equal(page.body.includes("<title>Data Checks — Savills Cloud Portal</title>"), true);
    assert.equal(page.body.includes('aria-current="page"'), true);
    assert.equal(page.body.includes('href="/projectprogress/projects"'), true);
    assert.equal(page.body.includes(">Projects Progress<"), true);
    assert.equal(page.body.includes('href="/projectprogress/projects-programme"'), true);
    assert.equal(page.body.includes(">Programme<"), true);
    for (const marker of DATA_REVIEW_MARKERS) {
      assert.equal(page.body.includes(marker), true, marker);
    }
  });
});

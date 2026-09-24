import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import "dotenv/config";

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
  opts: { cookie?: string; body?: unknown; form?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    headers.accept = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
  });
  const text = await res.text();
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, body: text, setCookie, location: res.headers.get("location") };
}

function cookieHeader(setCookie: string[]): string {
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

describe("Projects Programme access", () => {
  it("hides the board from surveyors and keeps other admins read-only", async (t) => {
    if (!process.env.DATABASE_URL?.trim()) {
      t.skip("Postgres not available");
      return;
    }
    const { createApp } = await import("../app.js");
    const { prisma } = await import("./prisma.js");
    try {
      await prisma.user.findFirst({ where: { username: "phil.m" } });
    } catch {
      t.skip("Postgres not available");
      return;
    }

    const app = createApp({ basePath: "/projectprogress" });
    const { server, port } = await listen(app);
    t.after(() => server.close());

    const adminLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    if (adminLogin.status !== 302) {
      t.skip("Seeded admin login is not available");
      return;
    }
    const adminCookie = cookieHeader(adminLogin.setCookie);

    const page = await request(port, "GET", "/projectprogress/projects-programme", { cookie: adminCookie });
    assert.equal(page.status, 200);
    assert.match(page.body, /Projects Programme/);
    assert.match(page.body, /"canEdit":false/);
    assert.match(page.body, /is-readonly/);
    assert.match(page.body, /Only Tom Sharp can move tiles/);
    assert.match(page.body, /id="btnExcel"/);
    assert.doesNotMatch(page.body, /id="btnRefresh"/);
    assert.match(page.body, /id="projUpcoming"[\s\S]{0,900}Approx surveys/);

    const save = await request(port, "POST", "/projectprogress/projects-programme/board", {
      cookie: adminCookie,
      body: { surveyors: [{ name: "Richard Moreing", flag: "", weeks: ["Onward"] }], admins: [] },
    });
    assert.equal(save.status, 403);
    assert.match(save.body, /Only Tom Sharp/);

    const types = await request(port, "POST", "/projectprogress/projects-programme/survey-types", {
      cookie: adminCookie,
      body: { projectId: "missing", surveyTypes: "Blocks" },
    });
    assert.equal(types.status, 403);

    const exported = await request(port, "POST", "/projectprogress/projects-programme/export", {
      cookie: adminCookie,
      body: [],
    });
    assert.equal(exported.status, 400);

    const surveyorLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "peter.m", password: "PeterMay2468" },
    });
    assert.equal(surveyorLogin.status, 302);
    const surveyorCookie = cookieHeader(surveyorLogin.setCookie);
    const denied = await request(port, "GET", "/projectprogress/projects-programme", { cookie: surveyorCookie });
    assert.equal(denied.status, 403);
    assert.match(denied.body, /Admin only/);
    assert.doesNotMatch(denied.body, /id="matrix"/);

    const surveyorHome = await request(port, "GET", "/projectprogress/surveyor", { cookie: surveyorCookie });
    assert.equal(surveyorHome.status, 200);
    assert.doesNotMatch(surveyorHome.body, /Projects Programme/);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: http.Server; port: number }> {
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

describe("Photo Storage routes", () => {
  it("admins can land, open a project, extract, and surveyors are blocked", async (t) => {
    let projectCount = 0;
    try {
      projectCount = await prisma.project.count();
    } catch {
      t.skip("Postgres not available");
      return;
    }
    if (!projectCount) {
      t.skip("No seeded projects");
      return;
    }

    const app = createApp({ basePath: "/projectprogress" });
    const { server, port } = await listen(app);
    t.after(() => server.close());

    const login = await request(port, "POST", "/projectprogress/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    assert.equal(login.status, 302);
    const cookie = cookieHeader(login.setCookie);

    const landing = await request(port, "GET", "/projectprogress/photos", { cookie });
    assert.equal(landing.status, 200);
    assert.match(landing.body, /Photo Storage/);
    assert.match(landing.body, /Current projects/);
    assert.match(landing.body, /Photos Pool:/);
    assert.match(landing.body, /Photo Folders:/);
    assert.doesNotMatch(landing.body, /camera|📷/i);

    const m = landing.body.match(/href="\/projectprogress\/photos\/projects\/([^"]+)"/);
    assert.ok(m, "expected a project tile link");
    const projectId = m![1];

    const project = await request(port, "GET", `/projectprogress/photos/projects/${projectId}`, { cookie });
    assert.equal(project.status, 200);
    assert.match(project.body, /Photos Pool/);
    assert.match(project.body, /Create Photos Extract/);
    assert.match(project.body, /Photo Folders/);
    assert.match(project.body, /Select Images/);

    const bootMatch = project.body.match(/window\.__PHOTOS__ = (\{[\s\S]*?\});\s*<\/script>/);
    assert.ok(bootMatch, "expected bootstrap JSON");
    const boot = JSON.parse(bootMatch![1]);
    assert.ok(boot.pool.length > 0);
    const codes = boot.pool
      .slice(0, 2)
      .map((p: { code: string }) => p.code)
      .concat(["9999999-Kitchen-1"]);

    const extract = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/extract`, {
      cookie,
      body: { codes: codes.join("\n"), nameRest: "Pictures Batch Smoke" },
    });
    assert.equal(extract.status, 200);
    const extractJson = JSON.parse(extract.body);
    assert.equal(extractJson.ok, true);
    assert.equal(extractJson.found, 2);
    assert.equal(extractJson.skipped, 1);
    assert.match(extractJson.folderName, /^\d+\. Pictures Batch Smoke$/);

    const folderId = extractJson.folder.id;
    const access = await request(
      port,
      "POST",
      `/projectprogress/photos/projects/${projectId}/folders/${folderId}/client-access`,
      { cookie, body: { clientAccess: true } }
    );
    assert.equal(access.status, 200);
    assert.equal(JSON.parse(access.body).clientAccess, true);

    const surveyorLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "peter.m", password: "PeterMay2468" },
    });
    const surveyorCookie = cookieHeader(surveyorLogin.setCookie);
    const denied = await request(port, "GET", "/projectprogress/photos", { cookie: surveyorCookie });
    assert.equal(denied.status, 403);

    const topbar = await request(port, "GET", "/projectprogress/admin", { cookie });
    assert.match(topbar.body, /Photo Storage|Photos/);
    assert.match(topbar.body, /href="\/projectprogress\/photos"/);
  });
});

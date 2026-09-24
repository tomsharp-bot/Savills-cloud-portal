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
    assert.match(project.body, /id="btnDownloadZip"/);
    assert.match(project.body, /id="btnDeletePhotos"/);
    assert.match(project.body, /id="btnRenamePhoto"/);

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

    const surveyorDelete = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/delete`, {
      cookie: surveyorCookie,
      body: { codes: ["does-not-matter"] },
    });
    assert.equal(surveyorDelete.status, 403);
    const surveyorRename = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/rename`, {
      cookie: surveyorCookie,
      body: { code: "does-not-matter", name: "renamed" },
    });
    assert.equal(surveyorRename.status, 403);
  });

  it("admins can rename and delete pool and folder photos, scoped to that project", async (t) => {
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
    const m = landing.body.match(/href="\/projectprogress\/photos\/projects\/([^"]+)"/);
    assert.ok(m, "expected a project tile link");
    const projectId = m![1];
    const stamp = Date.now().toString(36);
    const keepCode = `zz-keep-${stamp}`;
    const goneCode = `zz-gone-${stamp}`;
    const renamedCode = `zz-renamed-${stamp}`;
    const folderOnly = `zz-folder-${stamp}`;

    const keep = await prisma.photoPoolItem.create({
      data: { projectId, code: keepCode, fileName: `${keepCode}.jpg`, spacesKey: "" },
    });
    const gone = await prisma.photoPoolItem.create({
      data: { projectId, code: goneCode, fileName: `${goneCode}.jpg`, spacesKey: "" },
    });
    const folder = await prisma.photoFolder.create({
      data: {
        projectId,
        name: `9. Delete test ${stamp}`,
        kind: "folder",
        photoCodes: [keepCode, goneCode],
      },
    });
    t.after(async () => {
      await prisma.photoPoolItem.deleteMany({ where: { id: { in: [keep.id, gone.id] } } });
      await prisma.photoFolder.deleteMany({ where: { id: folder.id } });
    });

    const clash = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/rename`, {
      cookie,
      body: { code: keepCode, name: goneCode },
    });
    assert.equal(clash.status, 409);

    const pathName = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/rename`, {
      cookie,
      body: { code: keepCode, name: "../outside" },
    });
    assert.equal(pathName.status, 400);

    const renamed = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/folders/${folder.id}/photos/rename`, {
      cookie,
      body: { code: keepCode, name: `${renamedCode}.jpg` },
    });
    assert.equal(renamed.status, 200);
    const renamedJson = JSON.parse(renamed.body);
    assert.equal(renamedJson.ok, true);
    assert.equal(renamedJson.previousCode, keepCode);
    assert.equal(renamedJson.photo.code, renamedCode);
    assert.equal(renamedJson.photo.fileName, `${renamedCode}.jpg`);
    assert.equal(renamedJson.photo.spacesKey, "");

    const renamedRow = await prisma.photoPoolItem.findUnique({ where: { id: keep.id } });
    assert.equal(renamedRow?.code, renamedCode);
    const renamedFolder = await prisma.photoFolder.findUnique({ where: { id: folder.id } });
    const renamedCodes = Array.isArray(renamedFolder?.photoCodes) ? renamedFolder?.photoCodes.map(String) : [];
    assert.ok(renamedCodes.includes(renamedCode));
    assert.equal(renamedCodes.includes(keepCode), false);

    const outsideFolder = await request(
      port,
      "POST",
      `/projectprogress/photos/projects/${projectId}/folders/${folder.id}/photos/delete`,
      { cookie, body: { codes: [folderOnly] } }
    );
    assert.equal(outsideFolder.status, 400);

    const otherProject = await request(port, "POST", `/projectprogress/photos/projects/not-a-project/pool/delete`, {
      cookie,
      body: { codes: [goneCode] },
    });
    assert.equal(otherProject.status, 404);
    assert.ok(await prisma.photoPoolItem.findUnique({ where: { id: gone.id } }));

    const zip = await request(
      port,
      "GET",
      `/projectprogress/photos/projects/${projectId}/pool/download-zip?codes=${encodeURIComponent(renamedCode)},${encodeURIComponent(goneCode)}`,
      { cookie }
    );
    assert.equal(zip.status, 200);
    assert.match(zip.body, /PK/);

    const folderZipDenied = await request(
      port,
      "GET",
      `/projectprogress/photos/projects/${projectId}/folders/${folder.id}/photos/download-zip?codes=${encodeURIComponent(folderOnly)}`,
      { cookie }
    );
    assert.equal(folderZipDenied.status, 400);

    const deleted = await request(
      port,
      "POST",
      `/projectprogress/photos/projects/${projectId}/folders/${folder.id}/photos/delete`,
      { cookie, body: { codes: [goneCode, renamedCode] } }
    );
    assert.equal(deleted.status, 200);
    const deletedJson = JSON.parse(deleted.body);
    assert.equal(deletedJson.ok, true);
    assert.equal(deletedJson.deletedCodes.length, 2);
    assert.equal(await prisma.photoPoolItem.findUnique({ where: { id: gone.id } }), null);
    assert.equal(await prisma.photoPoolItem.findUnique({ where: { id: keep.id } }), null);
    const afterFolder = await prisma.photoFolder.findUnique({ where: { id: folder.id } });
    const afterCodes = Array.isArray(afterFolder?.photoCodes) ? afterFolder.photoCodes : [];
    assert.equal(afterCodes.length, 0);

    const foreign = await prisma.photoPoolItem.create({
      data: {
        projectId,
        code: `zz-foreign-${stamp}`,
        fileName: `zz-foreign-${stamp}.jpg`,
        spacesKey: "photos/other-project/pool/secret.jpg",
      },
    });
    t.after(async () => {
      await prisma.photoPoolItem.deleteMany({ where: { id: foreign.id } });
    });
    const refused = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/delete`, {
      cookie,
      body: { codes: [foreign.code] },
    });
    assert.equal(refused.status, 400);
    assert.ok(await prisma.photoPoolItem.findUnique({ where: { id: foreign.id } }));
  });
});

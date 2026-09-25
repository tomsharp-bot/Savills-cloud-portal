import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import { photoObjectKey, poolPhotoImagePath, uploadProjectPhoto, type PhotoStorageOps } from "./photos.js";
import { hashPhotoShareSecret } from "./photo-share.js";
import { POOL_IMAGE_READER } from "../routes/photos.js";
import { spacesStatus } from "./spaces.js";

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

function multipartBody(
  parts: Array<{ name: string; value?: string; filename?: string; type?: string; data?: Buffer }>
): { body: Buffer; contentType: string } {
  const boundary = "----scp-photo-upload";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    if (part.filename != null) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.type || "application/octet-stream"}\r\n\r\n`
        )
      );
      chunks.push(part.data || Buffer.alloc(0));
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value || ""}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function request(
  port: number,
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; form?: Record<string, string>; raw?: Buffer; contentType?: string } = {}
) {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.raw) {
    headers["content-type"] = opts.contentType || "application/octet-stream";
    headers.accept = "application/json";
    body = new Blob([Uint8Array.from(opts.raw)]);
  } else if (opts.form) {
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
  const raw = Buffer.from(await res.arrayBuffer());
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return {
    status: res.status,
    body: raw.toString("utf8"),
    raw,
    contentType: res.headers.get("content-type") || "",
    cacheControl: res.headers.get("cache-control") || "",
    nosniff: res.headers.get("x-content-type-options") || "",
    disposition: res.headers.get("content-disposition") || "",
    corp: res.headers.get("cross-origin-resource-policy") || "",
    setCookie,
    location: res.headers.get("location"),
  };
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
    assert.match(project.body, /Upload photos/);
    assert.match(project.body, /\/pool\/upload/);
    assert.match(project.body, /id="btnDownloadZip"/);
    assert.match(project.body, /id="btnDeletePhotos"/);
    assert.match(project.body, /id="btnRenamePhoto"/);

    const bootMatch = project.body.match(/window\.__PHOTOS__ = (\{[\s\S]*?\});\s*<\/script>/);
    assert.ok(bootMatch, "expected bootstrap JSON");
    const boot = JSON.parse(bootMatch![1]);
    assert.equal(boot.poolQueryApi, `/photos/projects/${projectId}/pool`);
    assert.equal(boot.pool, undefined);
    assert.match(project.body, /id="btnPoolShowAll"/);
    assert.match(project.body, /Showing photos added in the last 7 days/);
    const listed = await request(
      port,
      "GET",
      `/projectprogress/photos/projects/${projectId}/pool?window=all&limit=2`,
      { cookie }
    );
    assert.equal(listed.status, 200);
    const listedJson = JSON.parse(listed.body);
    assert.ok(listedJson.photos.length > 0);
    const codes = listedJson.photos
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
    const surveyorUpload = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/upload`, {
      cookie: surveyorCookie,
      body: {},
    });
    assert.equal(surveyorUpload.status, 403);
    const surveyorBlur = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/nope/blur`, {
      cookie: surveyorCookie,
      body: {},
    });
    assert.equal(surveyorBlur.status, 403);
    assert.equal(boot.uploadConcurrency, 4);
    assert.equal(typeof boot.poolUploadApi, "string");
    assert.match(boot.poolUploadApi, /\/pool\/upload$/);
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

  it("uploads pool and folder photos without overwriting an existing code", async (t) => {
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
    const cookie = cookieHeader(login.setCookie);
    const landing = await request(port, "GET", "/projectprogress/photos", { cookie });
    const m = landing.body.match(/href="\/projectprogress\/photos\/projects\/([^"]+)"/);
    assert.ok(m, "expected a project tile link");
    const projectId = m![1];
    const stamp = Date.now().toString(36);
    const existingCode = `zz-have-${stamp}`;
    const freshCode = `zz-new-${stamp}`;
    const folderCode = `zz-folder-new-${stamp}`;
    const failedCode = `zz-fail-${stamp}`;

    const existing = await prisma.photoPoolItem.create({
      data: { projectId, code: existingCode, fileName: `${existingCode}.jpg`, spacesKey: "" },
    });
    const folder = await prisma.photoFolder.create({
      data: {
        projectId,
        name: `9. Upload test ${stamp}`,
        kind: "folder",
        photoCodes: [existingCode],
      },
    });
    const zip = await prisma.photoFolder.create({
      data: { projectId, name: `upload-${stamp}.zip`, kind: "zip", photoCodes: [] },
    });
    const createdIds: string[] = [existing.id];
    t.after(async () => {
      await prisma.photoPoolItem.deleteMany({ where: { id: { in: createdIds } } });
      await prisma.photoPoolItem.deleteMany({ where: { projectId, code: { in: [freshCode, folderCode, failedCode] } } });
      await prisma.photoFolder.deleteMany({ where: { id: { in: [folder.id, zip.id] } } });
    });

    const unsafe = multipartBody([
      { name: "file", filename: "room..1.jpg", type: "image/jpeg", data: Buffer.from("nope") },
    ]);
    const unsafeRes = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/upload`, {
      cookie,
      raw: unsafe.body,
      contentType: unsafe.contentType,
    });
    assert.equal(unsafeRes.status, 400);
    assert.match(unsafeRes.body, /path/);

    const clash = multipartBody([
      { name: "spacesKey", value: "photos/other-project/pool/secret.jpg" },
      { name: "file", filename: `${existingCode}.jpg`, type: "image/jpeg", data: Buffer.from("jpeg-bytes") },
    ]);
    const clashRes = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/upload`, {
      cookie,
      raw: clash.body,
      contentType: clash.contentType,
    });
    assert.equal(clashRes.status, 409);
    assert.match(clashRes.body, /already exists/);
    const unchanged = await prisma.photoPoolItem.findUnique({ where: { id: existing.id } });
    assert.equal(unchanged?.spacesKey, "");
    assert.equal(unchanged?.code, existingCode);

    const missingFolder = multipartBody([
      { name: "file", filename: `${freshCode}.jpg`, type: "image/jpeg", data: Buffer.from("jpeg-bytes") },
    ]);
    const missingRes = await request(
      port,
      "POST",
      `/projectprogress/photos/projects/${projectId}/folders/not-a-folder/photos/upload`,
      { cookie, raw: missingFolder.body, contentType: missingFolder.contentType }
    );
    assert.equal(missingRes.status, 404);

    const zipRes = await request(
      port,
      "POST",
      `/projectprogress/photos/projects/${projectId}/folders/${zip.id}/photos/upload`,
      { cookie, raw: missingFolder.body, contentType: missingFolder.contentType }
    );
    assert.equal(zipRes.status, 400);
    assert.match(zipRes.body, /zip pack/);

    if (!spacesStatus().configured) {
      const blocked = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/upload`, {
        cookie,
        raw: missingFolder.body,
        contentType: missingFolder.contentType,
      });
      assert.equal(blocked.status, 503);
      assert.equal(
        await prisma.photoPoolItem.findFirst({ where: { projectId, code: freshCode } }),
        null
      );
    }

    const puts: string[] = [];
    const storage: PhotoStorageOps = {
      configured: () => true,
      remove: async () => true,
      copy: async () => "copied",
      put: async (key, body) => {
        puts.push(`${key}:${body.toString()}`);
        return true;
      },
    };
    const pooled = await uploadProjectPhoto(
      projectId,
      { originalName: `${freshCode}.JPEG`, buffer: Buffer.from("pool-bytes"), mime: "image/jpeg" },
      { kind: "pool" },
      storage
    );
    assert.equal(pooled.ok, true);
    if (!pooled.ok) return;
    assert.equal(pooled.photo.code, freshCode);
    assert.equal(pooled.photo.fileName, `${freshCode}.jpg`);
    assert.equal(pooled.photo.spacesKey, photoObjectKey(projectId, freshCode, ".jpg"));
    assert.equal(pooled.photo.thumbUrl, poolPhotoImagePath(projectId, freshCode));
    assert.equal(pooled.photo.thumbUrl.includes("digitaloceanspaces.com"), false);
    assert.equal(pooled.folder, undefined);
    createdIds.push(
      (await prisma.photoPoolItem.findFirst({ where: { projectId, code: freshCode } }))!.id
    );
    assert.deepEqual(puts, [`photos/${projectId}/pool/${freshCode}.jpg:pool-bytes`]);

    const again = await uploadProjectPhoto(
      projectId,
      { originalName: `${freshCode}.jpg`, buffer: Buffer.from("other-bytes"), mime: "image/jpeg" },
      { kind: "pool" },
      storage
    );
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.status, 409);
    assert.equal(puts.length, 1);
    const still = await prisma.photoPoolItem.findFirst({ where: { projectId, code: freshCode } });
    assert.equal(still?.spacesKey, photoObjectKey(projectId, freshCode, ".jpg"));

    const folded = await uploadProjectPhoto(
      projectId,
      { originalName: `${folderCode}.png`, buffer: Buffer.from("png-bytes"), mime: "image/png" },
      { kind: "folder", folderId: folder.id },
      storage
    );
    assert.equal(folded.ok, true);
    if (!folded.ok) return;
    assert.equal(folded.photo.spacesKey, photoObjectKey(projectId, folderCode, ".png"));
    assert.ok(folded.folder);
    assert.ok(folded.folder?.photoCodes.includes(folderCode));
    assert.ok(folded.folder?.photoCodes.includes(existingCode));
    const folderRow = await prisma.photoFolder.findUnique({ where: { id: folder.id } });
    const listed = Array.isArray(folderRow?.photoCodes) ? folderRow?.photoCodes.map(String) : [];
    assert.ok(listed.includes(folderCode));
    assert.equal(await prisma.photoPoolItem.findFirst({ where: { projectId, code: folderCode } }) !== null, true);

    const failing: PhotoStorageOps = {
      configured: () => true,
      remove: async () => true,
      copy: async () => "copied",
      put: async () => false,
    };
    const before = listed.slice();
    const failed = await uploadProjectPhoto(
      projectId,
      { originalName: `${failedCode}.webp`, buffer: Buffer.from("webp-bytes"), mime: "image/webp" },
      { kind: "folder", folderId: folder.id },
      failing
    );
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.status, 502);
    assert.equal(await prisma.photoPoolItem.findFirst({ where: { projectId, code: failedCode } }), null);
    const afterFail = await prisma.photoFolder.findUnique({ where: { id: folder.id } });
    const afterCodes = Array.isArray(afterFail?.photoCodes) ? afterFail.photoCodes.map(String) : [];
    assert.deepEqual(afterCodes, before);
    assert.equal(afterCodes.includes(failedCode), false);
  });

  it("issues a project photo-share code Excel can call, and blocks everyone else", async (t) => {
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

    const home = await request(port, "GET", "/projectprogress/");
    assert.equal(home.status, 302);
    assert.match(home.location || "", /\/login/);

    const bogus = await request(port, "GET", "/photos/share/not-a-real-token");
    assert.equal(bogus.status, 401);
    assert.match(bogus.body, /not valid/);
    assert.doesNotMatch(bogus.body, /screen-app|Photo Storage/);

    const login = await request(port, "POST", "/projectprogress/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    const cookie = cookieHeader(login.setCookie);
    const landing = await request(port, "GET", "/projectprogress/photos", { cookie });
    const m = landing.body.match(/href="\/projectprogress\/photos\/projects\/([^"]+)"/);
    assert.ok(m, "expected a project tile link");
    const projectId = m![1];
    const stamp = Date.now().toString(36);
    const doorCode = `224466-Front Door ${stamp}`;
    const kitchenCode = `224466-Kitchen-${stamp}`;
    const clashCode = `113355-Kitchen-${stamp}`;
    const otherCode = `secret-other-${stamp}`;

    const door = await prisma.photoPoolItem.create({
      data: { projectId, code: doorCode, fileName: `${doorCode}.jpg`, spacesKey: "" },
    });
    const kitchen = await prisma.photoPoolItem.create({
      data: { projectId, code: kitchenCode, fileName: `${kitchenCode}.jpg`, spacesKey: "" },
    });
    const clash = await prisma.photoPoolItem.create({
      data: { projectId, code: clashCode, fileName: `${clashCode}.jpg`, spacesKey: "" },
    });
    const otherProject = await prisma.project.create({
      data: { name: `zz share ${stamp}`, projectManager: "Tom Sharp" },
    });
    const otherPhoto = await prisma.photoPoolItem.create({
      data: { projectId: otherProject.id, code: otherCode, fileName: `${otherCode}.jpg`, spacesKey: "" },
    });
    t.after(async () => {
      await prisma.photoShareToken.deleteMany({ where: { projectId: { in: [projectId, otherProject.id] } } });
      await prisma.photoPoolItem.deleteMany({ where: { id: { in: [door.id, kitchen.id, clash.id, otherPhoto.id] } } });
      await prisma.project.deleteMany({ where: { id: otherProject.id } });
    });

    const surveyorLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "peter.m", password: "PeterMay2468" },
    });
    const surveyorCookie = cookieHeader(surveyorLogin.setCookie);
    const surveyorShare = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/photo-share`, {
      cookie: surveyorCookie,
      body: {},
    });
    assert.equal(surveyorShare.status, 403);
    const surveyorReplace = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/replace`, {
      cookie: surveyorCookie,
      body: { find: "224466", replace: "113355", codes: [doorCode] },
    });
    assert.equal(surveyorReplace.status, 403);

    const anonShare = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/photo-share`, {
      body: {},
    });
    assert.equal(anonShare.status, 302);

    const page = await request(port, "GET", `/projectprogress/photos/projects/${projectId}`, { cookie });
    assert.match(page.body, /Get photo sharing code/);
    assert.match(page.body, /id="lightboxRenameInput"/);
    assert.match(page.body, /id="poolFind"/);

    const created = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/photo-share`, {
      cookie,
      body: { label: "Excel" },
    });
    assert.equal(created.status, 200);
    const createdJson = JSON.parse(created.body);
    assert.equal(createdJson.ok, true);
    assert.match(createdJson.address, /^http:\/\/127\.0\.0\.1:\d+\/photos\/share\/[A-Za-z0-9_-]{43}$/);
    assert.equal(createdJson.address.includes("/projectprogress"), false);
    assert.match(createdJson.byCodeExample, /\/by-code\/635569-Front%20Door1$/);
    const secret = createdJson.address.split("/photos/share/")[1];
    const row = await prisma.photoShareToken.findFirst({ where: { projectId, revokedAt: null } });
    assert.ok(row);
    assert.equal(row?.tokenHash, hashPhotoShareSecret(secret));
    assert.equal(JSON.stringify(row).includes(secret), false);
    const expires = row ? row.expiresAt.getTime() - Date.now() : 0;
    assert.ok(expires > 360 * 24 * 60 * 60 * 1000);
    assert.ok(expires < 370 * 24 * 60 * 60 * 1000);

    const help = await request(port, "GET", `/photos/share/${secret}`);
    assert.equal(help.status, 200);
    assert.match(help.body, /Data Horizontal DW!F1/);
    assert.match(help.body, /\/by-code\//);
    assert.match(help.body, /\/codes/);
    assert.doesNotMatch(help.body, /screen-app/);

    const bogusCodes = await request(port, "GET", "/photos/share/not-a-real-token/codes");
    assert.equal(bogusCodes.status, 401);
    assert.match(bogusCodes.body, /not valid/);

    const codesList = await request(port, "GET", `/photos/share/${secret}/codes`);
    assert.equal(codesList.status, 200);
    assert.match(codesList.contentType, /application\/json/);
    assert.match(codesList.cacheControl, /no-store/);
    assert.equal(codesList.nosniff, "nosniff");
    const codesJson = JSON.parse(codesList.body) as { codes: string[]; count: number };
    assert.ok(Array.isArray(codesJson.codes));
    assert.equal(codesJson.count, codesJson.codes.length);
    assert.equal(
      codesJson.codes.find((code) => code.toUpperCase() === doorCode.toUpperCase()),
      doorCode
    );
    assert.ok(codesJson.codes.includes(kitchenCode));
    assert.ok(codesJson.codes.includes(clashCode));
    assert.equal(codesJson.codes.includes(otherCode), false);
    assert.doesNotMatch(codesList.body, /spacesKey|spaces:|https?:\/\//);

    const missing = await request(
      port,
      "GET",
      `/photos/share/${secret}/by-code/${encodeURIComponent("no-such-" + stamp)}`
    );
    assert.equal(missing.status, 404);
    assert.match(missing.body, /Photo not found/);

    const otherHit = await request(
      port,
      "GET",
      `/photos/share/${secret}/by-code/${encodeURIComponent(otherCode)}`
    );
    assert.equal(otherHit.status, 404);
    assert.match(otherHit.body, /Photo not found/);

    const storedCase = `Zz-Case-${stamp}`;
    const stored = await prisma.photoPoolItem.create({
      data: { projectId, code: storedCase, fileName: `${storedCase}.png`, spacesKey: "" },
    });
    t.after(async () => {
      await prisma.photoPoolItem.deleteMany({ where: { id: stored.id } });
    });
    const caseHit = await request(
      port,
      "GET",
      `/photos/share/${secret}/by-code/${encodeURIComponent(storedCase.toLowerCase())}`
    );
    assert.equal(caseHit.status, 404);
    assert.match(caseHit.body, /not available/);
    assert.doesNotMatch(caseHit.body, /spacesKey|photos\//);

    const renewed = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/photo-share/renew`, {
      cookie,
      body: {},
    });
    assert.equal(renewed.status, 200);
    const renewedJson = JSON.parse(renewed.body);
    const nextSecret = renewedJson.address.split("/photos/share/")[1];
    assert.notEqual(nextSecret, secret);
    const oldHelp = await request(port, "GET", `/photos/share/${secret}`);
    assert.equal(oldHelp.status, 403);
    const newHelp = await request(port, "GET", `/photos/share/${nextSecret}`);
    assert.equal(newHelp.status, 200);

    const revoked = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/photo-share/revoke`, {
      cookie,
      body: {},
    });
    assert.equal(revoked.status, 200);
    assert.equal(JSON.parse(revoked.body).active, false);
    const afterRevoke = await request(port, "GET", `/photos/share/${nextSecret}/by-code/${encodeURIComponent(doorCode)}`);
    assert.equal(afterRevoke.status, 403);
    const codesAfterRevoke = await request(port, "GET", `/photos/share/${nextSecret}/codes`);
    assert.equal(codesAfterRevoke.status, 403);

    const again = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/photo-share`, {
      cookie,
      body: {},
    });
    const liveSecret = JSON.parse(again.body).address.split("/photos/share/")[1];
    await prisma.photoShareToken.updateMany({
      where: { tokenHash: hashPhotoShareSecret(liveSecret) },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });
    const expired = await request(port, "GET", `/photos/share/${liveSecret}`);
    assert.equal(expired.status, 401);
    assert.match(expired.body, /expired/);

    const replaced = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/replace`, {
      cookie,
      body: { find: "224466", replace: "113355", codes: [doorCode, kitchenCode, clashCode] },
    });
    assert.equal(replaced.status, 200);
    const replacedJson = JSON.parse(replaced.body);
    assert.equal(replacedJson.renamedCount, 1);
    assert.equal(replacedJson.renamed[0].from, doorCode);
    assert.equal(replacedJson.renamed[0].to, doorCode.replace("224466", "113355"));
    const reasons = replacedJson.skipped.map((row: { reason: string }) => row.reason).join(" ");
    assert.match(reasons, /already exists/);
    assert.match(reasons, /not in that photo code/);
    const doorRow = await prisma.photoPoolItem.findUnique({ where: { id: door.id } });
    assert.equal(doorRow?.code, doorCode.replace("224466", "113355"));
    const kitchenRow = await prisma.photoPoolItem.findUnique({ where: { id: kitchen.id } });
    const clashRow = await prisma.photoPoolItem.findUnique({ where: { id: clash.id } });
    assert.equal(kitchenRow?.code, kitchenCode);
    assert.equal(clashRow?.code, clashCode);

    const emptyFind = await request(port, "POST", `/projectprogress/photos/projects/${projectId}/pool/replace`, {
      cookie,
      body: { find: "   ", replace: "1", codes: [clashCode] },
    });
    assert.equal(emptyFind.status, 400);
  });

  it("serves a pool photo through an authenticated app URL and falls back when Spaces has no bytes", async (t) => {
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

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetched: string[] = [];
    const store = new Map<string, Buffer>();
    const app = createApp({ basePath: "/projectprogress" });
    app.set(POOL_IMAGE_READER, async (key: string) => {
      fetched.push(key);
      return store.get(key) ?? null;
    });
    const { server, port } = await listen(app);
    t.after(() => server.close());

    const anon = await request(port, "GET", "/projectprogress/photos/projects/missing/pool/nope/image");
    assert.equal(anon.status, 302);
    assert.match(anon.location || "", /\/login/);

    const login = await request(port, "POST", "/projectprogress/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    assert.equal(login.status, 302);
    const cookie = cookieHeader(login.setCookie);
    const surveyorLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "peter.m", password: "PeterMay2468" },
    });
    const surveyorCookie = cookieHeader(surveyorLogin.setCookie);

    const landing = await request(port, "GET", "/projectprogress/photos", { cookie });
    const m = landing.body.match(/href="\/projectprogress\/photos\/projects\/([^"]+)"/);
    assert.ok(m, "expected a project tile link");
    const projectId = m![1];
    const stamp = Date.now().toString(36);
    const code = `zz-live-${stamp}`;
    const bareCode = `zz-bare-${stamp}`;
    const foreignCode = `zz-foreign-img-${stamp}`;
    const key = photoObjectKey(projectId, code, ".jpg");
    if (!key) throw new Error("expected a pool key");
    store.set(key, jpeg);

    const live = await prisma.photoPoolItem.create({
      data: { projectId, code, fileName: `${code}.jpg`, spacesKey: key },
    });
    const bare = await prisma.photoPoolItem.create({
      data: { projectId, code: bareCode, fileName: `${bareCode}.png`, spacesKey: "" },
    });
    const foreign = await prisma.photoPoolItem.create({
      data: {
        projectId,
        code: foreignCode,
        fileName: `${foreignCode}.jpg`,
        spacesKey: "photos/other-project/pool/secret.jpg",
      },
    });
    t.after(async () => {
      await prisma.photoPoolItem.deleteMany({ where: { id: { in: [live.id, bare.id, foreign.id] } } });
    });

    const denied = await request(
      port,
      "GET",
      `/projectprogress/photos/projects/${projectId}/pool/${encodeURIComponent(code)}/image`,
      { cookie: surveyorCookie }
    );
    assert.equal(denied.status, 403);

    const imagePath = `/projectprogress${poolPhotoImagePath(projectId, code)}`;
    const image = await request(port, "GET", imagePath, { cookie });
    assert.equal(image.status, 200);
    assert.match(image.contentType, /^image\/jpeg/);
    assert.deepEqual(image.raw, jpeg);
    assert.equal(image.nosniff, "nosniff");
    assert.equal(image.corp, "same-origin");
    assert.match(image.cacheControl, /private/);
    assert.match(image.cacheControl, /no-cache/);
    assert.doesNotMatch(image.cacheControl, /public/);
    assert.match(image.disposition, /inline/);
    assert.equal(image.body.includes("digitaloceanspaces.com"), false);
    assert.equal(image.disposition.includes("photos/"), false);
    assert.deepEqual(fetched, [key]);

    const missingKey = photoObjectKey(projectId, `zz-missing-${stamp}`, ".png");
    if (!missingKey) throw new Error("expected a missing pool key");
    const missing = await prisma.photoPoolItem.create({
      data: {
        projectId,
        code: `zz-missing-${stamp}`,
        fileName: `zz-missing-${stamp}.png`,
        spacesKey: missingKey,
      },
    });
    t.after(async () => {
      await prisma.photoPoolItem.deleteMany({ where: { id: missing.id } });
    });
    const fallback = await request(
      port,
      "GET",
      `/projectprogress${poolPhotoImagePath(projectId, missing.code)}`,
      { cookie }
    );
    assert.equal(fallback.status, 200);
    assert.match(fallback.contentType, /image\/svg\+xml/);
    assert.match(fallback.cacheControl, /no-store/);
    assert.match(fallback.body, /<svg/);
    assert.equal(fallback.body.includes("digitaloceanspaces.com"), false);
    assert.ok(fetched.includes(missingKey));

    const pngCode = `zz-png-${stamp}`;
    const pngKey = photoObjectKey(projectId, pngCode, ".png");
    if (!pngKey) throw new Error("expected a png pool key");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    store.set(pngKey, png);
    const pngRow = await prisma.photoPoolItem.create({
      data: { projectId, code: pngCode, fileName: `${pngCode}.png`, spacesKey: pngKey },
    });
    t.after(async () => {
      await prisma.photoPoolItem.deleteMany({ where: { id: pngRow.id } });
    });
    const pngImage = await request(port, "GET", `/projectprogress${poolPhotoImagePath(projectId, pngCode)}`, {
      cookie,
    });
    assert.equal(pngImage.status, 200);
    assert.match(pngImage.contentType, /^image\/png/);
    assert.deepEqual(pngImage.raw, png);

    const beforeBare = fetched.length;
    const bareImage = await request(
      port,
      "GET",
      `/projectprogress${poolPhotoImagePath(projectId, bareCode)}`,
      { cookie }
    );
    assert.equal(bareImage.status, 200);
    assert.match(bareImage.contentType, /image\/svg\+xml/);
    assert.equal(fetched.length, beforeBare);

    const beforeForeign = fetched.length;
    const foreignImage = await request(
      port,
      "GET",
      `/projectprogress${poolPhotoImagePath(projectId, foreignCode)}`,
      { cookie }
    );
    assert.equal(foreignImage.status, 404);
    assert.equal(fetched.length, beforeForeign);
    assert.equal(fetched.includes("photos/other-project/pool/secret.jpg"), false);

    const unknown = await request(
      port,
      "GET",
      `/projectprogress${poolPhotoImagePath(projectId, "does-not-exist")}`,
      { cookie }
    );
    assert.equal(unknown.status, 404);

    const otherProject = await request(
      port,
      "GET",
      `/projectprogress${poolPhotoImagePath("not-a-project", code)}`,
      { cookie }
    );
    assert.equal(otherProject.status, 404);

    const page = await request(port, "GET", `/projectprogress/photos/projects/${projectId}`, { cookie });
    assert.equal(page.status, 200);
    assert.match(page.body, /id="btnPoolShowAll"/);
    const liveListed = await request(
      port,
      "GET",
      `/projectprogress/photos/projects/${projectId}/pool?q=${encodeURIComponent(code)}`,
      { cookie }
    );
    assert.equal(liveListed.status, 200);
    const liveJson = JSON.parse(liveListed.body);
    assert.equal(liveJson.window, "search");
    const liveView = liveJson.photos.find((p: { code: string }) => p.code === code);
    const bareListed = await request(
      port,
      "GET",
      `/projectprogress/photos/projects/${projectId}/pool?q=${encodeURIComponent(bareCode)}`,
      { cookie }
    );
    const bareView = JSON.parse(bareListed.body).photos.find((p: { code: string }) => p.code === bareCode);
    assert.ok(liveView);
    assert.equal(liveView.thumbUrl, poolPhotoImagePath(projectId, code));
    assert.match(liveView.thumbUrl, /^\/photos\/projects\//);
    assert.equal(String(liveView.thumbUrl).includes("digitaloceanspaces.com"), false);
    assert.ok(bareView);
    assert.match(bareView.thumbUrl, /^data:image\/svg\+xml/);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import "dotenv/config";
import {
  archiveLiveMaster,
  findMasterRecord,
  isLiveMaster,
  listLiveMasterDataFiles,
  masterDataFileName,
  masterStoredPath,
  parseMasterDataFileName,
  readStoredMaster,
  safeMasterProjectName,
  storeMasterDataFile,
} from "./master-data-files.js";

describe("Master Data File names", () => {
  it("uses the practice-page name for the current master", () => {
    assert.equal(safeMasterProjectName("Harbour Court"), "Harbour Court");
    assert.equal(safeMasterProjectName("A/B:C"), "A-B-C");
    assert.equal(masterDataFileName("Harbour Court", 1), "Harbour Court-Master Data File-V1.xlsm");
    assert.equal(masterDataFileName("Harbour Court", 3), "Harbour Court-Master Data File-V3.xlsm");
    assert.deepEqual(parseMasterDataFileName("Harbour Court-Master Data File-V2.xlsm"), {
      projectKey: "Harbour Court",
      version: 2,
    });
    assert.equal(parseMasterDataFileName("Harbour Court-Master Data File-V2.xlsx"), null);
    assert.equal(parseMasterDataFileName("notes.xlsm"), null);
  });

  it("treats a file as live only while it is the current master and not archived", () => {
    assert.equal(isLiveMaster({ current: true, archivedAt: null }), true);
    assert.equal(isLiveMaster({ current: false, archivedAt: null }), false);
    assert.equal(isLiveMaster({ current: true, archivedAt: new Date() }), false);
    assert.equal(isLiveMaster({ current: false, archivedAt: new Date() }), false);
  });
});

const MACRO_MARK = Buffer.from("vbaProject.bin-macro-payload-not-stripped");

function workbook(mark: string): Buffer {
  return Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.from(mark), MACRO_MARK]);
}

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
  opts: { cookie?: string; form?: Record<string, string>; raw?: { body: Buffer; contentType: string } } = {}
) {
  const headers: Record<string, string> = {};
  let body: string | Buffer | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  if (opts.raw) {
    headers["content-type"] = opts.raw.contentType;
    headers["content-length"] = String(opts.raw.body.length);
    body = opts.raw.body;
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: typeof body === "string" || body == null ? body : new Uint8Array(body),
    redirect: "manual",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return {
    status: res.status,
    body: buf.toString("utf8"),
    bytes: buf,
    setCookie,
    location: res.headers.get("location"),
    type: res.headers.get("content-type"),
    disposition: res.headers.get("content-disposition"),
  };
}

function cookieHeader(setCookie: string[]): string {
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

function multipart(filename: string, bytes: Buffer, asNew: boolean): { body: Buffer; contentType: string } {
  const boundary = "----scp-mdf";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/vnd.ms-excel.sheet.macroEnabled.12\r\n\r\n`
  );
  const mid = Buffer.from(
    `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="asNew"\r\n\r\n` +
      `${asNew ? "1" : "0"}\r\n` +
      `--${boundary}--\r\n`
  );
  return { body: Buffer.concat([head, bytes, mid]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("Live master list", () => {
  it("lists live files, downloads the stored workbook, and archives without deleting", async (t) => {
    if (!process.env.DATABASE_URL?.trim()) {
      t.skip("Postgres not available");
      return;
    }
    const { prisma } = await import("./prisma.js");
    const { hashPassword } = await import("./passwords.js");
    const { createApp } = await import("../app.js");
    try {
      await prisma.user.findFirst({ where: { username: "phil.m" } });
    } catch {
      t.skip("Postgres not available");
      return;
    }

    const stamp = Date.now();
    const harbourName = `Harbour Court ${stamp}`;
    const quayName = `Quay Street ${stamp}`;
    const createdProjects: string[] = [];
    const createdUsers: string[] = [];
    let tomCookie = "";
    let philCookie = "";

    const app = createApp({ basePath: "/projectprogress" });
    const { server, port } = await listen(app);
    t.after(async () => {
      server.close();
      const files = await prisma.masterDataFile.findMany({
        where: { projectId: { in: createdProjects } },
      });
      for (const file of files) {
        await fs.unlink(masterStoredPath(file.storedName)).catch(() => undefined);
      }
      if (createdProjects.length) {
        await prisma.masterDataFile.deleteMany({ where: { projectId: { in: createdProjects } } });
        await prisma.project.deleteMany({ where: { id: { in: createdProjects } } });
      }
      if (createdUsers.length) {
        await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
      }
    });

    const harbour = await prisma.project.create({
      data: { name: harbourName, projectManager: "Test", stage: "current", hhsrsCode: "HBR" },
    });
    const quay = await prisma.project.create({
      data: { name: quayName, projectManager: "Test", stage: "current", hhsrsCode: "QUY" },
    });
    createdProjects.push(harbour.id, quay.id);

    const v1 = workbook("harbour-v1");
    const v2 = workbook("harbour-v2");
    const quayBytes = workbook("quay-v1");
    const first = await storeMasterDataFile({
      bytes: v1,
      fileName: masterDataFileName(harbourName, 1),
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = await storeMasterDataFile({
      bytes: quayBytes,
      fileName: masterDataFileName(quayName, 1),
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    const live = await listLiveMasterDataFiles();
    const names = live.map((file) => file.name);
    assert.ok(names.includes(masterDataFileName(harbourName, 1)));
    assert.ok(names.includes(masterDataFileName(quayName, 1)));

    const newer = await storeMasterDataFile({
      bytes: v2,
      fileName: masterDataFileName(harbourName, 2),
      replaceId: first.id,
      asNew: true,
    });
    assert.equal(newer.ok, true);
    if (!newer.ok) return;
    assert.notEqual(newer.id, first.id);

    const afterNew = await listLiveMasterDataFiles();
    assert.equal(
      afterNew.some((file) => file.name === masterDataFileName(harbourName, 1)),
      false
    );
    assert.equal(
      afterNew.some((file) => file.name === masterDataFileName(harbourName, 2)),
      true
    );
    const kept = await readStoredMaster(first.id);
    assert.ok(kept);
    assert.equal(kept?.live, false);
    assert.deepEqual(kept?.bytes, v1);
    const oldRow = await prisma.masterDataFile.findUnique({ where: { id: first.id } });
    assert.equal(oldRow?.archivedAt, null);
    assert.equal(oldRow?.current, false);

    const password = "DataChecksList-2468";
    const passwordHash = await hashPassword(password);
    const existingTom = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: "tsharp", mode: "insensitive" } },
          { email: { equals: "tsharp@savillshousing.co.uk", mode: "insensitive" } },
        ],
      },
    });
    const tomUsername = "tsharp";
    const tomPassword = password;
    if (existingTom) {
      t.diagnostic("Tom Sharp’s login already exists; skipping the page assertions");
      return;
    }
    const tom = await prisma.user.create({
      data: {
        username: "tsharp",
        name: "Tom Sharp",
        email: "tsharp@savillshousing.co.uk",
        role: "admin",
        passwordHash,
      },
    });
    createdUsers.push(tom.id);

    const tomLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: tomUsername, password: tomPassword },
    });
    assert.equal(tomLogin.status, 302);
    tomCookie = cookieHeader(tomLogin.setCookie);

    const philLogin = await request(port, "POST", "/projectprogress/login", {
      form: { username: "phil.m", password: "PhilMoon2468" },
    });
    if (philLogin.status !== 302) {
      t.skip("Seeded admin login is not available");
      return;
    }
    philCookie = cookieHeader(philLogin.setCookie);

    const list = await request(port, "GET", "/projectprogress/data-checks", { cookie: tomCookie });
    assert.equal(list.status, 200);
    assert.match(list.body, /Live master files/);
    assert.match(list.body, new RegExp(masterDataFileName(harbourName, 2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(list.body, new RegExp(masterDataFileName(quayName, 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(list.body, new RegExp(masterDataFileName(harbourName, 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(list.body, />Download File</);
    assert.match(list.body, />Archive File</);
    assert.match(list.body, new RegExp(`Archive ${masterDataFileName(harbourName, 2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(list.body, />Delete</);
    assert.doesNotMatch(list.body, />Upload</);
    assert.doesNotMatch(list.body, /id="cellRead"/);

    const open = await request(port, "GET", `/projectprogress/data-checks/files/${newer.id}`, { cookie: tomCookie });
    assert.equal(open.status, 200);
    assert.match(open.body, /Back to live files/);
    assert.match(open.body, /href="\/projectprogress\/data-checks"/);
    assert.match(open.body, /id="cellRead"/);
    assert.match(open.body, /id="bSaveMaster"/);
    assert.match(open.body, new RegExp(masterDataFileName(harbourName, 2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const download = await request(port, "GET", `/projectprogress/data-checks/files/${newer.id}/download`, {
      cookie: tomCookie,
    });
    assert.equal(download.status, 200);
    assert.match(download.type || "", /sheet\.macroEnabled/);
    assert.match(download.disposition || "", /attachment/);
    assert.match(download.disposition || "", /Master Data File-V2\.xlsm/);
    assert.deepEqual(download.bytes, v2);

    const saved = workbook("harbour-v2-validated");
    const save = await request(port, "POST", `/projectprogress/data-checks/files/${newer.id}/save`, {
      cookie: tomCookie,
      raw: multipart(masterDataFileName(harbourName, 2), saved, false),
    });
    assert.equal(save.status, 200, save.body);
    const again = await readStoredMaster(newer.id);
    assert.deepEqual(again?.bytes, saved);

    const philList = await request(port, "GET", "/projectprogress/data-checks", { cookie: philCookie });
    assert.equal(philList.status, 403);
    assert.equal(philList.body, "Only Tom Sharp can open Data Checks.");
    const philOpen = await request(port, "GET", `/projectprogress/data-checks/files/${newer.id}`, { cookie: philCookie });
    assert.equal(philOpen.status, 403);
    const philDownload = await request(port, "GET", `/projectprogress/data-checks/files/${newer.id}/download`, {
      cookie: philCookie,
    });
    assert.equal(philDownload.status, 403);
    assert.notDeepEqual(philDownload.bytes, saved);
    const philArchive = await request(port, "POST", `/projectprogress/data-checks/files/${second.id}/archive`, {
      cookie: philCookie,
    });
    assert.equal(philArchive.status, 403);

    const archive = await request(port, "POST", `/projectprogress/data-checks/files/${second.id}/archive`, {
      cookie: tomCookie,
    });
    assert.equal(archive.status, 302);
    assert.match(decodeURIComponent(archive.location || ""), new RegExp(masterDataFileName(quayName, 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const after = await request(port, "GET", "/projectprogress/data-checks", { cookie: tomCookie });
    assert.doesNotMatch(after.body, new RegExp(masterDataFileName(quayName, 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(after.body, /The file and its validations are kept/);

    const archived = await findMasterRecord(second.id);
    assert.equal(archived?.live, false);
    const archivedBytes = await readStoredMaster(second.id);
    assert.deepEqual(archivedBytes?.bytes, quayBytes);
    const archivedDownload = await request(port, "GET", `/projectprogress/data-checks/files/${second.id}/download`, {
      cookie: tomCookie,
    });
    assert.equal(archivedDownload.status, 200);
    assert.deepEqual(archivedDownload.bytes, quayBytes);
    const archivedOpen = await request(port, "GET", `/projectprogress/data-checks/files/${second.id}`, {
      cookie: tomCookie,
    });
    assert.equal(archivedOpen.status, 404);

    const archivedRow = await prisma.masterDataFile.findUnique({ where: { id: second.id } });
    assert.ok(archivedRow?.archivedAt);
    await fs.access(masterStoredPath(archivedRow!.storedName));

    const result = await archiveLiveMaster(second.id);
    assert.equal(result.ok, false);
  });
});

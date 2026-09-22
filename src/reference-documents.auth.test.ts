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
  contentType: string;
  disposition: string;
  setCookie: string[];
};

let createApp: CreateApp;
let dbReady = false;

function request(
  app: Express,
  method: string,
  url: string,
  opts: { body?: string | Buffer; cookie?: string; contentType?: string } = {}
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const payload = opts.body;
      const headers: Record<string, string | number> = {};
      if (payload) {
        headers["content-type"] = opts.contentType || "application/x-www-form-urlencoded";
        headers["content-length"] = Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload);
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
              contentType: String(res.headers["content-type"] || ""),
              disposition: String(res.headers["content-disposition"] || ""),
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

function multipart(filename: string, contentType: string, body: Buffer): { body: Buffer; contentType: string } {
  const boundary = "----refdocsboundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, body, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
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
    await prisma.referenceDocument.findFirst();
    dbReady = Boolean(admin);
  } catch {
    dbReady = false;
  }
});

describe("reference documents auth", () => {
  it("sends signed-out visitors to login", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const home = await request(app, "GET", "/projectprogress/reference-documents");
    assert.equal(home.status, 302);
    assert.equal(home.location, "/projectprogress/login");
    const surveyor = await request(app, "GET", "/projectprogress/surveyor");
    assert.equal(surveyor.status, 302);
    assert.equal(surveyor.location, "/projectprogress/login");
  });

  it("lets admins upload, view, and delete, and keeps surveyors read-only and clients out", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with the reference-documents migration is not available");
      return;
    }
    const app = createApp({ basePath: "/projectprogress" });
    const { prisma } = await import("./lib/prisma.js");
    const { removeReferenceFile } = await import("./lib/reference-documents.js");
    const filename = `ref-auth-${Date.now()}.pdf`;
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    let docId = "";

    try {
      const adminLogin = await login(app, "phil.m", "PhilMoon2468");
      const adminCookie = cookieHeader(adminLogin.setCookie);
      const surveyorLogin = await login(app, "peter.m", "PeterMay2468");
      const surveyorCookie = cookieHeader(surveyorLogin.setCookie);
      const clientLogin = await login(app, "client.j", "ClientJones2468");
      const clientCookie = cookieHeader(clientLogin.setCookie);

      const clientHome = await request(app, "GET", "/projectprogress/reference-documents", { cookie: clientCookie });
      assert.equal(clientHome.status, 403);
      const clientCat = await request(app, "GET", "/projectprogress/reference-documents/general", {
        cookie: clientCookie,
      });
      assert.equal(clientCat.status, 403);
      const clientSurveyor = await request(app, "GET", "/projectprogress/surveyor", { cookie: clientCookie });
      assert.equal(clientSurveyor.status, 403);

      const adminSurveyor = await request(app, "GET", "/projectprogress/surveyor", { cookie: adminCookie });
      assert.equal(adminSurveyor.status, 403);

      const library = await request(app, "GET", "/projectprogress/reference-documents", { cookie: adminCookie });
      assert.equal(library.status, 200);
      const generalAt = library.body.indexOf("General Surveying Docs");
      const blocksAt = library.body.indexOf(">Blocks<");
      const hhsrsAt = library.body.indexOf(">HHSRS<");
      const rdsapAt = library.body.indexOf(">RDSAP<");
      const starterAt = library.body.indexOf("New Starter Docs");
      const otherAt = library.body.indexOf(">Other<");
      assert.ok(generalAt >= 0 && generalAt < blocksAt && blocksAt < hhsrsAt);
      assert.ok(hhsrsAt < rdsapAt && rdsapAt < starterAt && starterAt < otherAt);

      const surveyorUpload = await request(app, "POST", "/projectprogress/reference-documents/general", {
        cookie: surveyorCookie,
        ...multipart(filename, "application/pdf", pdf),
      });
      assert.equal(surveyorUpload.status, 403);

      const bad = multipart("notes.txt", "text/plain", Buffer.from("hello"));
      const rejected = await request(app, "POST", "/projectprogress/reference-documents/general", {
        cookie: adminCookie,
        ...bad,
      });
      assert.equal(rejected.status, 302);
      assert.match(rejected.location, /reference-documents\/general\?error=/);

      const uploaded = await request(app, "POST", "/projectprogress/reference-documents/general", {
        cookie: adminCookie,
        ...multipart(filename, "application/pdf", pdf),
      });
      assert.equal(uploaded.status, 302);
      assert.match(uploaded.location, /\/projectprogress\/reference-documents\/general\?notice=/);

      const adminList = await request(app, "GET", "/projectprogress/reference-documents/general", {
        cookie: adminCookie,
      });
      assert.equal(adminList.status, 200);
      assert.match(adminList.body, /id="dropZone"/);
      assert.match(adminList.body, /Drag and drop files here/);
      assert.match(adminList.body, new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(adminList.body, /btn-danger/);
      const row = await prisma.referenceDocument.findFirst({ where: { name: filename, category: "general" } });
      docId = row?.id || "";
      assert.ok(docId);
      assert.match(adminList.body, new RegExp(`/reference-documents/general/${docId}/view`));
      assert.match(adminList.body, new RegExp(`/reference-documents/general/${docId}/delete`));

      const view = await request(
        app,
        "GET",
        `/projectprogress/reference-documents/general/${docId}/view`,
        { cookie: surveyorCookie }
      );
      assert.equal(view.status, 200);
      assert.match(view.contentType, /application\/pdf/);
      assert.match(view.disposition, /inline/);
      assert.match(view.disposition, new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.ok(view.body.startsWith("%PDF"));

      const download = await request(
        app,
        "GET",
        `/projectprogress/reference-documents/general/${docId}/download`,
        { cookie: surveyorCookie }
      );
      assert.equal(download.status, 200);
      assert.match(download.disposition, /attachment/);

      const surveyorList = await request(app, "GET", "/projectprogress/reference-documents/general", {
        cookie: surveyorCookie,
      });
      assert.equal(surveyorList.status, 200);
      assert.match(surveyorList.body, new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(surveyorList.body, />Open</);
      assert.match(surveyorList.body, />Download</);
      assert.doesNotMatch(surveyorList.body, /id="dropZone"/);
      assert.doesNotMatch(surveyorList.body, /Drag and drop/);
      assert.doesNotMatch(surveyorList.body, /type="file"/);
      assert.doesNotMatch(surveyorList.body, /btn-danger/);
      assert.doesNotMatch(surveyorList.body, />Delete</);

      const surveyorDelete = await request(
        app,
        "POST",
        `/projectprogress/reference-documents/general/${docId}/delete`,
        { cookie: surveyorCookie }
      );
      assert.equal(surveyorDelete.status, 403);
      const stillThere = await prisma.referenceDocument.findUnique({ where: { id: docId } });
      assert.ok(stillThere);

      const deleted = await request(
        app,
        "POST",
        `/projectprogress/reference-documents/general/${docId}/delete`,
        { cookie: adminCookie }
      );
      assert.equal(deleted.status, 302);
      assert.match(deleted.location, /notice=/);
      const gone = await prisma.referenceDocument.findUnique({ where: { id: docId } });
      assert.equal(gone, null);
      docId = "";
    } finally {
      if (docId) {
        const row = await prisma.referenceDocument.findUnique({ where: { id: docId } });
        if (row) {
          await removeReferenceFile(row);
          await prisma.referenceDocument.delete({ where: { id: row.id } });
        }
      }
    }
  });
});

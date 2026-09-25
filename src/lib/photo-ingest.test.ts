import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import {
  bearerToken,
  ingestProjectPhotos,
  photoIngestAuthorized,
  photoIngestConfigured,
  PHOTO_INGEST_MAX_BYTES,
} from "./photo-ingest.js";
import { PHOTO_INGEST_STORAGE } from "../routes/photo-ingest.js";
import {
  overwriteProjectPhotoBytes,
  photoObjectKey,
  poolListWhere,
  queryProjectPool,
  type PhotoStorageOps,
} from "./photos.js";

process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

function multipartBody(
  parts: Array<{ name: string; filename: string; type?: string; data: Buffer }>
): { body: Buffer; contentType: string } {
  const boundary = "----scp-photo-ingest";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
          `Content-Type: ${part.type || "application/octet-stream"}\r\n\r\n`
      )
    );
    chunks.push(part.data);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

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
  opts: { authorization?: string; raw?: Buffer; contentType?: string } = {}
) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.authorization) headers.authorization = opts.authorization;
  if (opts.raw) headers["content-type"] = opts.contentType || "application/octet-stream";
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: opts.raw ? new Uint8Array(opts.raw) : undefined,
  });
  const raw = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: raw.toString("utf8"), raw };
}

describe("photo ingest key", () => {
  it("accepts only an exact bearer token and treats a missing env var as unset", () => {
    assert.equal(bearerToken("Bearer morning-key"), "morning-key");
    assert.equal(bearerToken("bearer morning-key"), "morning-key");
    assert.equal(bearerToken("Basic morning-key"), "");
    assert.equal(bearerToken(""), "");
    assert.equal(photoIngestAuthorized("Bearer morning-key", "morning-key"), true);
    assert.equal(photoIngestAuthorized("Bearer morning-key ", "morning-key"), true);
    assert.equal(photoIngestAuthorized("Bearer wrong-key", "morning-key"), false);
    assert.equal(photoIngestAuthorized("Bearer morning-key-extra", "morning-key"), false);
    assert.equal(photoIngestAuthorized("Bearer morning", "morning-key"), false);
    assert.equal(photoIngestAuthorized(undefined, "morning-key"), false);
    assert.equal(photoIngestAuthorized("Bearer morning-key", ""), false);
    const previous = process.env.PHOTO_INGEST_KEY;
    delete process.env.PHOTO_INGEST_KEY;
    assert.equal(photoIngestConfigured(), false);
    process.env.PHOTO_INGEST_KEY = "  ";
    assert.equal(photoIngestConfigured(), false);
    process.env.PHOTO_INGEST_KEY = "abc";
    assert.equal(photoIngestConfigured(), true);
    if (previous === undefined) delete process.env.PHOTO_INGEST_KEY;
    else process.env.PHOTO_INGEST_KEY = previous;
  });

  it("returns 503 when PHOTO_INGEST_KEY is unset and 401 for a bad bearer token", async () => {
    const previous = process.env.PHOTO_INGEST_KEY;
    delete process.env.PHOTO_INGEST_KEY;
    const app = createApp({ basePath: "/projectprogress" });
    const { server, port } = await listen(app);
    try {
      const open = await request(port, "POST", "/api/projects/MTVH%202026/photos/ingest");
      assert.equal(open.status, 503);
      assert.match(open.body, /PHOTO_INGEST_KEY/);
      const listed = await request(port, "GET", "/api/projects/MTVH%202026/photos");
      assert.equal(listed.status, 503);

      process.env.PHOTO_INGEST_KEY = "morning-secret";
      const missing = await request(port, "GET", "/api/projects/MTVH%202026/photos");
      assert.equal(missing.status, 401);
      const wrong = await request(port, "POST", "/api/projects/MTVH%202026/photos/ingest", {
        authorization: "Bearer not-the-key",
      });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.includes("morning-secret"), false);
      assert.match(wrong.body, /Unauthorized/);
    } finally {
      server.close();
      if (previous === undefined) delete process.env.PHOTO_INGEST_KEY;
      else process.env.PHOTO_INGEST_KEY = previous;
    }
  });
});

describe("photo ingest and pool window", () => {
  it("skips an existing name without overwrite, keeps the uploaded stem, and hides photos older than 7 days", async (t) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      t.skip("Postgres not available");
      return;
    }

    const previousKey = process.env.PHOTO_INGEST_KEY;
    process.env.PHOTO_INGEST_KEY = "morning-secret";
    const stamp = Date.now().toString(36);
    const project = await prisma.project.create({
      data: { name: `Ingest ${stamp}`, projectManager: "Test Lead", stage: "current" },
    });
    const existingCode = `Already-${stamp}`;
    const existingKey = photoObjectKey(project.id, existingCode, ".jpg");
    assert.ok(existingKey);
    const existing = await prisma.photoPoolItem.create({
      data: {
        projectId: project.id,
        code: existingCode,
        fileName: `${existingCode}.jpg`,
        spacesKey: existingKey!,
      },
    });
    const freshStem = `Keep-Case-${stamp}`;
    const puts: string[] = [];
    const storage: PhotoStorageOps = {
      configured: () => true,
      remove: async () => true,
      copy: async () => "copied",
      put: async (key, body) => {
        puts.push(`${key}:${body.toString("utf8")}`);
        return true;
      },
    };
    const app = createApp({ basePath: "/projectprogress" });
    app.set(PHOTO_INGEST_STORAGE, storage);
    const { server, port } = await listen(app);
    t.after(async () => {
      server.close();
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
      if (previousKey === undefined) delete process.env.PHOTO_INGEST_KEY;
      else process.env.PHOTO_INGEST_KEY = previousKey;
    });

    const uploadName = `${freshStem}.JPEG`;
    const clashName = `${existingCode.toLowerCase()}.JPG`;
    const form = multipartBody([
      { name: "files", filename: clashName, type: "image/jpeg", data: Buffer.from("should-not-replace") },
      { name: "files", filename: uploadName, type: "image/jpeg", data: Buffer.from("new-bytes") },
      { name: "file", filename: "notes.txt", type: "text/plain", data: Buffer.from("nope") },
    ]);
    const ingested = await request(port, "POST", `/api/projects/${encodeURIComponent(project.name)}/photos/ingest`, {
      authorization: "Bearer morning-secret",
      raw: form.body,
      contentType: form.contentType,
    });
    assert.equal(ingested.status, 200);
    const body = JSON.parse(ingested.body);
    assert.deepEqual(body.uploaded, [uploadName]);
    assert.deepEqual(body.skipped, [clashName]);
    assert.equal(body.failed.length, 1);
    assert.equal(body.failed[0].name, "notes.txt");
    assert.equal(puts.length, 1);
    assert.equal(puts[0], `${photoObjectKey(project.id, freshStem, ".jpg")}:new-bytes`);

    const unchanged = await prisma.photoPoolItem.findUnique({ where: { id: existing.id } });
    assert.equal(unchanged?.spacesKey, existingKey);
    assert.equal(unchanged?.code, existingCode);
    assert.equal(unchanged?.fileName, `${existingCode}.jpg`);

    const created = await prisma.photoPoolItem.findFirst({ where: { projectId: project.id, code: freshStem } });
    assert.ok(created);
    assert.equal(created?.code, freshStem);
    assert.equal(created?.fileName, `${freshStem}.jpg`);
    assert.equal(created?.spacesKey, photoObjectKey(project.id, freshStem, ".jpg"));

    const second = multipartBody([
      { name: "files", filename: `${freshStem}.jpg`, type: "image/jpeg", data: Buffer.from("other-bytes") },
    ]);
    const againReal = await request(port, "POST", `/api/projects/${project.id}/photos/ingest`, {
      authorization: "Bearer morning-secret",
      raw: second.body,
      contentType: second.contentType,
    });
    assert.equal(againReal.status, 200);
    const againJson = JSON.parse(againReal.body);
    assert.deepEqual(againJson.uploaded, []);
    assert.deepEqual(againJson.skipped, [`${freshStem}.jpg`]);
    assert.equal(puts.length, 1);
    const still = await prisma.photoPoolItem.findFirst({ where: { projectId: project.id, code: freshStem } });
    assert.equal(still?.spacesKey, photoObjectKey(project.id, freshStem, ".jpg"));

    const names = await request(port, "GET", `/api/projects/${encodeURIComponent(project.name)}/photos`, {
      authorization: "Bearer morning-secret",
    });
    assert.equal(names.status, 200);
    const listed = JSON.parse(names.body);
    assert.equal(listed.count, 2);
    assert.deepEqual(listed.names, [`${existingCode}.jpg`, `${freshStem}.jpg`]);

    const anon = await request(port, "GET", `/api/projects/${project.id}/photos`);
    assert.equal(anon.status, 401);

    const now = new Date("2026-09-25T12:00:00.000Z");
    const oldCode = `Old-${stamp}`;
    await prisma.photoPoolItem.create({
      data: {
        projectId: project.id,
        code: oldCode,
        fileName: `${oldCode}.jpg`,
        spacesKey: "",
        createdAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.photoPoolItem.update({
      where: { id: created!.id },
      data: { createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) },
    });
    await prisma.photoPoolItem.update({
      where: { id: existing.id },
      data: { createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
    });
    const recentWhere = poolListWhere(project.id, { now }).where;
    const recentRows = await prisma.photoPoolItem.findMany({
      where: { AND: [recentWhere, { code: { in: [freshStem, oldCode, existingCode] } }] },
      select: { code: true },
    });
    assert.deepEqual(
      recentRows.map((row) => row.code).sort(),
      [existingCode, freshStem].sort()
    );
    const foundOld = await queryProjectPool(project.id, { q: oldCode, showAll: false, now, limit: 10 });
    assert.equal(foundOld.window, "search");
    assert.equal(
      foundOld.photos.some((photo) => photo.code === oldCode),
      true
    );
    const recentPage = await queryProjectPool(project.id, { showAll: false, now, limit: 100 });
    assert.equal(recentPage.window, "recent");
    assert.equal(
      recentPage.photos.some((photo) => photo.code === oldCode),
      false
    );
    assert.equal(
      recentPage.photos.some((photo) => photo.code === freshStem),
      true
    );

    const blurredKey = created!.spacesKey;
    const blurred = await overwriteProjectPhotoBytes(
      project.id,
      freshStem,
      { buffer: Buffer.from("pixelated-jpeg"), mime: "image/jpeg" },
      storage
    );
    assert.equal(blurred.ok, true);
    if (!blurred.ok) return;
    assert.equal(blurred.photo.code, freshStem);
    assert.equal(blurred.photo.fileName, `${freshStem}.jpg`);
    assert.equal(blurred.photo.spacesKey, blurredKey);
    assert.match(blurred.photo.thumbUrl, /\?v=1$/);
    assert.equal(puts.at(-1), `${blurredKey}:pixelated-jpeg`);
    const afterBlur = await prisma.photoPoolItem.findUnique({ where: { id: created!.id } });
    assert.equal(afterBlur?.revision, 1);
    assert.equal(afterBlur?.spacesKey, blurredKey);
    assert.equal(afterBlur?.code, freshStem);

    const wrongType = await overwriteProjectPhotoBytes(
      project.id,
      freshStem,
      { buffer: Buffer.from("png-bytes"), mime: "image/png" },
      storage
    );
    assert.equal(wrongType.ok, false);
    assert.equal(puts.at(-1), `${blurredKey}:pixelated-jpeg`);

    const directSkip = await ingestProjectPhotos(
      project.id,
      [{ originalName: uploadName, buffer: Buffer.from("nope"), mime: "image/jpeg" }],
      storage
    );
    assert.deepEqual(directSkip.uploaded, []);
    assert.deepEqual(directSkip.skipped, [uploadName]);
    assert.equal(PHOTO_INGEST_MAX_BYTES, 50 * 1024 * 1024);
  });
});

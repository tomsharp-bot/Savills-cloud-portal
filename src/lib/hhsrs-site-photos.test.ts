import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import {
  deleteDraft,
  persistSubmissionPhotos,
  readDraft,
  saveIncomingPhotos,
  submissionDir,
  writeDraft,
  type HhsrsDraft,
  type HhsrsPhoto,
} from "./hhsrs-site-form.js";
import {
  copyLoggedCasePhotos,
  defaultHhsrsCopyDeps,
  type CopyAttempt,
  type HhsrsCaseSnapshot,
  type HhsrsCopyDeps,
  type NewCompletedPhoto,
} from "./hhsrs-completed-photos.js";
import { buildCasePhotoAttachments } from "./hhsrs-send-case.js";
import {
  HEIC_CONVERT_ERROR,
  HHSRS_SITE_PHOTO_STORAGE,
  PHOTOS_NOT_STORED,
  SITE_PHOTO_JPEG_QUALITY,
  SITE_PHOTO_MAX_EDGE,
  SITE_PHOTO_MAX_STORED_BYTES,
  loadSiteFormPhoto,
  prepareSitePhoto,
  privateInlineHeaders,
  readSiteFormPhotoBytes,
  type SitePhotoStorage,
} from "./hhsrs-site-photos.js";

const heicFixture = readFileSync(path.join(process.cwd(), "src/lib/fixtures/sample.heic"));

function memoryStorage() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const puts: string[] = [];
  let remainingFailures = 0;
  const storage: SitePhotoStorage = {
    async put(key, body, contentType) {
      puts.push(key);
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return false;
      }
      objects.set(key, { body: Buffer.from(body), contentType });
      return true;
    },
    async get(key) {
      const hit = objects.get(key);
      return hit ? Buffer.from(hit.body) : null;
    },
    async remove(key) {
      objects.delete(key);
      return true;
    },
  };
  return {
    objects,
    puts,
    storage,
    failNext(times: number) {
      remainingFailures = times;
    },
  };
}

function jpegBytes(marker: string): Buffer {
  const body = Buffer.from(marker);
  const buf = Buffer.alloc(64 + body.length);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  body.copy(buf, 32);
  return buf;
}

function draftFor(id: string, photos: HhsrsPhoto[]): HhsrsDraft {
  return {
    id,
    projectId: "hhsrs-demo-current",
    projectName: "Demo current project (local)",
    surveyDate: "2026-09-20",
    uprn: "100123",
    fullAddress: "1 High Street",
    postcode: "EX1 1AA",
    addressConfirmed: true,
    surveyorName: "Alex Surveyor",
    category: "Damp & Mould Growth",
    rating: "Severe",
    comment: "Visible mould in bathroom.",
    clientCallReference: "",
    otherDetails: "",
    cat1Confirmed: false,
    callUnreached: false,
    callRefBlankReason: "",
    callUnreachedNote: "",
    photos,
    createdAt: new Date().toISOString(),
  };
}

describe("HHSRS site-form photos in Spaces", () => {
  it("stores a JPEG, then reads it from Spaces after the local file is deleted", async () => {
    const box = memoryStorage();
    const draftId = randomUUID();
    const submissionId = randomUUID();
    const jpeg = jpegBytes("room-photo");
    try {
      const saved = await saveIncomingPhotos(draftId, [
        { originalname: "room.jpg", mimetype: "image/jpeg", size: jpeg.length, buffer: jpeg },
      ]);
      assert.equal(saved.length, 1);
      assert.match(saved[0].storedName, /\.jpg$/);
      const paths = await persistSubmissionPhotos(submissionId, draftFor(draftId, saved), box.storage, {
        delayMs: 0,
      });
      assert.equal(paths.length, 1);
      assert.equal(paths[0], `hhsrs-site-form/${submissionId}/${saved[0].storedName}`);
      assert.equal(box.objects.get(paths[0])?.contentType, "image/jpeg");
      assert.equal(box.puts.length, 1);

      await rm(submissionDir(submissionId), { recursive: true, force: true });
      const again = await readSiteFormPhotoBytes(paths[0], box.storage);
      assert.ok(again);
      assert.equal(again.toString("utf8", 32, 32 + "room-photo".length), "room-photo");
      const loaded = await loadSiteFormPhoto(paths[0], box.storage);
      assert.equal(loaded?.contentType, "image/jpeg");
      const headers = privateInlineHeaders(loaded!.fileName, loaded!.body.length, loaded!.contentType);
      assert.match(headers["Cache-Control"], /private/);
      assert.doesNotMatch(headers["Cache-Control"], /public/);
      assert.doesNotMatch(headers["Content-Disposition"], /https?:/i);
      assert.equal(JSON.stringify(headers).includes("digitaloceanspaces.com"), false);
    } finally {
      await rm(path.join(process.cwd(), "uploads", "hhsrs-site-form", "drafts", draftId), {
        recursive: true,
        force: true,
      });
      await rm(submissionDir(submissionId), { recursive: true, force: true });
    }
  });

  it("retries a failed Spaces upload and does not keep a broken reference", async () => {
    const box = memoryStorage();
    const draftId = randomUUID();
    const submissionId = randomUUID();
    const jpeg = jpegBytes("retry-me");
    try {
      const saved = await saveIncomingPhotos(draftId, [
        { originalname: "a.jpg", mimetype: "image/jpeg", size: jpeg.length, buffer: jpeg },
      ]);
      box.failNext(2);
      const paths = await persistSubmissionPhotos(submissionId, draftFor(draftId, saved), box.storage, {
        delayMs: 0,
      });
      assert.equal(paths.length, 1);
      assert.equal(box.puts.length, 3);
      assert.ok(box.objects.has(paths[0]));

      const broken = memoryStorage();
      broken.failNext(9);
      await assert.rejects(
        () => persistSubmissionPhotos(submissionId, draftFor(draftId, saved), broken.storage, { delayMs: 0 }),
        (err: unknown) => err instanceof Error && err.message === PHOTOS_NOT_STORED
      );
      assert.equal(broken.objects.size, 0);
      assert.equal(broken.puts.length, 3);
    } finally {
      await rm(path.join(process.cwd(), "uploads", "hhsrs-site-form", "drafts", draftId), {
        recursive: true,
        force: true,
      });
      await rm(submissionDir(submissionId), { recursive: true, force: true });
    }
  });

  it("builds email attachments from Spaces when the local file is gone", async () => {
    const box = memoryStorage();
    const submissionId = randomUUID();
    const name = "sample-photo-1.jpg";
    const key = `hhsrs-site-form/${submissionId}/${name}`;
    const jpeg = jpegBytes("email-bytes");
    await box.storage.put(key, jpeg, "image/jpeg");
    const built = await buildCasePhotoAttachments(submissionId, [name], box.storage);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.attachments.length, 1);
    assert.equal(built.attachments[0].filename, name);
    assert.equal(built.attachments[0].contentType, "image/jpeg");
    assert.deepEqual(built.attachments[0].content, jpeg);
  });

  it("copies a logged case from Spaces when the local file is gone", async () => {
    const box = memoryStorage();
    const submissionId = randomUUID();
    const name = "front.jpg";
    const source = `hhsrs-site-form/${submissionId}/${name}`;
    const jpeg = jpegBytes("completed-copy");
    await box.storage.put(source, jpeg, "image/jpeg");
    await rm(submissionDir(submissionId), { recursive: true, force: true });

    const fromSpaces = await defaultHhsrsCopyDeps(box.storage).readFile(source);
    assert.ok(fromSpaces);
    assert.deepEqual(fromSpaces, jpeg);

    const memory = {
      files: new Map<string, Buffer>(),
      photos: [] as NewCompletedPhoto[],
      attempts: [] as CopyAttempt[],
      puts: [] as Buffer[],
    };
    const snapshot: HhsrsCaseSnapshot = {
      id: submissionId,
      status: "email_sent",
      projectId: "proj-1",
      projectName: "Gateway 2026",
      linkedProjectName: "Gateway 2026",
      progressNames: ["Gateway 2026"],
      uprn: "44001",
      fullAddress: "12 High Street",
      postcode: "B1 1AA",
      photoPaths: [source],
    };
    const deps: HhsrsCopyDeps = {
      loadCase: async () => snapshot,
      listCopiedSources: async () => new Set<string>(),
      insertPhoto: async (row) => {
        memory.photos.push(row);
        return "inserted";
      },
      saveAttempt: async (attempt) => {
        memory.attempts.push(attempt);
      },
      readFile: (sourcePath) => defaultHhsrsCopyDeps(box.storage).readFile(sourcePath),
      putObject: async (_key, body) => {
        memory.puts.push(body);
        return true;
      },
    };
    const outcome = await copyLoggedCasePhotos(submissionId, deps);
    assert.equal(outcome.status, "copied");
    assert.equal(outcome.copiedCount, 1);
    assert.equal(outcome.failedCount, 0);
    assert.equal(memory.photos.length, 1);
    assert.deepEqual(memory.puts[0], jpeg);
  });

  it("converts HEIC to a JPEG no wider than 3000px", async () => {
    assert.equal(SITE_PHOTO_MAX_EDGE, 3000);
    assert.equal(SITE_PHOTO_JPEG_QUALITY, 88);
    assert.equal(SITE_PHOTO_MAX_STORED_BYTES, 25 * 1024 * 1024);
    const prepared = await prepareSitePhoto({
      originalName: "IMG_1234.HEIC",
      mime: "image/heic",
      buffer: heicFixture,
    });
    assert.equal(prepared.ext, "jpg");
    assert.equal(prepared.mime, "image/jpeg");
    assert.equal(prepared.buffer[0], 0xff);
    assert.equal(prepared.buffer[1], 0xd8);
    assert.ok(prepared.buffer.length < SITE_PHOTO_MAX_STORED_BYTES);
    const meta = await sharp(prepared.buffer).metadata();
    assert.equal(meta.width, 3000);
    assert.ok(meta.height && meta.height > 0 && meta.height <= 3000);

    const namedJpeg = jpegBytes("not-really-heic");
    const kept = await prepareSitePhoto({
      originalName: "IMG_1234.HEIC",
      mime: "image/heic",
      buffer: namedJpeg,
    });
    assert.equal(kept.ext, "jpg");
    assert.equal(kept.mime, "image/jpeg");
    assert.deepEqual(kept.buffer, namedJpeg);

    await assert.rejects(
      () => prepareSitePhoto({ originalName: "bad.heic", mime: "image/heic", buffer: Buffer.from("not-a-photo") }),
      (err: unknown) => err instanceof Error && err.message === HEIC_CONVERT_ERROR
    );
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
  opts: { cookie?: string; form?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body, redirect: "manual" });
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    body: raw.toString("utf8"),
    raw,
    location: res.headers.get("location") || "",
    contentType: res.headers.get("content-type") || "",
    cacheControl: res.headers.get("cache-control") || "",
    setCookie,
  };
}

describe("HHSRS site-form photo routes", () => {
  it("submits, then serves the photo from Spaces after the uploads folder is cleared", async (t) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      t.skip("Postgres is not available");
      return;
    }
    const project = await prisma.project.findFirst({ where: { name: "Test 1", stage: "current" } });
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!project || !admin) {
      t.skip("Seeded admin and Test 1 project are not available");
      return;
    }
    const box = memoryStorage();
    const draftId = randomUUID();
    const jpeg = jpegBytes("reporter-thumb");
    const saved = await saveIncomingPhotos(draftId, [
      { originalname: "bathroom.jpg", mimetype: "image/jpeg", size: jpeg.length, buffer: jpeg },
    ]);
    const draft = draftFor(draftId, saved);
    draft.projectId = project.id;
    draft.projectName = project.name;
    draft.uprn = "100040123456";
    draft.fullAddress = "12, Moor Cross, Bude";
    draft.postcode = "EX23 9EH";
    await writeDraft(draft);

    const app = createApp({ basePath: "" });
    app.set(HHSRS_SITE_PHOTO_STORAGE, box.storage);
    const { server, port } = await listen(app);
    t.after(() => server.close());
    let submissionId = "";
    try {
      const submitted = await request(port, "POST", "/HHSRS-site-form/submit", { form: { draftId } });
      assert.equal(submitted.status, 302);
      const id = new URL(submitted.location, "http://127.0.0.1").searchParams.get("id") || "";
      assert.ok(id);
      submissionId = id;
      const row = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id } });
      const paths = Array.isArray(row.photoPaths) ? row.photoPaths.map(String) : [];
      assert.equal(paths.length, 1);
      assert.match(paths[0], new RegExp(`^hhsrs-site-form/${id}/.+\.jpg$`));
      assert.equal(box.objects.has(paths[0]), true);

      await rm(submissionDir(id), { recursive: true, force: true });
      assert.equal(await readDraft(draftId), null);

      const anon = await request(port, "GET", `/HHSRSreporter/${id}/photos/${saved[0].storedName}`);
      assert.equal(anon.status, 302);
      assert.match(anon.location, /\/login/);

      const login = await request(port, "POST", "/login", {
        form: { username: "phil.m", password: "PhilMoon2468" },
      });
      const cookie = cookieHeader(login.setCookie);
      const review = await request(port, "GET", `/HHSRSreporter/review/${id}`, { cookie });
      assert.equal(review.status, 200);
      assert.match(review.body, new RegExp(`/HHSRSreporter/${id}/photos/`));

      const photo = await request(port, "GET", `/HHSRSreporter/${id}/photos/${saved[0].storedName}`, { cookie });
      assert.equal(photo.status, 200);
      assert.match(photo.contentType, /^image\/jpeg/);
      assert.match(photo.cacheControl, /private/);
      assert.doesNotMatch(photo.cacheControl, /public/);
      assert.equal(photo.body.includes("digitaloceanspaces.com"), false);
      assert.equal(photo.raw.subarray(32, 32 + "reporter-thumb".length).toString(), "reporter-thumb");

      const intake = await request(port, "GET", `/hhsrs-submissions/${id}/photos/${saved[0].storedName}`, { cookie });
      assert.equal(intake.status, 200);
      assert.match(intake.contentType, /^image\/jpeg/);
      assert.equal(intake.raw.subarray(32, 32 + "reporter-thumb".length).toString(), "reporter-thumb");
    } finally {
      if (submissionId) {
        await prisma.hhsrsSiteSubmission.delete({ where: { id: submissionId } }).catch(() => undefined);
      }
      await deleteDraft(draftId);
      if (submissionId) await rm(submissionDir(submissionId), { recursive: true, force: true });
    }
  });

  it("does not save the issue when Spaces rejects the photo", async (t) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      t.skip("Postgres is not available");
      return;
    }
    const project = await prisma.project.findFirst({ where: { name: "Test 1", stage: "current" } });
    if (!project) {
      t.skip("Seeded Test 1 project is not available");
      return;
    }
    const box = memoryStorage();
    box.failNext(5);
    const draftId = randomUUID();
    const jpeg = jpegBytes("will-fail");
    const marker = `spaces-fail-${draftId.slice(0, 8)}`;
    const saved = await saveIncomingPhotos(draftId, [
      { originalname: "room.jpg", mimetype: "image/jpeg", size: jpeg.length, buffer: jpeg },
    ]);
    const draft = draftFor(draftId, saved);
    draft.projectId = project.id;
    draft.projectName = project.name;
    draft.uprn = "100040123456";
    draft.comment = marker;
    await writeDraft(draft);
    const app = createApp({ basePath: "" });
    app.set(HHSRS_SITE_PHOTO_STORAGE, box.storage);
    const { server, port } = await listen(app);
    t.after(() => server.close());
    try {
      const submitted = await request(port, "POST", "/HHSRS-site-form/submit", { form: { draftId } });
      assert.equal(submitted.status, 200);
      assert.match(submitted.body, new RegExp(PHOTOS_NOT_STORED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(submitted.location, /thanks/);
      const leftover = await prisma.hhsrsSiteSubmission.findFirst({ where: { comment: marker } });
      assert.equal(leftover, null);
      assert.equal(box.objects.size, 0);
      const still = await readDraft(draftId);
      assert.ok(still);
      assert.equal(still.photos.length, 1);
    } finally {
      await prisma.hhsrsSiteSubmission.deleteMany({ where: { comment: marker } }).catch(() => undefined);
      await deleteDraft(draftId);
    }
  });
});

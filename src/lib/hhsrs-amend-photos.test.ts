process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Express } from "express";
import { createApp } from "../app.js";
import { HHSRS_AMEND_TRANSPORT } from "../routes/hhsrs-reporter.js";
import { prisma } from "./prisma.js";
import { sendCaseEmail } from "./hhsrs-send-case.js";
import type { OutboundEmail } from "./hhsrs-send.js";
import {
  appendCasePhotos,
  replacementPhotoName,
  submissionDir,
} from "./hhsrs-site-form.js";
import { HHSRS_SITE_PHOTO_STORAGE, PHOTOS_NOT_STORED, type SitePhotoStorage } from "./hhsrs-site-photos.js";

const PREVIOUS_BODY = [
  "Hi all,",
  "",
  "• Address: 1 Amend Street",
  "• UPRN: 1001",
  "• Hazard: Damp & Mould Growth",
  "• Rating: Low",
  "• Site notes: Mould around the window",
  "• Survey date: 2026-09-28",
].join("\n");

function jpegBytes(marker: string): Buffer {
  const body = Buffer.from(marker);
  const buf = Buffer.alloc(64 + body.length);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  body.copy(buf, 32);
  return buf;
}

function memoryStorage() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  let remainingFailures = 0;
  const storage: SitePhotoStorage = {
    async put(key, body, contentType) {
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
    storage,
    failNext(times: number) {
      remainingFailures = times;
    },
  };
}

function multipart(fields: Record<string, string | string[]>, files: { name: string; filename: string; type: string; body: Buffer }[]) {
  const boundary = "----amend-photo";
  const chunks: Buffer[] = [];
  const push = (value: string) => chunks.push(Buffer.from(value));
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${item}\r\n`);
    }
  }
  for (const file of files) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`
    );
    chunks.push(file.body);
    push("\r\n");
  }
  push(`--${boundary}--\r\n`);
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

type Hit = { status: number; location: string; body: string; setCookie: string[] };

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
      const req = http.request({ host: "127.0.0.1", port, path: url, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          server.close();
          resolve({
            status: res.statusCode || 0,
            location: String(res.headers.location || ""),
            body: Buffer.concat(chunks).toString("utf8"),
            setCookie: ([] as string[]).concat(res.headers["set-cookie"] || []),
          });
        });
      });
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end(payload);
    });
  });
}

function cookieHeader(setCookie: string[]): string {
  return setCookie.map((item) => item.split(";")[0]).filter(Boolean).join("; ");
}

async function dbReady(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

describe("amend photo replacement", () => {
  it("keeps a readable name and does not collide with a photo already on the case", () => {
    const taken = new Set(["keep.jpg"]);
    assert.equal(replacementPhotoName("Kitchen window.jpg", "jpg", taken), "Kitchen-window.jpg");
    assert.equal(replacementPhotoName("keep.jpg", "jpg", taken), "keep-2.jpg");
    assert.equal(taken.has("Kitchen-window.jpg"), true);
    assert.equal(taken.has("keep-2.jpg"), true);
  });

  it("stores a replacement beside the existing photo and removes only the new file if the upload fails", async () => {
    const id = randomUUID();
    const dir = submissionDir(id);
    const box = memoryStorage();
    const existing = jpegBytes("already-on-the-case");
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "already-there.jpg"), existing);
      const added = await appendCasePhotos(
        id,
        [{ originalname: "Kitchen window.jpg", mimetype: "image/jpeg", buffer: jpegBytes("replacement") }],
        ["already-there.jpg"],
        box.storage,
        { delayMs: 0 }
      );
      assert.equal(added.length, 1);
      assert.match(added[0], /Kitchen-window\.jpg$/);
      assert.deepEqual(await readFile(path.join(dir, "already-there.jpg")), existing);
      assert.equal(box.objects.has(added[0]), true);

      const broken = memoryStorage();
      broken.failNext(9);
      await assert.rejects(
        () =>
          appendCasePhotos(
            id,
            [{ originalname: "second.jpg", mimetype: "image/jpeg", buffer: jpegBytes("nope") }],
            ["already-there.jpg", "Kitchen-window.jpg"],
            broken.storage,
            { delayMs: 0 }
          ),
        (err: unknown) => err instanceof Error && err.message === PHOTOS_NOT_STORED
      );
      assert.deepEqual(await readFile(path.join(dir, "already-there.jpg")), existing);
      assert.equal(broken.objects.size, 0);
      await assert.rejects(() => readFile(path.join(dir, "second.jpg")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("attaches the replacement, drops a removed photo, and will not send until the photo box is ticked", async (t) => {
    if (!(await dbReady())) {
      t.skip("Postgres is not available");
      return;
    }
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const box = memoryStorage();
    const keepJpeg = jpegBytes("keep-photo");
    const wrongJpeg = jpegBytes("wrong-photo");
    const replacement = jpegBytes("replacement-photo");
    const previousPassword = process.env.HHSRS_SMTP_PASSWORD;
    process.env.HHSRS_SMTP_PASSWORD = "test-only-not-a-real-password";
    const ids: string[] = [];
    t.after(async () => {
      if (ids.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: ids } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: ids } } });
        await Promise.all(ids.map((id) => rm(submissionDir(id), { recursive: true, force: true })));
      }
      if (previousPassword === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = previousPassword;
    });

    const row = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: "Test Housing",
        surveyDate: "2026-09-28",
        uprn: `amend-${stamp}`,
        fullAddress: "1 Amend Street",
        postcode: "B1 1AA",
        surveyorName: "Tom Sharp",
        category: "Damp & Mould Growth",
        rating: "Low",
        comment: "Mould around the window",
        photoPaths: [],
        status: "email_sent",
        emailSentAt: new Date("2026-09-28T10:00:00.000Z"),
        emailSentBy: "Tom Sharp",
        emailSubject: "Test Housing - HHSRS – 1 Amend Street",
        emailBody: PREVIOUS_BODY,
      },
    });
    ids.push(row.id);
    const keepKey = `hhsrs-site-form/${row.id}/keep.jpg`;
    const wrongKey = `hhsrs-site-form/${row.id}/wrong.jpg`;
    await box.storage.put(keepKey, keepJpeg, "image/jpeg");
    await box.storage.put(wrongKey, wrongJpeg, "image/jpeg");
    await prisma.hhsrsSiteSubmission.update({
      where: { id: row.id },
      data: { photoPaths: [keepKey, wrongKey] },
    });
    await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: row.id,
        sentAt: new Date("2026-09-28T10:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "Test Housing - HHSRS – 1 Amend Street",
        body: PREVIOUS_BODY,
        photoNames: ["keep.jpg", "wrong.jpg"],
        sentCopySaved: true,
        kind: "original",
      },
    });

    const base = {
      amendmentFields: "1",
      photoSelection: "1",
      to: "repairs@savillshousing.co.uk",
      address: "1 Amend Street",
      uprn: `amend-${stamp}`,
      hazard: "Damp & Mould Growth",
      rating: "Low",
      notes: "Mould around the window",
      surveyDate: "2026-09-28",
      amendment: "Wrong photo.",
      checked: "1",
    };
    const stored = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: row.id } });
    const blocked = await sendCaseEmail({
      row: stored,
      sentBy: "Tom Sharp",
      hasReporterAccess: true,
      body: { ...base, photo: ["keep.jpg"] },
      storage: box.storage,
      correction: { reason: "", note: "" },
      transport: {
        sendMail: async () => {
          throw new Error("must not send");
        },
        appendToSent: async () => undefined,
      },
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error, "Tick the box to confirm the photo is correct.");
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: row.id } }), 1);

    const added = await appendCasePhotos(
      row.id,
      [{ originalname: "Kitchen window.jpg", mimetype: "image/jpeg", buffer: replacement }],
      [keepKey, wrongKey],
      box.storage,
      { delayMs: 0 }
    );
    const addedName = added[0].split("/").pop() || "";
    const withReplacement = await prisma.hhsrsSiteSubmission.update({
      where: { id: row.id },
      data: { photoPaths: [keepKey, wrongKey, ...added] },
    });
    const sent: OutboundEmail[] = [];
    const result = await sendCaseEmail({
      row: withReplacement,
      sentBy: "Tom Sharp",
      hasReporterAccess: true,
      body: { ...base, photosChecked: "1", photo: ["keep.jpg", addedName] },
      storage: box.storage,
      correction: { reason: "", note: "" },
      transport: {
        sendMail: async (mail) => {
          sent.push(mail);
          return { messageId: "<amend-photo@savillshousing.co.uk>", raw: Buffer.from("raw") };
        },
        appendToSent: async () => undefined,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["repairs@savillshousing.co.uk"]);
    assert.deepEqual(
      sent[0].attachments.map((file) => file.filename),
      ["keep.jpg", addedName]
    );
    assert.equal(sent[0].attachments.some((file) => file.filename === "wrong.jpg"), false);
    assert.deepEqual(sent[0].attachments[1].content, replacement);
    const unchanged = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(unchanged.fullAddress, "1 Amend Street");
    assert.equal(unchanged.uprn, `amend-${stamp}`);
    assert.equal(unchanged.category, "Damp & Mould Growth");
    assert.equal(unchanged.rating, "Low");
    assert.equal(unchanged.comment, "Mould around the window");
    assert.equal(unchanged.surveyDate, "2026-09-28");
    const logged = await prisma.hhsrsSentEmail.findFirstOrThrow({
      where: { submissionId: row.id, kind: "correction" },
    });
    assert.deepEqual(logged.photoNames, ["keep.jpg", addedName]);

    const cleared = await sendCaseEmail({
      row: unchanged,
      sentBy: "Tom Sharp",
      hasReporterAccess: true,
      body: { ...base, photosChecked: "1", photo: "" },
      storage: box.storage,
      correction: { reason: "", note: "" },
      transport: {
        sendMail: async (mail) => {
          sent.push(mail);
          return { messageId: "<amend-none@savillshousing.co.uk>", raw: Buffer.from("raw") };
        },
        appendToSent: async () => undefined,
      },
    });
    assert.equal(cleared.ok, true);
    assert.equal(sent[1].attachments.length, 0);
  });

  it("serves remove and upload on Amend only, and the correction attaches the replacement", async (t) => {
    if (!(await dbReady())) {
      t.skip("Postgres is not available");
      return;
    }
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const box = memoryStorage();
    const keepJpeg = jpegBytes("keep-http");
    const wrongJpeg = jpegBytes("wrong-http");
    const replacement = jpegBytes("replacement-http");
    const previousPassword = process.env.HHSRS_SMTP_PASSWORD;
    process.env.HHSRS_SMTP_PASSWORD = "test-only-not-a-real-password";
    const ids: string[] = [];
    t.after(async () => {
      if (ids.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: ids } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: ids } } });
        await Promise.all(ids.map((id) => rm(submissionDir(id), { recursive: true, force: true })));
      }
      if (previousPassword === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = previousPassword;
    });

    const row = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: "Test Housing",
        surveyDate: "2026-09-28",
        uprn: `amend-http-${stamp}`,
        fullAddress: "1 Amend Street",
        postcode: "B1 1AA",
        surveyorName: "Tom Sharp",
        category: "Damp & Mould Growth",
        rating: "Low",
        comment: "Mould around the window",
        photoPaths: [],
        status: "email_sent",
        emailSentAt: new Date("2026-09-28T10:00:00.000Z"),
        emailSentBy: "Tom Sharp",
        emailSubject: "Test Housing - HHSRS – 1 Amend Street",
        emailBody: PREVIOUS_BODY,
      },
    });
    ids.push(row.id);
    const keepKey = `hhsrs-site-form/${row.id}/keep.jpg`;
    const wrongKey = `hhsrs-site-form/${row.id}/wrong.jpg`;
    await box.storage.put(keepKey, keepJpeg, "image/jpeg");
    await box.storage.put(wrongKey, wrongJpeg, "image/jpeg");
    await prisma.hhsrsSiteSubmission.update({
      where: { id: row.id },
      data: { photoPaths: [keepKey, wrongKey] },
    });
    await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: row.id,
        sentAt: new Date("2026-09-28T10:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "Test Housing - HHSRS – 1 Amend Street",
        body: PREVIOUS_BODY,
        photoNames: ["keep.jpg", "wrong.jpg"],
        sentCopySaved: true,
        kind: "original",
      },
    });

    const sent: OutboundEmail[] = [];
    const app = createApp({ basePath: "" });
    app.set(HHSRS_SITE_PHOTO_STORAGE, box.storage);
    app.set(HHSRS_AMEND_TRANSPORT, {
      sendMail: async (mail: OutboundEmail) => {
        sent.push(mail);
        return { messageId: "<amend-http@savillshousing.co.uk>", raw: Buffer.from("raw") };
      },
      appendToSent: async () => undefined,
    });
    const login = await request(app, "POST", "/login", {
      body: "username=phil.m&password=PhilMoon2468",
    });
    if (login.status !== 302) {
      t.skip("Seeded admin login is not available");
      return;
    }
    const cookie = cookieHeader(login.setCookie);

    const page = await request(app, "GET", `/HHSRSreporter/find?case=${row.id}&view=amend`, { cookie });
    assert.equal(page.status, 200);
    assert.match(page.body, /id="fr-photo-drop"/);
    assert.match(page.body, /I've checked the photo is correct/);
    assert.match(page.body, /name="photo" value="keep\.jpg"/);
    assert.match(page.body, /name="photo" value="wrong\.jpg"/);
    assert.match(page.body, /id="f-address"[^>]*value="1 Amend Street"/);
    assert.match(page.body, /hhsrs@savillshousing\.co\.uk/);
    assert.match(page.body, /repairs@savillshousing\.co\.uk/);
    const form = readFileSync("views/hhsrs-site-form/form.ejs", "utf8");
    const main = readFileSync("views/hhsrs-reporter/main-log.ejs", "utf8");
    const duplicates = readFileSync("views/hhsrs-reporter/duplicates.ejs", "utf8");
    assert.doesNotMatch(form, /fr-photo-drop/);
    assert.doesNotMatch(main, /fr-photo-drop/);
    assert.doesNotMatch(duplicates, /fr-photo-drop/);

    const fields = {
      amendmentFields: "1",
      photoSelection: "1",
      to: "repairs@savillshousing.co.uk",
      cc: "",
      bcc: "",
      address: "1 Amend Street",
      uprn: `amend-http-${stamp}`,
      hazard: "Damp & Mould Growth",
      rating: "Low",
      notes: "Mould around the window",
      surveyDate: "2026-09-28",
      amendment: "Wrong photo.",
      checked: "1",
    };
    const refused = multipart({ ...fields, photo: "keep.jpg" }, []);
    const blocked = await request(app, "POST", `/HHSRSreporter/find/${row.id}/resend`, {
      cookie,
      body: refused.body,
      contentType: refused.contentType,
    });
    assert.equal(blocked.status, 302);
    assert.equal(sent.length, 0);
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { submissionId: row.id } }), 1);
    const blockedCookie = blocked.setCookie.length ? cookieHeader(blocked.setCookie) : cookie;
    const blockedPage = await request(app, "GET", blocked.location, { cookie: blockedCookie });
    assert.match(blockedPage.body, /Tick the box to confirm the photo is correct/);

    const posted = multipart(
      { ...fields, photosChecked: "1", checked: "1", photo: "keep.jpg" },
      [{ name: "replacement", filename: "Kitchen window.jpg", type: "image/jpeg", body: replacement }]
    );
    const ok = await request(app, "POST", `/HHSRSreporter/find/${row.id}/resend`, {
      cookie,
      body: posted.body,
      contentType: posted.contentType,
    });
    assert.equal(ok.status, 302, ok.body.slice(0, 300));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["repairs@savillshousing.co.uk"]);
    assert.equal(sent[0].attachments.some((file) => file.filename === "wrong.jpg"), false);
    assert.equal(sent[0].attachments.some((file) => file.filename === "keep.jpg"), true);
    const attached = sent[0].attachments.find((file) => file.filename !== "keep.jpg");
    assert.ok(attached);
    assert.deepEqual(attached.content, replacement);
    const after = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.fullAddress, "1 Amend Street");
    assert.equal(after.uprn, `amend-http-${stamp}`);
    assert.equal(after.category, "Damp & Mould Growth");
    assert.equal(after.rating, "Low");
    assert.equal(after.comment, "Mould around the window");
    assert.equal(after.surveyDate, "2026-09-28");
    const correction = await prisma.hhsrsSentEmail.findFirstOrThrow({
      where: { submissionId: row.id, kind: "correction" },
    });
    assert.deepEqual(correction.photoNames, sent[0].attachments.map((file) => file.filename));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import { HHSRS_PHOTO_COPY } from "../routes/hhsrs-reporter.js";
import { accentClassForName } from "./photos.js";
import {
  HHSRS_COMPLETED_PREFIX,
  compareUprn,
  completedProjectName,
  completedTileAccent,
  contentTypeForPhotoName,
  copyLoggedHhsrsPhotos,
  defaultHhsrsCopyDeps,
  displayAddress,
  fileNameFromSource,
  hhsrsCompletedObjectKey,
  hhsrsDiskPath,
  mergePhotoSearchHits,
  photoMatchesQuery,
  shortAddressLabel,
  type CopyAttempt,
  type HhsrsCaseSnapshot,
  type HhsrsCopyDeps,
  type NewCompletedPhoto,
  type PhotoSearchHit,
} from "./hhsrs-completed-photos.js";

const root = process.cwd();

function hit(partial: Partial<PhotoSearchHit> & Pick<PhotoSearchHit, "id" | "kind" | "uprn">): PhotoSearchHit {
  return {
    projectName: partial.projectName || "Gateway 2026",
    address: partial.address || "",
    title: partial.title || partial.uprn,
    location: partial.location || (partial.kind === "hhsrs" ? HHSRS_COMPLETED_PREFIX : "Photos Pool"),
    thumbUrl: partial.thumbUrl || "/thumb",
    imageUrl: partial.imageUrl || "/image",
    ...partial,
  };
}

type Memory = {
  files: Map<string, Buffer>;
  photos: NewCompletedPhoto[];
  attempts: CopyAttempt[];
  puts: Array<{ key: string; body: Buffer; contentType: string; metadata: Record<string, string> }>;
  put: (key: string) => Promise<boolean> | boolean;
};

function memoryDeps(snapshot: HhsrsCaseSnapshot, memory: Memory): HhsrsCopyDeps {
  return {
    loadCase: async () => snapshot,
    listCopiedSources: async (submissionId) =>
      new Set(memory.photos.filter((row) => row.submissionId === submissionId).map((row) => row.sourcePath)),
    insertPhoto: async (row) => {
      const exists = memory.photos.some(
        (item) => item.submissionId === row.submissionId && item.sourcePath === row.sourcePath
      );
      if (exists) return "duplicate";
      memory.photos.push(row);
      return "inserted";
    },
    saveAttempt: async (attempt) => {
      memory.attempts.push(attempt);
    },
    readFile: async (sourcePath) => memory.files.get(sourcePath) || null,
    putObject: async (key, body, contentType, metadata) => {
      memory.puts.push({ key, body, contentType, metadata });
      return memory.put(key);
    },
  };
}

function loggedCase(overrides: Partial<HhsrsCaseSnapshot> = {}): HhsrsCaseSnapshot {
  return {
    id: "case-1",
    status: "email_sent",
    projectId: "proj-1",
    projectName: "Gateway 2026",
    linkedProjectName: "Gateway 2026",
    progressNames: ["Gateway 2026", "Onward"],
    uprn: "44001",
    fullAddress: "12 High Street",
    postcode: "B1 1AA",
    photoPaths: ["hhsrs-site-form/case-1/front.jpg", "hhsrs-site-form/case-1/rear.jpg"],
    ...overrides,
  };
}

describe("HHSRS completed photo keys", () => {
  it("uses Project Progress name, UPRN, short address, and file name", () => {
    const name = completedProjectName({
      storedName: "Gateway 2026 damp and mould HHSRS",
      linkedProjectName: "Gateway 2026",
    });
    assert.equal(name, "Gateway 2026");
    assert.doesNotMatch(name, /damp|mould|hhsrs/i);
    const key = hhsrsCompletedObjectKey({
      projectName: name,
      uprn: "44001",
      shortAddress: shortAddressLabel("12 High Street", "B1 1AA"),
      fileName: fileNameFromSource("hhsrs-site-form/case-1/front.jpg"),
    });
    assert.equal(key, "HHSRS - Completed/Gateway 2026/44001 - 12 High Street, B1 1AA/front.jpg");
    assert.equal(key.split("/")[1], "Gateway 2026");
    assert.equal(contentTypeForPhotoName("front.jpg"), "image/jpeg");
  });

  it("keeps a slash in the address inside one folder segment", () => {
    const key = hhsrsCompletedObjectKey({
      projectName: "Onward 2026",
      uprn: "55",
      shortAddress: "Flat 1/2, High Street",
      fileName: "a.png",
    });
    assert.equal(key.split("/").length, 4);
    assert.equal(key, "HHSRS - Completed/Onward 2026/55 - Flat 1-2, High Street/a.png");
  });

  it("maps a roster name back to the live Project Progress name", () => {
    assert.equal(
      completedProjectName({
        storedName: "MTVH Pilot 2026",
        linkedProjectName: null,
        progressNames: ["MTVH", "Gateway 2026"],
      }),
      "MTVH"
    );
    assert.equal(
      completedProjectName({
        storedName: "Onward 2026",
        linkedProjectName: "Onward 2026",
        progressNames: ["Onward"],
      }),
      "Onward 2026"
    );
  });

  it("shortens a long address and still keeps the postcode when it fits", () => {
    const line = displayAddress("1 Quay Lane", "PL1 2AA");
    assert.equal(line, "1 Quay Lane, PL1 2AA");
    const long = shortAddressLabel("a".repeat(120), "ZZ1 1ZZ");
    assert.ok(long.length <= 80);
    assert.equal(hhsrsDiskPath("../secrets.txt", "uploads"), null);
    assert.equal(hhsrsDiskPath("hhsrs-site-form/abc/a.jpg", "uploads")?.endsWith("hhsrs-site-form/abc/a.jpg"), true);
  });

  it("uses the same accent as the current project tile when the project id matches", () => {
    const current = [{ id: "p1", name: "Onward", projectManager: "Tom Sharp" }];
    const linked = completedTileAccent("Onward 2026", ["p1"], current);
    assert.equal(linked.accent, accentClassForName("Onward"));
    assert.equal(linked.leadFirst, "Tom");
    const other = completedTileAccent("Gateway 2026", [], current);
    assert.equal(other.accent, accentClassForName("Gateway 2026"));
    assert.equal(other.leadFirst, "—");
  });
});

describe("copy on Log", () => {
  it("copies each photo once, keeps the disk original, and stores the address", async () => {
    const memory: Memory = {
      files: new Map([
        ["hhsrs-site-form/case-1/front.jpg", Buffer.from("front")],
        ["hhsrs-site-form/case-1/rear.jpg", Buffer.from("rear")],
      ]),
      photos: [],
      attempts: [],
      puts: [],
      put: async () => true,
    };
    const outcome = await copyLoggedHhsrsPhotos("case-1", memoryDeps(loggedCase(), memory));
    assert.equal(outcome.status, "copied");
    assert.equal(outcome.copiedCount, 2);
    assert.equal(outcome.failedCount, 0);
    assert.equal(memory.puts.length, 2);
    assert.equal(memory.photos.length, 2);
    assert.equal(memory.files.size, 2);
    assert.equal(memory.puts[0].key, "HHSRS - Completed/Gateway 2026/44001 - 12 High Street, B1 1AA/front.jpg");
    assert.equal(memory.puts[0].metadata.address, "12 High Street, B1 1AA");
    assert.equal(memory.puts[0].metadata.project, "Gateway 2026");
    assert.equal(memory.photos[0].addressLine, "12 High Street, B1 1AA");
    assert.equal(memory.attempts[memory.attempts.length - 1].status, "copied");

    const again = await copyLoggedHhsrsPhotos("case-1", memoryDeps(loggedCase(), memory));
    assert.equal(again.status, "copied");
    assert.equal(memory.puts.length, 2);
    assert.equal(memory.photos.length, 2);
  });

  it("records a Spaces failure and still leaves the case able to retry without duplicates", async () => {
    const memory: Memory = {
      files: new Map([
        ["hhsrs-site-form/case-1/front.jpg", Buffer.from("front")],
        ["hhsrs-site-form/case-1/rear.jpg", Buffer.from("rear")],
      ]),
      photos: [],
      attempts: [],
      puts: [],
      put: async (key) => !key.endsWith("/rear.jpg"),
    };
    const failed = await copyLoggedHhsrsPhotos("case-1", memoryDeps(loggedCase(), memory));
    assert.equal(failed.status, "failed");
    assert.equal(failed.copiedCount, 1);
    assert.equal(failed.failedCount, 1);
    assert.match(failed.error, /Storage failed: rear.jpg/);
    assert.equal(memory.photos.length, 1);
    assert.equal(memory.files.size, 2);

    memory.put = async () => true;
    const retried = await copyLoggedHhsrsPhotos("case-1", memoryDeps(loggedCase(), memory));
    assert.equal(retried.status, "copied");
    assert.equal(retried.copiedCount, 2);
    assert.equal(memory.photos.length, 2);
    assert.equal(memory.puts.length, 3);
    assert.deepEqual(
      memory.photos.map((row) => row.fileName).sort(),
      ["front.jpg", "rear.jpg"]
    );
  });

  it("does not throw when Spaces throws, and does not copy a case that is not logged", async () => {
    const memory: Memory = {
      files: new Map([["hhsrs-site-form/case-1/front.jpg", Buffer.from("front")]]),
      photos: [],
      attempts: [],
      puts: [],
      put: async () => {
        throw new Error("network down");
      },
    };
    const thrown = await copyLoggedHhsrsPhotos(
      "case-1",
      memoryDeps(loggedCase({ photoPaths: ["hhsrs-site-form/case-1/front.jpg"] }), memory)
    );
    assert.equal(thrown.status, "failed");
    assert.match(thrown.error, /network down/);
    assert.equal(memory.photos.length, 0);

    const waiting: Memory = { ...memory, photos: [], attempts: [], puts: [] };
    const skipped = await copyLoggedHhsrsPhotos(
      "case-1",
      memoryDeps(loggedCase({ status: "in_review" }), waiting)
    );
    assert.equal(skipped.status, "skipped");
    assert.equal(waiting.puts.length, 0);
    assert.equal(waiting.attempts.length, 0);
  });
});

describe("photo storage search", () => {
  it("matches UPRN or address and ignores other rows", () => {
    assert.equal(photoMatchesQuery("44001", { uprn: "44001", address: "12 High Street" }), true);
    assert.equal(photoMatchesQuery("high street", { uprn: "44001", address: "12 High Street, B1 1AA" }), true);
    assert.equal(photoMatchesQuery("44001", { uprn: "44002", address: "2 Quay Lane" }), false);
    assert.equal(photoMatchesQuery("   ", { uprn: "44001" }), false);
  });

  it("sorts pool and HHSRS hits together in numerical UPRN order", () => {
    assert.ok(compareUprn("9", "10") < 0);
    assert.ok(compareUprn("10", "100") < 0);
    assert.ok(compareUprn("100", "99") > 0);
    const merged = mergePhotoSearchHits([
      hit({ id: "p-100", kind: "pool", uprn: "100", title: "100-Kitchen-1.jpg", location: "Photos Pool" }),
      hit({ id: "h-9", kind: "hhsrs", uprn: "9", title: "front.jpg", projectName: "MTVH 2026" }),
      hit({ id: "p-10", kind: "pool", uprn: "10", title: "10-Hall-1.jpg" }),
      hit({ id: "h-9", kind: "hhsrs", uprn: "9", title: "front.jpg" }),
    ]);
    assert.deepEqual(
      merged.hits.map((row) => `${row.kind}:${row.uprn}`),
      ["hhsrs:9", "pool:10", "pool:100"]
    );
    assert.equal(merged.truncated, false);
    assert.equal(merged.hits[0].location, HHSRS_COMPLETED_PREFIX);
    assert.equal(merged.hits[1].location, "Photos Pool");
  });
});

describe("HHSRS completed photo pages", () => {
  it("keeps the current project tiles and adds the completed section and find bar", () => {
    const page = readFileSync(path.join(root, "views/photos.ejs"), "utf8");
    assert.match(page, /Find by UPRN or address/);
    assert.match(page, /<h2>Current projects<\/h2>/);
    assert.match(page, /Photos Pool: <%= t\.poolCount %>/);
    assert.match(page, /Photo Folders: <%= t\.folderCount %>/);
    assert.match(page, /<h2>HHSRS - Completed<\/h2>/);
    assert.match(page, /find-results-strip/);
    assert.match(page, /Properties: <%= t\.propertyCount %>/);
    const project = readFileSync(path.join(root, "views/photos-hhsrs-project.ejs"), "utf8");
    assert.match(project, /Numerical UPRN|numerical UPRN/);
    assert.match(project, />UPRN</);
    assert.match(project, />Address</);
    const property = readFileSync(path.join(root, "views/photos-hhsrs-property.ejs"), "utf8");
    assert.match(property, /data-photo-open/);
    const reporter = readFileSync(path.join(root, "src/routes/hhsrs-reporter.ts"), "utf8");
    const loggedAt = reporter.indexOf('status: "email_sent"');
    const copyAt = reporter.indexOf("archiveLoggedPhotos");
    assert.ok(loggedAt > 0 && copyAt > loggedAt);
    assert.match(reporter, /Marked as actioned\. Case moved to Main Log\. Attach photos in Outlook before you send\./);
    const script = readFileSync(path.join(root, "scripts/backfill-hhsrs-completed-photos.ts"), "utf8");
    assert.match(script, /--backfill/);
    assert.match(script, /Nothing was copied/);
    const index = readFileSync(path.join(root, "src/index.ts"), "utf8");
    assert.doesNotMatch(index, /backfill-hhsrs/);
    const siteForm = readFileSync(path.join(root, "src/routes/hhsrs-site-form.ts"), "utf8");
    assert.doesNotMatch(siteForm, /hhsrs-completed-photos/);
    const admin = readFileSync(path.join(root, "src/routes/admin.ts"), "utf8");
    assert.doesNotMatch(admin, /hhsrs-completed-photos/);
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
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get("location") || "",
    setCookie,
  };
}

describe("HHSRS completed photos with the database", () => {
  it("logs the case when Spaces fails, retries without a duplicate, and search finds both stores", async (t) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.$queryRaw`SELECT 1 FROM "HhsrsCompletedPhoto" LIMIT 1`;
    } catch {
      t.skip("Postgres with the HHSRS completed photo tables is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    const project = await prisma.project.findFirst({ where: { name: "Test 1", stage: "current" } });
    if (!admin || !project) {
      t.skip("Seeded admin and Test 1 project are not available");
      return;
    }

    const uprn = `9${Date.now()}`;
    const address = `99 Copy Lane ${uprn}`;
    const row = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectId: project.id,
        projectName: project.name,
        surveyDate: "2026-09-25",
        uprn,
        fullAddress: address,
        postcode: "BS1 1AA",
        surveyorName: "Alex Surveyor",
        category: "Electrical Hazards",
        rating: "High",
        comment: "copy test",
        photoPaths: [],
        status: "in_review",
      },
    });
    const sourcePath = `hhsrs-site-form/${row.id}/front.jpg`;
    const diskPath = path.join(process.cwd(), "uploads", sourcePath);
    const pool = await prisma.photoPoolItem.create({
      data: {
        projectId: project.id,
        code: `${uprn}-Kitchen-1`,
        fileName: `${uprn}-Kitchen-1.jpg`,
        spacesKey: "",
      },
    });
    const asset = await prisma.asset.create({
      data: {
        projectId: project.id,
        kind: "dwelling",
        uprn,
        number: "99",
        street: "Copy Lane",
        city: "Bristol",
        postcode: "BS1 1AA",
      },
    });

    const app = createApp({ basePath: "" });
    const { server, port } = await listen(app);
    t.after(() => server.close());

    try {
      await mkdir(path.dirname(diskPath), { recursive: true });
      await writeFile(diskPath, Buffer.from("jpeg-bytes"));
      await prisma.hhsrsSiteSubmission.update({
        where: { id: row.id },
        data: { photoPaths: [sourcePath] },
      });
      const fresh = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: row.id } });

      const login = await request(port, "POST", "/login", {
        form: { username: "phil.m", password: "PhilMoon2468" },
      });
      assert.equal(login.status, 302);
      const cookie = cookieHeader(login.setCookie);

      const logged = await request(port, "POST", `/HHSRSreporter/review/${row.id}/mark-actioned`, {
        cookie,
        form: { expectedUpdatedAt: fresh.updatedAt.toISOString() },
      });
      assert.equal(logged.status, 302);
      assert.match(logged.location, /\/HHSRSreporter\/main-log$/);
      const after = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(after.status, "email_sent");
      assert.equal(readFileSync(diskPath).toString(), "jpeg-bytes");
      const failed = await prisma.hhsrsPhotoCopy.findUniqueOrThrow({ where: { submissionId: row.id } });
      assert.equal(failed.status, "failed");
      assert.equal(await prisma.hhsrsCompletedPhoto.count({ where: { submissionId: row.id } }), 0);

      const deps = defaultHhsrsCopyDeps();
      const puts: string[] = [];
      deps.putObject = async (key, body) => {
        puts.push(key);
        assert.equal(body.toString(), "jpeg-bytes");
        return true;
      };
      const copied = await copyLoggedHhsrsPhotos(row.id, deps);
      assert.equal(copied.status, "copied");
      assert.equal(copied.copiedCount, 1);
      assert.equal(puts.length, 1);
      assert.equal(
        puts[0],
        hhsrsCompletedObjectKey({
          projectName: project.name,
          uprn,
          shortAddress: shortAddressLabel(address, "BS1 1AA"),
          fileName: "front.jpg",
        })
      );
      const again = await copyLoggedHhsrsPhotos(row.id, deps);
      assert.equal(again.status, "copied");
      assert.equal(puts.length, 1);
      assert.equal(await prisma.hhsrsCompletedPhoto.count({ where: { submissionId: row.id } }), 1);

      const found = await request(port, "GET", `/photos?find=${encodeURIComponent(uprn)}`, { cookie });
      assert.equal(found.status, 200);
      assert.match(found.body, /HHSRS - Completed/);
      assert.match(found.body, /Find results/);
      assert.match(found.body, new RegExp(uprn));
      assert.match(found.body, /front\.jpg/);
      assert.match(found.body, new RegExp(`${uprn}-Kitchen-1`));
      const frontAt = found.body.indexOf("front.jpg");
      const poolAt = found.body.indexOf(`${uprn}-Kitchen-1`);
      assert.ok(frontAt > 0 && poolAt > 0);

      const properties = await request(
        port,
        "GET",
        `/photos/hhsrs/${encodeURIComponent(project.name)}`,
        { cookie }
      );
      assert.equal(properties.status, 200);
      assert.match(properties.body, new RegExp(uprn));
      assert.match(properties.body, /Copy Lane/);
      assert.match(properties.body, /Sorted by UPRN \(numerical\)/);

      const property = await request(
        port,
        "GET",
        `/photos/hhsrs/${encodeURIComponent(project.name)}/${encodeURIComponent(uprn)}`,
        { cookie }
      );
      assert.equal(property.status, 200);
      assert.match(property.body, /front\.jpg/);
      assert.match(property.body, /data-photo-open/);
      assert.match(property.body, /Click a photo to view it full size/);
    } finally {
      await prisma.hhsrsSiteSubmission.delete({ where: { id: row.id } }).catch(() => undefined);
      await prisma.photoPoolItem.delete({ where: { id: pool.id } }).catch(() => undefined);
      await prisma.asset.delete({ where: { id: asset.id } }).catch(() => undefined);
      await rm(path.dirname(diskPath), { recursive: true, force: true });
    }
  });

  it("still moves the case to the Main Log when the copy function throws", async (t) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      t.skip("Postgres is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!admin) {
      t.skip("Seeded admin is not available");
      return;
    }
    const row = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectName: "Test 1",
        surveyDate: "2026-09-25",
        uprn: `throw-${Date.now()}`,
        fullAddress: "1 Throw Street",
        postcode: "EX1 1AA",
        surveyorName: "Alex Surveyor",
        category: "Electrical Hazards",
        rating: "Low",
        comment: "throw test",
        photoPaths: ["hhsrs-site-form/missing/front.jpg"],
        status: "new",
      },
    });
    const app = createApp({ basePath: "" });
    let calls = 0;
    app.set(HHSRS_PHOTO_COPY, async () => {
      calls += 1;
      throw new Error("spaces down");
    });
    const { server, port } = await listen(app);
    t.after(() => server.close());
    try {
      const login = await request(port, "POST", "/login", {
        form: { username: "phil.m", password: "PhilMoon2468" },
      });
      const cookie = cookieHeader(login.setCookie);
      const logged = await request(port, "POST", `/HHSRSreporter/review/${row.id}/mark-actioned`, {
        cookie,
        form: { expectedUpdatedAt: row.updatedAt.toISOString() },
      });
      assert.equal(logged.status, 302);
      assert.match(logged.location, /\/HHSRSreporter\/main-log$/);
      assert.equal(calls, 1);
      const after = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(after.status, "email_sent");
    } finally {
      await prisma.hhsrsSiteSubmission.delete({ where: { id: row.id } }).catch(() => undefined);
    }
  });
});

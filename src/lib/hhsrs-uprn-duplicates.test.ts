import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import { createSubmissionWithReference } from "./hhsrs-reference.js";
import {
  deleteDraft,
  saveIncomingPhotos,
  submissionDir,
  writeDraft,
  type HhsrsDraft,
  type HhsrsPhoto,
} from "./hhsrs-site-form.js";
import { HHSRS_SITE_PHOTO_STORAGE, type SitePhotoStorage } from "./hhsrs-site-photos.js";
import {
  UPRN_DUPLICATE_MOVED_BY,
  planUprnDuplicateMoves,
  uprnDuplicateNote,
  uprnSentMatchNote,
  sweepWaitingUprnDuplicates,
  type UprnDuplicateCandidate,
} from "./hhsrs-uprn-duplicates.js";

process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

function at(iso: string): Date {
  return new Date(iso);
}

function candidate(partial: Partial<UprnDuplicateCandidate> & Pick<UprnDuplicateCandidate, "id">): UprnDuplicateCandidate {
  return {
    reference: "MTVH-001",
    uprn: "100012345678",
    status: "new",
    emailSentAt: null,
    createdAt: at("2026-09-01T09:00:00.000Z"),
    ...partial,
  };
}

describe("planUprnDuplicateMoves", () => {
  it("moves every waiting case that shares a UPRN and each notes the others", () => {
    const moves = planUprnDuplicateMoves([
      candidate({ id: "later", reference: "MTVH-021", createdAt: at("2026-09-02T09:00:00.000Z") }),
      candidate({ id: "earliest", reference: "MTVH-014", createdAt: at("2026-09-01T09:00:00.000Z") }),
      candidate({
        id: "latest",
        reference: "MTVH-030",
        status: "in_review",
        createdAt: at("2026-09-03T09:00:00.000Z"),
      }),
      candidate({ id: "other", reference: "MTVH-099", uprn: "999", createdAt: at("2026-09-04T09:00:00.000Z") }),
    ]);
    assert.deepEqual(moves, [
      {
        id: "earliest",
        duplicateOf: "MTVH-021",
        note: uprnDuplicateNote(["MTVH-021", "MTVH-030"]),
      },
      {
        id: "later",
        duplicateOf: "MTVH-014",
        note: uprnDuplicateNote(["MTVH-014", "MTVH-030"]),
      },
      {
        id: "latest",
        duplicateOf: "MTVH-014",
        note: uprnDuplicateNote(["MTVH-014", "MTVH-021"]),
      },
    ]);
    for (const move of moves) {
      assert.notEqual(move.duplicateOf, move.id);
      assert.match(move.note, new RegExp(move.duplicateOf));
    }
  });

  it("does not mark a case as a duplicate of itself, or match a blank UPRN", () => {
    assert.deepEqual(planUprnDuplicateMoves([candidate({ id: "only" })]), []);
    assert.deepEqual(
      planUprnDuplicateMoves([
        candidate({ id: "self", reference: "MTVH-014" }),
        candidate({ id: "self-again", reference: "MTVH-014", createdAt: at("2026-09-02T09:00:00.000Z") }),
      ]),
      []
    );
    assert.deepEqual(
      planUprnDuplicateMoves([
        candidate({ id: "a", reference: "MTVH-014", uprn: "  " }),
        candidate({ id: "b", reference: "MTVH-015", uprn: "", createdAt: at("2026-09-02T09:00:00.000Z") }),
      ]),
      []
    );
    assert.deepEqual(
      planUprnDuplicateMoves([
        candidate({ id: "keeper", reference: null, createdAt: at("2026-09-01T09:00:00.000Z") }),
        candidate({ id: "next", reference: "MTVH-015", createdAt: at("2026-09-02T09:00:00.000Z") }),
      ]),
      [
        {
          id: "keeper",
          duplicateOf: "MTVH-015",
          note: "Same UPRN as MTVH-015.",
        },
      ]
    );
  });

  it("leaves an emailed case in the Main Log and moves only a later case", () => {
    const emailedLater = planUprnDuplicateMoves([
      candidate({ id: "earliest", reference: "MTVH-014" }),
      candidate({
        id: "sent",
        reference: "MTVH-021",
        status: "email_sent",
        emailSentAt: at("2026-09-02T12:00:00.000Z"),
        createdAt: at("2026-09-02T09:00:00.000Z"),
      }),
    ]);
    assert.deepEqual(emailedLater, []);

    const emailedEarliest = planUprnDuplicateMoves([
      candidate({
        id: "sent-first",
        reference: "MTVH-014",
        status: "email_sent",
        emailSentAt: at("2026-09-01T12:00:00.000Z"),
      }),
      candidate({
        id: "waiting",
        reference: "MTVH-021",
        status: "email_ready",
        createdAt: at("2026-09-02T09:00:00.000Z"),
      }),
      candidate({
        id: "also",
        reference: "MTVH-022",
        createdAt: at("2026-09-03T09:00:00.000Z"),
      }),
    ]);
    assert.deepEqual(emailedEarliest, [
      { id: "also", duplicateOf: "MTVH-014", note: uprnSentMatchNote("MTVH-014") },
      { id: "waiting", duplicateOf: "MTVH-014", note: uprnSentMatchNote("MTVH-014") },
    ]);
    assert.equal(emailedEarliest.some((move) => move.id === "sent-first"), false);
  });

  it("leaves a case marked not a duplicate, and still files one nobody has marked", () => {
    const kept = planUprnDuplicateMoves([
      candidate({ id: "marked", reference: "MTVH-014", notADuplicate: true }),
      candidate({
        id: "unmarked",
        reference: "MTVH-021",
        createdAt: at("2026-09-02T09:00:00.000Z"),
      }),
    ]);
    assert.deepEqual(kept, [
      { id: "unmarked", duplicateOf: "MTVH-014", note: "Same UPRN as MTVH-014." },
    ]);

    const afterSend = planUprnDuplicateMoves([
      candidate({
        id: "sent",
        reference: "MTVH-014",
        status: "email_sent",
        emailSentAt: at("2026-09-01T12:00:00.000Z"),
      }),
      candidate({
        id: "cleared",
        reference: "MTVH-021",
        notADuplicate: true,
        createdAt: at("2026-09-02T09:00:00.000Z"),
      }),
      candidate({
        id: "fresh",
        reference: "MTVH-030",
        createdAt: at("2026-09-03T09:00:00.000Z"),
      }),
    ]);
    assert.deepEqual(afterSend, [
      { id: "fresh", duplicateOf: "MTVH-014", note: uprnSentMatchNote("MTVH-014") },
    ]);
    assert.equal(afterSend.some((move) => move.id === "cleared"), false);
  });

  it("treats spacing and letter case as the same UPRN", () => {
    const moves = planUprnDuplicateMoves([
      candidate({ id: "first", reference: "MTVH-014", uprn: "1000 12345678" }),
      candidate({
        id: "second",
        reference: "MTVH-021",
        uprn: "100012345678",
        createdAt: at("2026-09-02T09:00:00.000Z"),
      }),
      candidate({ id: "block", reference: "BLK-001", uprn: "blk-9" }),
      candidate({
        id: "block-again",
        reference: "BLK-002",
        uprn: "BLK-9",
        createdAt: at("2026-09-02T09:00:00.000Z"),
      }),
    ]);
    assert.deepEqual(moves, [
      { id: "block", duplicateOf: "BLK-002", note: "Same UPRN as BLK-002." },
      { id: "block-again", duplicateOf: "BLK-001", note: "Same UPRN as BLK-001." },
      { id: "first", duplicateOf: "MTVH-021", note: "Same UPRN as MTVH-021." },
      { id: "second", duplicateOf: "MTVH-014", note: "Same UPRN as MTVH-014." },
    ]);
  });
});

function cookieHeader(setCookie: string[], previous = ""): string {
  const jar = new Map<string, string>();
  for (const part of previous.split(";").map((item) => item.trim()).filter(Boolean)) {
    const name = part.split("=")[0];
    if (name) jar.set(name, part);
  }
  for (const item of setCookie) {
    const part = item.split(";")[0];
    const name = part.split("=")[0];
    if (name) jar.set(name, part);
  }
  return [...jar.values()].join("; ");
}

function jpegBytes(): Buffer {
  const buf = Buffer.alloc(64);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

function memoryStorage(): SitePhotoStorage {
  const objects = new Map<string, Buffer>();
  return {
    async put(key, body) {
      objects.set(key, Buffer.from(body));
      return true;
    },
    async get(key) {
      const hit = objects.get(key);
      return hit ? Buffer.from(hit) : null;
    },
    async remove(key) {
      objects.delete(key);
      return true;
    },
  };
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
  opts: { cookie?: string; fields?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.fields) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.fields).toString();
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

describe("UPRN duplicates in the database", () => {
  it("moves every waiting case that shares a UPRN on submit, and leaves an emailed case in the Main Log", async (t) => {
    try {
      await prisma.$queryRaw`SELECT "notNeededReason" FROM "HhsrsSiteSubmission" LIMIT 1`;
    } catch {
      t.skip("Postgres with the not-needed columns is not available");
      return;
    }
    const surveyor = await prisma.user.findFirst({ where: { role: "surveyor", frozen: false }, orderBy: { name: "asc" } });
    if (!surveyor?.name) {
      t.skip("Seeded surveyor is not available");
      return;
    }
    const stamp = randomUUID().slice(0, 8);
    const uprn = `100012345678${stamp}`;
    const project = await prisma.project.create({
      data: {
        name: `Uprn Dup ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: `U${stamp}`.slice(0, 8).toUpperCase(),
      },
    });
    const created: string[] = [];
    const draftIds: string[] = [];
    t.after(async () => {
      if (created.length) {
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
        await Promise.all(created.map((id) => rm(submissionDir(id), { recursive: true, force: true })));
      }
      await Promise.all(draftIds.map((id) => deleteDraft(id)));
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const earlier = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-01",
            uprn,
            fullAddress: "12 High Street, Exeter",
            postcode: "EX1 2AB",
            surveyorName: surveyor.name,
            category: "Damp & Mould Growth",
            rating: "Low",
            comment: "Earlier report.",
            photoPaths: [],
            reference,
            status: "new",
            createdAt: at("2026-09-01T09:00:00.000Z"),
          },
        })
    );
    created.push(earlier.id);

    const draftId = randomUUID();
    draftIds.push(draftId);
    const jpeg = jpegBytes();
    const saved = await saveIncomingPhotos(draftId, [
      { originalname: "room.jpg", mimetype: "image/jpeg", size: jpeg.length, buffer: jpeg },
    ]);
    const draft: HhsrsDraft = {
      id: draftId,
      projectId: project.id,
      projectName: project.name,
      surveyDate: "2026-09-02",
      uprn: `1000 12345678${stamp}`,
      fullAddress: "",
      postcode: "PL1 3CD",
      addressConfirmed: false,
      addressSource: "manual",
      addressLine1: "Flat 4, 88 Other Road",
      addressLine2: "",
      town: "Plymouth",
      surveyorName: surveyor.name,
      category: "Damp & Mould Growth",
      rating: "High - Emergency risk",
      comment: "Later report at a different address.",
      suspectedCause: "",
      clientCallReference: "",
      otherDetails: "",
      cat1Confirmed: false,
      callUnreached: false,
      callRefBlankReason: "",
      callUnreachedNote: "",
      vulnerabilities: "",
      restrictorMissingCount: "",
      restrictorLocations: "",
      restrictorMaterial: "",
      dampMouldChoice: "",
      photos: saved as HhsrsPhoto[],
      createdAt: new Date().toISOString(),
    };
    await writeDraft(draft);

    const app = createApp({ basePath: "" });
    app.set(HHSRS_SITE_PHOTO_STORAGE, memoryStorage());
    const { server, port } = await listen(app);
    t.after(() => server.close());

    const before = await prisma.hhsrsSiteSubmission.count({ where: { id: { in: [earlier.id] } } });
    const submitted = await request(port, "POST", "/HHSRS-site-form/submit", { fields: { draftId } });
    assert.equal(submitted.status, 302, submitted.body.slice(0, 400));
    const laterId = new URL(submitted.location, "http://127.0.0.1").searchParams.get("id") || "";
    assert.ok(laterId);
    created.push(laterId);

    const [kept, moved, count] = await Promise.all([
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: earlier.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: laterId } }),
      prisma.hhsrsSiteSubmission.count({ where: { id: { in: [earlier.id, laterId] } } }),
    ]);
    assert.equal(before, 1);
    assert.equal(count, 2);
    assert.equal(kept.status, "not_needed");
    assert.equal(kept.notNeededReason, "duplicate");
    assert.equal(kept.notNeededDuplicateOf, moved.reference);
    assert.equal(kept.notNeededNote, `Same UPRN as ${moved.reference}.`);
    assert.equal(kept.notNeededBy, UPRN_DUPLICATE_MOVED_BY);
    assert.equal(kept.fullAddress, "12 High Street, Exeter");
    assert.equal(moved.status, "not_needed");
    assert.equal(moved.notNeededReason, "duplicate");
    assert.equal(moved.notNeededDuplicateOf, earlier.reference);
    assert.equal(moved.notNeededNote, `Same UPRN as ${earlier.reference}.`);
    assert.equal(moved.notNeededBy, UPRN_DUPLICATE_MOVED_BY);
    assert.equal(moved.fullAddress, "Flat 4, 88 Other Road, Plymouth");
    assert.notEqual(moved.fullAddress, kept.fullAddress);
    assert.equal(moved.uprn.replace(/\s+/g, ""), kept.uprn.replace(/\s+/g, ""));
    assert.notEqual(moved.id, kept.id);
    assert.notEqual(moved.notNeededDuplicateOf, moved.reference);
    assert.notEqual(kept.notNeededDuplicateOf, kept.reference);

    const sent = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-03",
            uprn,
            fullAddress: "9 Sent Lane, Exeter",
            postcode: "EX1 9ZZ",
            surveyorName: surveyor.name,
            category: "Damp & Mould Growth",
            rating: "Low",
            comment: "Already emailed.",
            photoPaths: [],
            reference,
            status: "email_sent",
            emailSentAt: at("2026-09-03T15:00:00.000Z"),
            createdAt: at("2026-09-03T12:00:00.000Z"),
          },
        })
    );
    created.push(sent.id);
    await sweepWaitingUprnDuplicates();
    const stillSent = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: sent.id } });
    assert.equal(stillSent.status, "email_sent");
    assert.equal(stillSent.notNeededReason, "");
    assert.ok(stillSent.emailSentAt);
    const stillKept = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: earlier.id } });
    assert.equal(stillKept.status, "not_needed");
    assert.equal(stillKept.notNeededDuplicateOf, moved.reference);

    const spacedKey = `3000${stamp}`;
    const spacedFirst = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-01",
            uprn: `3000 ${stamp}`,
            fullAddress: "12 High Street, Exeter",
            postcode: "EX1 2AB",
            surveyorName: surveyor.name,
            category: "Excess Cold",
            rating: "Low",
            comment: "Spaced UPRN.",
            photoPaths: [],
            reference,
            status: "new",
            createdAt: at("2026-08-01T09:00:00.000Z"),
          },
        })
    );
    const spacedSecond = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-02",
            uprn: spacedKey,
            fullAddress: "Flat 4, 88 Other Road, Plymouth",
            postcode: "PL1 3CD",
            surveyorName: surveyor.name,
            category: "Excess Cold",
            rating: "Low",
            comment: "Compact UPRN.",
            photoPaths: [],
            reference,
            status: "new",
            createdAt: at("2026-08-02T09:00:00.000Z"),
          },
        })
    );
    created.push(spacedFirst.id, spacedSecond.id);
    await sweepWaitingUprnDuplicates();
    const spacedMoved = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: spacedSecond.id } });
    const spacedKept = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: spacedFirst.id } });
    assert.equal(spacedKept.status, "not_needed");
    assert.equal(spacedKept.notNeededDuplicateOf, spacedSecond.reference);
    assert.equal(spacedKept.notNeededNote, `Same UPRN as ${spacedSecond.reference}.`);
    assert.equal(spacedKept.fullAddress, "12 High Street, Exeter");
    assert.equal(spacedMoved.status, "not_needed");
    assert.equal(spacedMoved.notNeededDuplicateOf, spacedFirst.reference);
    assert.equal(spacedMoved.notNeededNote, `Same UPRN as ${spacedFirst.reference}.`);
    assert.equal(spacedMoved.fullAddress, "Flat 4, 88 Other Road, Plymouth");

    const loggedUprn = `4000${stamp}`;
    const logged = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-01",
            uprn: loggedUprn,
            fullAddress: "12 High Street, Exeter",
            postcode: "EX1 2AB",
            surveyorName: surveyor.name,
            category: "Damp & Mould Growth",
            rating: "Low",
            comment: "Already in the Main Log.",
            photoPaths: [],
            reference,
            status: "email_sent",
            emailSentAt: at("2026-09-01T15:00:00.000Z"),
            createdAt: at("2026-09-01T09:00:00.000Z"),
          },
        })
    );
    const repeat = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-04",
            uprn: loggedUprn,
            fullAddress: "Flat 4, 88 Other Road, Plymouth",
            postcode: "PL1 3CD",
            surveyorName: surveyor.name,
            category: "Damp & Mould Growth",
            rating: "Severe",
            comment: "Second visit, different address.",
            photoPaths: [],
            reference,
            status: "new",
            createdAt: at("2026-09-04T09:00:00.000Z"),
          },
        })
    );
    created.push(logged.id, repeat.id);
    await sweepWaitingUprnDuplicates();
    const loggedRow = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: logged.id } });
    const repeatRow = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: repeat.id } });
    assert.equal(loggedRow.status, "email_sent");
    assert.equal(loggedRow.notNeededReason, "");
    assert.equal(repeatRow.status, "not_needed");
    assert.equal(repeatRow.notNeededReason, "duplicate");
    assert.equal(repeatRow.notNeededDuplicateOf, logged.reference);
    assert.equal(repeatRow.notNeededNote, uprnSentMatchNote(logged.reference || ""));
    assert.notEqual(repeatRow.fullAddress, loggedRow.fullAddress);
    assert.notEqual(repeatRow.notNeededDuplicateOf, repeatRow.reference);
  });

  it("catches existing waiting cases when Duplicates is opened, including a third case", async (t) => {
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
    const stamp = randomUUID().slice(0, 8);
    const uprn = `2000${stamp}`;
    const project = await prisma.project.create({
      data: {
        name: `Uprn Page ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: `P${stamp}`.slice(0, 8).toUpperCase(),
      },
    });
    const created: string[] = [];
    t.after(async () => {
      if (created.length) await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const make = async (address: string, when: string, status = "new") => {
      const row = await createSubmissionWithReference(
        { projectId: project.id, projectName: project.name },
        (tx, reference) =>
          tx.hhsrsSiteSubmission.create({
            data: {
              projectId: project.id,
              projectName: project.name,
              surveyDate: "2026-09-01",
              uprn,
              fullAddress: address,
              postcode: "EX2 4PQ",
              surveyorName: "Sam Surveyor",
              category: "Damp & Mould Growth",
              rating: "Medium",
              comment: address,
              photoPaths: [],
              reference,
              status,
              createdAt: at(when),
            },
          })
      );
      created.push(row.id);
      return row;
    };

    const earliest = await make(`12 High Street ${stamp}`, "2026-09-01T09:00:00.000Z");
    const middle = await make(`Flat 4, 88 Other Road ${stamp}`, "2026-09-02T09:00:00.000Z", "in_review");
    const latest = await make(`1 Quay Lane ${stamp}`, "2026-09-03T09:00:00.000Z", "email_ready");
    const alone = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-04",
            uprn: `alone-${stamp}`,
            fullAddress: `99 Lone Road ${stamp}`,
            postcode: "EX2 4PQ",
            surveyorName: "Sam Surveyor",
            category: "Damp & Mould Growth",
            rating: "Medium",
            comment: "Only case for this UPRN.",
            photoPaths: [],
            reference,
            status: "new",
            createdAt: at("2026-09-04T09:00:00.000Z"),
          },
        })
    );
    created.push(alone.id);

    const app = createApp({ basePath: "" });
    const { server, port } = await listen(app);
    t.after(() => server.close());
    const login = await request(port, "POST", "/login", {
      fields: { username: "phil.m", password: "PhilMoon2468" },
    });
    assert.equal(login.status, 302);
    const cookie = cookieHeader(login.setCookie);

    const page = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(uprn)}`, { cookie });
    assert.equal(page.status, 200);
    assert.match(page.body, new RegExp(earliest.reference || "missing-earliest"));
    assert.match(page.body, new RegExp(middle.reference || "missing-middle"));
    assert.match(page.body, new RegExp(`12 High Street ${stamp}`));
    assert.match(page.body, new RegExp(`Flat 4, 88 Other Road ${stamp}`));
    assert.match(page.body, new RegExp(`1 Quay Lane ${stamp}`));
    assert.match(page.body, /View duplicate/);
    assert.match(page.body, /tab-link[^"]*needs-attention/);

    const [kept, movedMiddle, movedLatest, single] = await Promise.all([
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: earliest.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: middle.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: latest.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: alone.id } }),
    ]);
    assert.equal(kept.status, "not_needed");
    assert.equal(kept.notNeededReason, "duplicate");
    assert.equal(kept.notNeededDuplicateOf, middle.reference);
    assert.equal(kept.notNeededNote, `Same UPRN as ${middle.reference} and ${latest.reference}.`);
    assert.notEqual(kept.notNeededDuplicateOf, kept.reference);
    assert.equal(movedMiddle.status, "not_needed");
    assert.equal(movedMiddle.notNeededReason, "duplicate");
    assert.equal(movedMiddle.notNeededDuplicateOf, earliest.reference);
    assert.match(movedMiddle.notNeededNote, new RegExp(latest.reference || "missing"));
    assert.equal(movedLatest.status, "not_needed");
    assert.equal(movedLatest.notNeededDuplicateOf, earliest.reference);
    assert.match(movedLatest.notNeededNote, new RegExp(middle.reference || "missing"));
    assert.notEqual(movedLatest.notNeededDuplicateOf, movedLatest.reference);
    assert.equal(single.status, "new");
    assert.equal(single.notNeededDuplicateOf, "");
    const remaining = await prisma.hhsrsSiteSubmission.count({
      where: { id: { in: [earliest.id, middle.id, latest.id, alone.id] } },
    });
    assert.equal(remaining, 4);
  });

  it("shows the sent case on the left and Amend and resend on the later case", async (t) => {
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
    const stamp = randomUUID().slice(0, 8);
    const uprn = `98756${stamp}`;
    const project = await prisma.project.create({
      data: {
        name: `Uprn Compare ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: `C${stamp}`.slice(0, 8).toUpperCase(),
      },
    });
    const created: string[] = [];
    t.after(async () => {
      if (created.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: created } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
      }
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const sent = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-20",
            uprn,
            fullAddress: "1 Jenkins House",
            postcode: "B14 6ES",
            surveyorName: "Sam Surveyor",
            category: "Damp & Mould Growth",
            rating: "Medium",
            comment: "Mould around window",
            photoPaths: [],
            reference,
            status: "email_sent",
            emailSentAt: at("2026-09-20T12:00:00.000Z"),
            createdAt: at("2026-09-20T09:00:00.000Z"),
          },
        })
    );
    created.push(sent.id);
    await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: sent.id,
        sentAt: at("2026-09-20T12:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "HHSRS@savillshousing.co.uk",
        to: "repairs@savillshousing.co.uk",
        subject: "HHSRS hazard",
        body: "Mould around window was reported.",
        photoNames: [],
      },
    });
    const later = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-28",
            uprn,
            fullAddress: "1 Jenkins House",
            postcode: "B14 6ES",
            surveyorName: "Sam Surveyor",
            category: "Damp & Mould Growth",
            rating: "High",
            comment: "Visible mould in bathroom",
            photoPaths: [],
            reference,
            status: "new",
            createdAt: at("2026-09-28T09:00:00.000Z"),
          },
        })
    );
    created.push(later.id);

    const app = createApp({ basePath: "" });
    const { server, port } = await listen(app);
    t.after(() => server.close());
    const login = await request(port, "POST", "/login", {
      fields: { username: "phil.m", password: "PhilMoon2468" },
    });
    assert.equal(login.status, 302);
    const cookie = cookieHeader(login.setCookie);
    const page = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(uprn)}`, { cookie });
    assert.equal(page.status, 200);
    const sentHeading = page.body.indexOf(`${sent.reference} · already sent`);
    const laterHeading = page.body.indexOf("Later case · not emailed");
    const amendAt = page.body.indexOf("Amend and resend");
    assert.ok(sentHeading > 0 && laterHeading > sentHeading && amendAt > laterHeading);
    assert.match(page.body, /View duplicate/);
    assert.match(page.body, /Main Log, emailed 20\/09\/2026/);
    assert.match(page.body, new RegExp(`Case ${sent.reference}`));
    assert.match(page.body, /1 Jenkins House, B14 6ES/);
    assert.match(page.body, /<dd class="diff">High<\/dd>/);
    assert.match(page.body, /<dd class="diff">Visible mould in bathroom<\/dd>/);
    assert.match(page.body, /<dd class="diff">28\/09\/2026<\/dd>/);
    assert.doesNotMatch(page.body, /<dd class="diff">1 Jenkins House, B14 6ES<\/dd>/);
    assert.match(page.body, new RegExp(`/HHSRSreporter/find\\?case=${sent.id}&amp;view=amend`));
    assert.match(page.body, /tab-link[^"]*needs-attention/);
    assert.match(page.body, /class="tool-header"/);
    assert.doesNotMatch(page.body, /class="step-tabs"/);

    const [sentRow, laterRow] = await Promise.all([
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: sent.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: later.id } }),
    ]);
    assert.equal(sentRow.status, "email_sent");
    assert.equal(laterRow.status, "not_needed");
    assert.equal(laterRow.notNeededDuplicateOf, sent.reference);
    assert.equal(laterRow.notNeededNote, uprnSentMatchNote(sent.reference || ""));

    const notDup = page.body.indexOf("Not a duplicate");
    const amend = await request(port, "GET", `/HHSRSreporter/find?case=${sent.id}&view=amend`, { cookie });
    assert.equal(amend.status, 200);
    assert.match(amend.body, /Amend &amp; resend/);
    assert.match(amend.body, /Change the case, then generate the correction/);
    assert.match(amend.body, /Mould around window was reported\./);
    assert.ok(notDup > laterHeading && amendAt > notDup);
    assert.match(page.body, new RegExp(`/HHSRSreporter/duplicates/${later.id}/not-duplicate`));
  });

  it("returns an unsent later case to Pending and does not file it again when a page opens", async (t) => {
    try {
      await prisma.$queryRaw`SELECT "notADuplicate" FROM "HhsrsSiteSubmission" LIMIT 1`;
    } catch {
      t.skip("Postgres with notADuplicate is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!admin) {
      t.skip("Seeded admin is not available");
      return;
    }
    const stamp = randomUUID().slice(0, 8);
    const uprn = `5555${stamp}`;
    const project = await prisma.project.create({
      data: {
        name: `Not Dup ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: `N${stamp}`.slice(0, 8).toUpperCase(),
      },
    });
    const created: string[] = [];
    t.after(async () => {
      if (created.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: created } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
      }
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const make = async (address: string, when: string, status = "new") => {
      const row = await createSubmissionWithReference(
        { projectId: project.id, projectName: project.name },
        (tx, reference) =>
          tx.hhsrsSiteSubmission.create({
            data: {
              projectId: project.id,
              projectName: project.name,
              surveyDate: "2026-09-28",
              uprn,
              fullAddress: address,
              postcode: "B14 6ES",
              surveyorName: "Sam Surveyor",
              category: "Damp & Mould Growth",
              rating: "High",
              comment: address,
              photoPaths: [],
              reference,
              status,
              createdAt: at(when),
            },
          })
      );
      created.push(row.id);
      return row;
    };

    const sent = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-20",
            uprn,
            fullAddress: `1 Kept House ${stamp}`,
            postcode: "B14 6ES",
            surveyorName: "Sam Surveyor",
            category: "Damp & Mould Growth",
            rating: "Medium",
            comment: "Already emailed.",
            photoPaths: [],
            reference,
            status: "email_sent",
            emailSentAt: at("2026-09-20T12:00:00.000Z"),
            emailSubject: "HHSRS hazard",
            emailBody: "The first email stays in the Main Log.",
            createdAt: at("2026-09-20T09:00:00.000Z"),
          },
        })
    );
    created.push(sent.id);
    const sentEmail = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: sent.id,
        sentAt: at("2026-09-20T12:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "HHSRS@savillshousing.co.uk",
        to: "repairs@savillshousing.co.uk",
        subject: "HHSRS hazard",
        body: "The first email stays in the Main Log.",
        photoNames: [],
      },
    });
    const later = await make(`2 Later House ${stamp}`, "2026-09-28T09:00:00.000Z");

    const app = createApp({ basePath: "" });
    const { server, port } = await listen(app);
    t.after(() => server.close());
    const login = await request(port, "POST", "/login", {
      fields: { username: "phil.m", password: "PhilMoon2468" },
    });
    assert.equal(login.status, 302);
    let cookie = cookieHeader(login.setCookie);

    const filed = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(uprn)}`, { cookie });
    assert.equal(filed.status, 200);
    assert.match(filed.body, /Not a duplicate/);
    assert.match(filed.body, /Amend and resend/);
    assert.match(filed.body, new RegExp(`/HHSRSreporter/duplicates/${later.id}/not-duplicate`));
    const filedLater = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: later.id } });
    assert.equal(filedLater.status, "not_needed");
    assert.equal(filedLater.notADuplicate, false);

    const cleared = await request(port, "POST", `/HHSRSreporter/duplicates/${later.id}/not-duplicate`, { cookie });
    assert.equal(cleared.status, 302);
    assert.equal(cleared.location, "/HHSRSreporter/duplicates");
    cookie = cookieHeader(cleared.setCookie, cookie);
    const back = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: later.id } });
    assert.equal(back.status, "new");
    assert.equal(back.notADuplicate, true);
    assert.equal(back.notNeededReason, "");
    assert.equal(back.notNeededDuplicateOf, "");
    assert.equal(back.emailSentAt, null);
    const choice = Array.isArray(back.notNeededLog) ? back.notNeededLog : [];
    assert.equal((choice.at(-1) as { action?: string }).action, "not_duplicate");

    const again = await request(port, "GET", "/HHSRSreporter", { cookie });
    assert.equal(again.status, 200);
    assert.match(again.body, new RegExp(later.reference || "missing-later"));
    assert.match(again.body, new RegExp(`2 Later House ${stamp}`));
    const stayed = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: later.id } });
    assert.equal(stayed.status, "new");
    assert.equal(stayed.notADuplicate, true);
    const sentStill = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: sent.id } });
    assert.equal(sentStill.status, "email_sent");
    assert.equal(sentStill.notADuplicate, false);
    assert.equal(sentStill.emailSubject, "HHSRS hazard");
    assert.equal(sentStill.emailBody, "The first email stays in the Main Log.");
    assert.equal(sentStill.notNeededReason, "");
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { id: sentEmail.id } }), 1);

    const dupes = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(uprn)}`, { cookie });
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${later.id}"`));
    assert.doesNotMatch(dupes.body, new RegExp(`/duplicates/${later.id}/not-duplicate`));

    const fresh = await make(`3 Fresh House ${stamp}`, "2026-09-29T09:00:00.000Z");
    const swept = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(uprn)}`, { cookie });
    assert.match(swept.body, new RegExp(`3 Fresh House ${stamp}`));
    assert.match(swept.body, /Not a duplicate/);
    const freshRow = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: fresh.id } });
    const laterStill = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: later.id } });
    assert.equal(freshRow.status, "not_needed");
    assert.equal(freshRow.notNeededDuplicateOf, sent.reference);
    assert.equal(freshRow.notADuplicate, false);
    assert.equal(laterStill.status, "new");
    assert.equal(laterStill.notADuplicate, true);
    const log = await request(
      port,
      "GET",
      `/HHSRSreporter/main-log?q=${encodeURIComponent(sent.reference || "")}&open=${encodeURIComponent(`email:${sentEmail.id}`)}`,
      { cookie }
    );
    assert.match(log.body, new RegExp(sent.reference || "missing-sent"));
    assert.match(log.body, /The first email stays in the Main Log\./);
    assert.equal(await prisma.hhsrsSiteSubmission.count({ where: { id: { in: [sent.id, later.id, fresh.id] } } }), 3);
  });

  it("takes an already sent later case off the dupes list and keeps the Main Log email", async (t) => {
    try {
      await prisma.$queryRaw`SELECT "notADuplicate" FROM "HhsrsSiteSubmission" LIMIT 1`;
    } catch {
      t.skip("Postgres with notADuplicate is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!admin) {
      t.skip("Seeded admin is not available");
      return;
    }
    const stamp = randomUUID().slice(0, 8);
    const uprn = `6666${stamp}`;
    const project = await prisma.project.create({
      data: {
        name: `Sent Later ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: `S${stamp}`.slice(0, 8).toUpperCase(),
      },
    });
    const created: string[] = [];
    t.after(async () => {
      if (created.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: created } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
      }
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const first = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-01",
            uprn,
            fullAddress: `1 First Street ${stamp}`,
            postcode: "B14 6ES",
            surveyorName: "Sam Surveyor",
            category: "Damp & Mould Growth",
            rating: "Low",
            comment: "Earlier case.",
            photoPaths: [],
            reference,
            status: "email_sent",
            emailSentAt: at("2026-09-01T12:00:00.000Z"),
            createdAt: at("2026-09-01T09:00:00.000Z"),
          },
        })
    );
    created.push(first.id);
    const later = await createSubmissionWithReference(
      { projectId: project.id, projectName: project.name },
      (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: project.name,
            surveyDate: "2026-09-28",
            uprn,
            fullAddress: `2 Sent Later ${stamp}`,
            postcode: "B14 6ES",
            surveyorName: "Sam Surveyor",
            category: "Damp & Mould Growth",
            rating: "High",
            comment: "Later case that was already emailed.",
            photoPaths: [],
            reference,
            status: "not_needed",
            notNeededReason: "duplicate",
            notNeededDuplicateOf: first.reference || "",
            notNeededNote: uprnSentMatchNote(first.reference || ""),
            notNeededBy: "HHSRS Reporter",
            notNeededAt: at("2026-09-28T10:00:00.000Z"),
            emailSentAt: at("2026-09-28T11:00:00.000Z"),
            emailSubject: "Later hazard",
            emailBody: "This sent email must stay in the Main Log.",
            createdAt: at("2026-09-28T09:00:00.000Z"),
          },
        })
    );
    created.push(later.id);
    const laterEmail = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: later.id,
        sentAt: at("2026-09-28T11:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "HHSRS@savillshousing.co.uk",
        to: "repairs@savillshousing.co.uk",
        subject: "Later hazard",
        body: "This sent email must stay in the Main Log.",
        photoNames: [],
      },
    });

    const app = createApp({ basePath: "" });
    const { server, port } = await listen(app);
    t.after(() => server.close());
    const login = await request(port, "POST", "/login", {
      fields: { username: "phil.m", password: "PhilMoon2468" },
    });
    let cookie = cookieHeader(login.setCookie);
    const page = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(uprn)}&open=${later.id}`, {
      cookie,
    });
    assert.equal(page.status, 200);
    assert.match(page.body, /Not a duplicate/);
    assert.match(page.body, new RegExp(`2 Sent Later ${stamp}`));

    const cleared = await request(port, "POST", `/HHSRSreporter/duplicates/${later.id}/not-duplicate`, { cookie });
    assert.equal(cleared.status, 302);
    cookie = cookieHeader(cleared.setCookie, cookie);
    const row = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: later.id } });
    assert.equal(row.status, "email_sent");
    assert.equal(row.notADuplicate, true);
    assert.equal(row.notNeededReason, "");
    assert.ok(row.emailSentAt);
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { id: laterEmail.id } }), 1);
    assert.equal(await prisma.hhsrsSiteSubmission.count({ where: { id: later.id } }), 1);

    const dupes = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(uprn)}`, { cookie });
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${later.id}"`));
    const still = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: later.id } });
    assert.equal(still.status, "email_sent");
    assert.notEqual(still.status, "new");
    const log = await request(
      port,
      "GET",
      `/HHSRSreporter/main-log?q=${encodeURIComponent(later.reference || "")}&open=${encodeURIComponent(`email:${laterEmail.id}`)}`,
      { cookie }
    );
    assert.match(log.body, new RegExp(later.reference || "missing-later"));
    assert.match(log.body, /This sent email must stay in the Main Log\./);
    const pending = await request(port, "GET", "/HHSRSreporter", { cookie });
    const waiting = pending.body.slice(pending.body.indexOf('id="waiting-table"'), pending.body.indexOf('id="last-actioned"'));
    const actioned = pending.body.slice(pending.body.indexOf('id="last-actioned"'));
    assert.equal(waiting.includes(`2 Sent Later ${stamp}`), false);
    assert.match(actioned, new RegExp(`2 Sent Later ${stamp}`));
    const firstStill = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(firstStill.status, "email_sent");
    assert.equal(firstStill.notADuplicate, false);
    assert.equal(firstStill.emailSentAt?.toISOString(), at("2026-09-01T12:00:00.000Z").toISOString());
  });

  it("one press clears both unsent cases in that comparison and leaves the others", async (t) => {
    try {
      await prisma.$queryRaw`SELECT "notADuplicate" FROM "HhsrsSiteSubmission" LIMIT 1`;
    } catch {
      t.skip("Postgres with notADuplicate is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!admin) {
      t.skip("Seeded admin is not available");
      return;
    }
    const stamp = randomUUID().slice(0, 8);
    const uprn = `7777${stamp}`;
    const otherUprn = `8888${stamp}`;
    const project = await prisma.project.create({
      data: {
        name: `Pair Clear ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: `P${stamp}`.slice(0, 8).toUpperCase(),
      },
    });
    const created: string[] = [];
    t.after(async () => {
      if (created.length) await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const make = async (address: string, when: string, rowUprn: string) => {
      const row = await createSubmissionWithReference(
        { projectId: project.id, projectName: project.name },
        (tx, reference) =>
          tx.hhsrsSiteSubmission.create({
            data: {
              projectId: project.id,
              projectName: project.name,
              surveyDate: "2026-09-01",
              uprn: rowUprn,
              fullAddress: address,
              postcode: "B14 6ES",
              surveyorName: "Sam Surveyor",
              category: "Damp & Mould Growth",
              rating: "Medium",
              comment: address,
              photoPaths: [],
              reference,
              status: "new",
              createdAt: at(when),
            },
          })
      );
      created.push(row.id);
      return row;
    };

    const earliest = await make(`12 High Street ${stamp}`, "2026-09-01T09:00:00.000Z", uprn);
    const middle = await make(`Flat 4 ${stamp}`, "2026-09-02T09:00:00.000Z", uprn);
    const latest = await make(`1 Quay Lane ${stamp}`, "2026-09-03T09:00:00.000Z", uprn);
    const otherFirst = await make(`9 Other Road ${stamp}`, "2026-09-01T09:00:00.000Z", otherUprn);
    const otherSecond = await make(`10 Other Road ${stamp}`, "2026-09-02T09:00:00.000Z", otherUprn);

    const app = createApp({ basePath: "" });
    const { server, port } = await listen(app);
    t.after(() => server.close());
    const login = await request(port, "POST", "/login", {
      fields: { username: "phil.m", password: "PhilMoon2468" },
    });
    assert.equal(login.status, 302);
    let cookie = cookieHeader(login.setCookie);

    const filed = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(stamp)}`, { cookie });
    assert.equal(filed.status, 200);
    assert.match(filed.body, new RegExp(`/HHSRSreporter/duplicates/${earliest.id}/not-duplicate`));
    assert.match(filed.body, new RegExp(`/HHSRSreporter/duplicates/${middle.id}/not-duplicate`));
    assert.match(filed.body, new RegExp(`/HHSRSreporter/duplicates/${latest.id}/not-duplicate`));
    const filedEarliest = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: earliest.id } });
    assert.equal(filedEarliest.status, "not_needed");
    assert.equal(filedEarliest.notNeededReason, "duplicate");
    assert.equal(filedEarliest.notNeededDuplicateOf, middle.reference);

    const cleared = await request(port, "POST", `/HHSRSreporter/duplicates/${earliest.id}/not-duplicate`, { cookie });
    assert.equal(cleared.status, 302);
    assert.equal(cleared.location, "/HHSRSreporter/duplicates");
    cookie = cookieHeader(cleared.setCookie, cookie);

    const [backEarliest, backMiddle, backLatest, backOtherFirst, backOtherSecond] = await Promise.all([
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: earliest.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: middle.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: latest.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: otherFirst.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: otherSecond.id } }),
    ]);
    for (const row of [backEarliest, backMiddle]) {
      assert.equal(row.status, "new");
      assert.equal(row.notADuplicate, true);
      assert.equal(row.notNeededReason, "");
      assert.equal(row.notNeededDuplicateOf, "");
      assert.equal(row.notNeededNote, "");
      assert.equal(row.emailSentAt, null);
      const choice = Array.isArray(row.notNeededLog) ? row.notNeededLog : [];
      assert.equal((choice.at(-1) as { action?: string }).action, "not_duplicate");
    }
    assert.equal(backLatest.status, "not_needed");
    assert.equal(backLatest.notADuplicate, false);
    assert.equal(backLatest.notNeededReason, "duplicate");
    assert.equal(backLatest.notNeededDuplicateOf, earliest.reference);
    assert.equal(backOtherFirst.status, "not_needed");
    assert.equal(backOtherFirst.notADuplicate, false);
    assert.equal(backOtherSecond.status, "not_needed");
    assert.equal(backOtherSecond.notADuplicate, false);
    assert.equal(
      await prisma.hhsrsSiteSubmission.count({
        where: { id: { in: [earliest.id, middle.id, latest.id, otherFirst.id, otherSecond.id] } },
      }),
      5
    );

    const dupes = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(stamp)}`, { cookie });
    assert.equal(dupes.status, 200);
    assert.match(
      dupes.body,
      new RegExp(
        `${earliest.reference} and ${middle.reference} are not duplicates and are back in Pending\\.`
      )
    );
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${earliest.id}"`));
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${middle.id}"`));
    assert.doesNotMatch(dupes.body, new RegExp(`/duplicates/${earliest.id}/not-duplicate`));
    assert.doesNotMatch(dupes.body, new RegExp(`/duplicates/${middle.id}/not-duplicate`));
    assert.match(dupes.body, new RegExp(`data-dup-id="${latest.id}"`));
    assert.match(dupes.body, new RegExp(`1 Quay Lane ${stamp}`));
    assert.match(dupes.body, new RegExp(`data-dup-id="${otherFirst.id}"`));
    assert.match(dupes.body, new RegExp(`data-dup-id="${otherSecond.id}"`));

    const pending = await request(port, "GET", "/HHSRSreporter", { cookie });
    const waiting = pending.body.slice(pending.body.indexOf('id="waiting-table"'), pending.body.indexOf('id="last-actioned"'));
    assert.match(waiting, new RegExp(`12 High Street ${stamp}`));
    assert.match(waiting, new RegExp(`Flat 4 ${stamp}`));
    assert.equal(waiting.includes(`1 Quay Lane ${stamp}`), false);

    const [stillEarliest, stillMiddle, stillLatest] = await Promise.all([
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: earliest.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: middle.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: latest.id } }),
    ]);
    assert.equal(stillEarliest.status, "new");
    assert.equal(stillEarliest.notADuplicate, true);
    assert.equal(stillMiddle.status, "new");
    assert.equal(stillMiddle.notADuplicate, true);
    assert.equal(stillLatest.status, "not_needed");
    assert.equal(stillLatest.notADuplicate, false);
  });

  it("clears an emailed comparison partner with the same status rules and leaves another reason", async (t) => {
    try {
      await prisma.$queryRaw`SELECT "notADuplicate" FROM "HhsrsSiteSubmission" LIMIT 1`;
    } catch {
      t.skip("Postgres with notADuplicate is not available");
      return;
    }
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!admin) {
      t.skip("Seeded admin is not available");
      return;
    }
    const stamp = randomUUID().slice(0, 8);
    const project = await prisma.project.create({
      data: {
        name: `Pair Rules ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: `R${stamp}`.slice(0, 8).toUpperCase(),
      },
    });
    const created: string[] = [];
    t.after(async () => {
      if (created.length) {
        await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: created } } });
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: created } } });
      }
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const make = async (
      address: string,
      when: string,
      extra: {
        emailSentAt?: Date;
        emailSubject?: string;
        emailBody?: string;
        notNeededReason?: string;
        notNeededDuplicateOf?: string;
        notNeededNote?: string;
      } = {}
    ) => {
      const row = await createSubmissionWithReference(
        { projectId: project.id, projectName: project.name },
        (tx, reference) =>
          tx.hhsrsSiteSubmission.create({
            data: {
              projectId: project.id,
              projectName: project.name,
              surveyDate: "2026-09-01",
              uprn: `solo-${stamp}-${address}`,
              fullAddress: address,
              postcode: "B14 6ES",
              surveyorName: "Sam Surveyor",
              category: "Damp & Mould Growth",
              rating: "High",
              comment: address,
              photoPaths: ["kept.jpg"],
              reference,
              status: "not_needed",
              notNeededReason: "duplicate",
              notNeededBy: "HHSRS Reporter",
              notNeededAt: at(when),
              createdAt: at(when),
              ...extra,
            },
          })
      );
      created.push(row.id);
      return row;
    };

    const unsentPartner = await make(`Unsent partner ${stamp}`, "2026-09-01T09:00:00.000Z");
    const correctionCase = await make(`Correction case ${stamp}`, "2026-09-02T09:00:00.000Z", {
      emailSentAt: at("2026-09-02T12:00:00.000Z"),
      emailSubject: "Correction subject",
      emailBody: "The correction email stays.",
      notNeededDuplicateOf: unsentPartner.reference || "",
      notNeededNote: "Same UPRN as the unsent partner.",
    });
    await prisma.hhsrsSiteSubmission.update({
      where: { id: unsentPartner.id },
      data: { notNeededDuplicateOf: correctionCase.reference || "", notNeededNote: "Same UPRN as the correction." },
    });
    const correctionEmail = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: correctionCase.id,
        sentAt: at("2026-09-02T12:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "HHSRS@savillshousing.co.uk",
        to: "repairs@savillshousing.co.uk",
        subject: "Correction subject",
        body: "The correction email stays.",
        photoNames: [],
        kind: "correction",
      },
    });

    const emailedPartner = await make(`Emailed partner ${stamp}`, "2026-09-03T09:00:00.000Z", {
      emailSentAt: at("2026-09-03T12:00:00.000Z"),
      emailSubject: "Partner subject",
      emailBody: "This emailed case stays as it is.",
    });
    const unsentButton = await make(`Unsent button ${stamp}`, "2026-09-04T09:00:00.000Z", {
      notNeededDuplicateOf: emailedPartner.reference || "",
    });
    await prisma.hhsrsSiteSubmission.update({
      where: { id: emailedPartner.id },
      data: { notNeededDuplicateOf: unsentButton.reference || "" },
    });
    const partnerEmail = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: emailedPartner.id,
        sentAt: at("2026-09-03T12:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "HHSRS@savillshousing.co.uk",
        to: "repairs@savillshousing.co.uk",
        subject: "Partner subject",
        body: "This emailed case stays as it is.",
        photoNames: [],
      },
    });

    const errorCase = await make(`Surveyor error ${stamp}`, "2026-09-05T09:00:00.000Z", {
      notNeededReason: "surveyor_error",
      notNeededDuplicateOf: "",
      notNeededNote: "Wrong details.",
    });
    const pointsAtError = await make(`Points at error ${stamp}`, "2026-09-06T09:00:00.000Z", {
      notNeededDuplicateOf: errorCase.reference || "",
    });

    const app = createApp({ basePath: "" });
    const { server, port } = await listen(app);
    t.after(() => server.close());
    const login = await request(port, "POST", "/login", {
      fields: { username: "phil.m", password: "PhilMoon2468" },
    });
    let cookie = cookieHeader(login.setCookie);

    const clearedCorrection = await request(
      port,
      "POST",
      `/HHSRSreporter/duplicates/${correctionCase.id}/not-duplicate`,
      { cookie }
    );
    assert.equal(clearedCorrection.status, 302);
    cookie = cookieHeader(clearedCorrection.setCookie, cookie);
    const corrected = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: correctionCase.id } });
    const partnerBack = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: unsentPartner.id } });
    assert.equal(corrected.status, "corrected");
    assert.equal(corrected.notADuplicate, true);
    assert.equal(corrected.notNeededReason, "");
    assert.equal(corrected.emailSubject, "Correction subject");
    assert.equal(corrected.emailBody, "The correction email stays.");
    assert.deepEqual(corrected.photoPaths, ["kept.jpg"]);
    assert.equal(await prisma.hhsrsSentEmail.count({ where: { id: correctionEmail.id } }), 1);
    assert.equal(partnerBack.status, "new");
    assert.equal(partnerBack.notADuplicate, true);
    assert.equal(partnerBack.notNeededReason, "");
    assert.equal(partnerBack.emailSentAt, null);

    const clearedUnsent = await request(port, "POST", `/HHSRSreporter/duplicates/${unsentButton.id}/not-duplicate`, {
      cookie,
    });
    assert.equal(clearedUnsent.status, 302);
    cookie = cookieHeader(clearedUnsent.setCookie, cookie);
    const buttonBack = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: unsentButton.id } });
    const emailedStill = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: emailedPartner.id } });
    assert.equal(buttonBack.status, "new");
    assert.equal(buttonBack.notADuplicate, true);
    assert.equal(emailedStill.status, "email_sent");
    assert.equal(emailedStill.notADuplicate, true);
    assert.equal(emailedStill.notNeededReason, "");
    assert.equal(emailedStill.notNeededDuplicateOf, "");
    assert.equal(emailedStill.notNeededNote, "");
    assert.equal(emailedStill.emailSubject, "Partner subject");
    assert.equal(emailedStill.emailBody, "This emailed case stays as it is.");
    assert.equal(emailedStill.emailSentAt?.toISOString(), at("2026-09-03T12:00:00.000Z").toISOString());
    assert.deepEqual(emailedStill.photoPaths, ["kept.jpg"]);
    const emailedChoice = Array.isArray(emailedStill.notNeededLog) ? emailedStill.notNeededLog : [];
    assert.equal((emailedChoice.at(-1) as { action?: string }).action, "not_duplicate");
    const partnerEmailStill = await prisma.hhsrsSentEmail.findUniqueOrThrow({ where: { id: partnerEmail.id } });
    assert.equal(partnerEmailStill.subject, "Partner subject");
    assert.equal(partnerEmailStill.body, "This emailed case stays as it is.");
    assert.equal(partnerEmailStill.to, "repairs@savillshousing.co.uk");
    assert.equal(partnerEmailStill.kind, "original");

    const correctionPartner = await make(`Correction partner ${stamp}`, "2026-09-04T10:00:00.000Z", {
      emailSentAt: at("2026-09-04T12:00:00.000Z"),
      emailSubject: "Partner correction subject",
      emailBody: "The partner correction stays.",
    });
    const correctionButton = await make(`Correction button ${stamp}`, "2026-09-04T11:00:00.000Z", {
      notNeededDuplicateOf: correctionPartner.reference || "",
    });
    const correctionPartnerEmail = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: correctionPartner.id,
        sentAt: at("2026-09-04T12:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "HHSRS@savillshousing.co.uk",
        to: "repairs@savillshousing.co.uk",
        subject: "Partner correction subject",
        body: "The partner correction stays.",
        photoNames: [],
        kind: "correction",
      },
    });
    const clearedCorrectionPartner = await request(
      port,
      "POST",
      `/HHSRSreporter/duplicates/${correctionButton.id}/not-duplicate`,
      { cookie }
    );
    assert.equal(clearedCorrectionPartner.status, 302);
    cookie = cookieHeader(clearedCorrectionPartner.setCookie, cookie);
    const correctionPartnerBack = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({
      where: { id: correctionPartner.id },
    });
    const correctionButtonBack = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({
      where: { id: correctionButton.id },
    });
    assert.equal(correctionButtonBack.status, "new");
    assert.equal(correctionButtonBack.notADuplicate, true);
    assert.equal(correctionPartnerBack.status, "corrected");
    assert.equal(correctionPartnerBack.notADuplicate, true);
    assert.equal(correctionPartnerBack.emailSubject, "Partner correction subject");
    assert.equal(correctionPartnerBack.emailBody, "The partner correction stays.");
    assert.equal(correctionPartnerBack.emailSentAt?.toISOString(), at("2026-09-04T12:00:00.000Z").toISOString());
    const correctionPartnerEmailStill = await prisma.hhsrsSentEmail.findUniqueOrThrow({
      where: { id: correctionPartnerEmail.id },
    });
    assert.equal(correctionPartnerEmailStill.kind, "correction");
    assert.equal(correctionPartnerEmailStill.body, "The partner correction stays.");

    const clearedErrorLink = await request(
      port,
      "POST",
      `/HHSRSreporter/duplicates/${pointsAtError.id}/not-duplicate`,
      { cookie }
    );
    assert.equal(clearedErrorLink.status, 302);
    cookie = cookieHeader(clearedErrorLink.setCookie, cookie);
    const errorStill = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: errorCase.id } });
    const pointerBack = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: pointsAtError.id } });
    assert.equal(pointerBack.status, "new");
    assert.equal(pointerBack.notADuplicate, true);
    assert.equal(errorStill.status, "not_needed");
    assert.equal(errorStill.notNeededReason, "surveyor_error");
    assert.equal(errorStill.notADuplicate, false);
    assert.equal(errorStill.notNeededNote, "Wrong details.");

    const dupes = await request(port, "GET", `/HHSRSreporter/duplicates?q=${encodeURIComponent(stamp)}`, { cookie });
    cookie = cookieHeader(dupes.setCookie, cookie);
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${correctionCase.id}"`));
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${unsentPartner.id}"`));
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${unsentButton.id}"`));
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${emailedPartner.id}"`));
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${correctionPartner.id}"`));
    assert.doesNotMatch(dupes.body, new RegExp(`data-dup-id="${correctionButton.id}"`));
    assert.doesNotMatch(dupes.body, new RegExp(`Emailed partner ${stamp}`));
    assert.match(dupes.body, new RegExp(`Surveyor error ${stamp}`));
    assert.equal(
      await prisma.hhsrsSiteSubmission.count({
        where: {
          id: {
            in: [
              unsentPartner.id,
              correctionCase.id,
              emailedPartner.id,
              unsentButton.id,
              correctionPartner.id,
              correctionButton.id,
              errorCase.id,
              pointsAtError.id,
            ],
          },
        },
      }),
      8
    );
    const pending = await request(port, "GET", "/HHSRSreporter", { cookie });
    const waiting = pending.body.slice(pending.body.indexOf('id="waiting-table"'), pending.body.indexOf('id="last-actioned"'));
    const actioned = pending.body.slice(pending.body.indexOf('id="last-actioned"'));
    assert.match(waiting, new RegExp(`Unsent button ${stamp}`));
    assert.equal(waiting.includes(`Emailed partner ${stamp}`), false);
    assert.equal(waiting.includes(`Correction partner ${stamp}`), false);
    assert.match(actioned, new RegExp(`Emailed partner ${stamp}`));
    assert.match(actioned, new RegExp(`Correction partner ${stamp}`));
    const log = await request(
      port,
      "GET",
      `/HHSRSreporter/main-log?q=${encodeURIComponent(correctionCase.reference || "")}&open=${encodeURIComponent(`email:${correctionEmail.id}`)}`,
      { cookie }
    );
    assert.match(log.body, new RegExp(correctionCase.reference || "missing-correction"));
    assert.match(log.body, /The correction email stays\./);
    const partnerLog = await request(
      port,
      "GET",
      `/HHSRSreporter/main-log?q=${encodeURIComponent(emailedPartner.reference || "")}&open=${encodeURIComponent(`email:${partnerEmail.id}`)}`,
      { cookie }
    );
    assert.match(partnerLog.body, new RegExp(emailedPartner.reference || "missing-partner"));
    assert.match(partnerLog.body, /This emailed case stays as it is\./);
  });
});

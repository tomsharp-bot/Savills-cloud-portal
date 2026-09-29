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

  it("leaves an emailed case in the Main Log and still links the waiting cases to it", () => {
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
    assert.deepEqual(emailedLater, [
      { id: "earliest", duplicateOf: "MTVH-021", note: "Same UPRN as MTVH-021." },
    ]);

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
      {
        id: "also",
        duplicateOf: "MTVH-014",
        note: "Same UPRN as MTVH-014 and MTVH-021.",
      },
      {
        id: "waiting",
        duplicateOf: "MTVH-014",
        note: "Same UPRN as MTVH-014 and MTVH-022.",
      },
    ]);
    assert.equal(emailedEarliest.some((move) => move.id === "sent-first"), false);
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

function cookieHeader(setCookie: string[]): string {
  return setCookie.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
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
      rating: "Severe",
      comment: "Later report at a different address.",
      suspectedCause: "",
      clientCallReference: "",
      otherDetails: "",
      cat1Confirmed: false,
      callUnreached: false,
      callRefBlankReason: "",
      callUnreachedNote: "",
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
    assert.equal(repeatRow.notNeededNote, `Same UPRN as ${logged.reference}.`);
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
    assert.match(page.body, new RegExp(latest.reference || "missing-latest"));
    assert.match(page.body, new RegExp(`12 High Street ${stamp}`));
    assert.match(page.body, new RegExp(`Flat 4, 88 Other Road ${stamp}`));
    assert.match(page.body, /Same UPRN as /);
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
});

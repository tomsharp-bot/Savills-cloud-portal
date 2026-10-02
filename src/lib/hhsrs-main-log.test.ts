import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { prisma } from "./prisma.js";
import { createApp } from "../app.js";
import {
  arrangeMainLog,
  buildMainLogWorkbook,
  describeMainLogFilters,
  loadMainLog,
  mainLogEmailKind,
  mainLogEmailWhere,
  mainLogNotSentWhere,
  parseMainLogFilters,
  addressFirstLine,
  splitAddress,
  type MainLogEntry,
  type MainLogFilters,
} from "./hhsrs-main-log.js";

process.env.DATABASE_URL ||= "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

const blankFilters = (patch: Partial<MainLogFilters> = {}): MainLogFilters => ({
  q: "",
  project: "",
  by: "",
  type: "",
  from: "",
  to: "",
  sort: "" as const,
  dir: "asc" as const,
  page: 1,
  open: "",
  pageGiven: false,
  ...patch,
});

function sortItem(
  key: string,
  kind: "original" | "correction" | "not_sent",
  at: string,
  correctsKey: string | null = null,
  extra: Record<string, string | number> = {}
) {
  return { key, kind, at: new Date(at).getTime(), correctsKey, ...extra };
}

describe("HHSRS main log arrangement", () => {
  it("keeps an amended case on one row, newest activity first", () => {
    const items = [
      sortItem("email:orig", "original", "2026-09-24T13:32:00.000Z"),
      sortItem("email:corr", "correction", "2026-09-25T09:12:00.000Z", "email:orig"),
      sortItem("email:again", "correction", "2026-09-26T09:12:00.000Z", "email:orig"),
      sortItem("email:new", "original", "2026-09-28T08:42:00.000Z"),
      sortItem("case:quiet", "not_sent", "2026-09-23T10:00:00.000Z"),
    ];
    const arranged = arrangeMainLog(items, new Set(["email:orig"]), 1, 50);
    assert.deepEqual(arranged.pageKeys, ["email:new", "email:orig", "case:quiet"]);
    assert.equal(arranged.pageKeys.includes("email:corr"), false);
    assert.equal(arranged.pageKeys.includes("email:again"), false);
    assert.equal(arranged.flags.get("email:orig")?.showCorrectedNote, true);
    assert.equal(arranged.flags.get("email:orig")?.hasCorrBelow, false);
    assert.equal(arranged.flags.get("email:new")?.showCorrectedNote, false);
    assert.equal(arranged.total, 3);
  });

  it("counts an amended case as one row when paging", () => {
    const items = [
      sortItem("email:a", "original", "2026-09-28T08:00:00.000Z"),
      sortItem("email:b", "original", "2026-09-24T08:00:00.000Z"),
      sortItem("email:c", "correction", "2026-09-25T08:00:00.000Z", "email:b"),
      sortItem("email:d", "correction", "2026-09-26T08:00:00.000Z", "email:b"),
    ];
    const arranged = arrangeMainLog(items, new Set(["email:b"]), 1, 2);
    assert.deepEqual(arranged.pageKeys, ["email:a", "email:b"]);
    assert.equal(arranged.total, 2);
    assert.equal(arranged.pageCount, 1);
    assert.equal(arranged.flags.get("email:b")?.showCorrectedNote, true);
    assert.equal(arranged.flags.get("email:b")?.hasCorrBelow, false);
  });

  it("keeps one row when the filter only matches corrections", () => {
    const items = [
      sortItem("email:c1", "correction", "2026-09-25T08:00:00.000Z", "email:missing"),
      sortItem("email:c2", "correction", "2026-09-26T08:00:00.000Z", "email:missing"),
    ];
    const arranged = arrangeMainLog(items, new Set(), 1, 50);
    assert.deepEqual(arranged.pageKeys, ["email:c2"]);
    assert.equal(arranged.flags.get("email:c2")?.showCorrectedNote, true);
    assert.equal(arranged.total, 1);
  });

  it("keeps one row when the correction link is missing but both sends are the same case", () => {
    const items = [
      sortItem("email:orig", "original", "2026-09-24T13:32:00.000Z", null, { caseKey: "case-1" }),
      sortItem("email:amend", "correction", "2026-09-25T09:12:00.000Z", null, { caseKey: "case-1" }),
      sortItem("email:other", "original", "2026-09-28T08:42:00.000Z", null, { caseKey: "case-2" }),
    ];
    const arranged = arrangeMainLog(items, new Set(), 1, 50);
    assert.deepEqual(arranged.pageKeys, ["email:other", "email:orig"]);
    assert.equal(arranged.pageKeys.includes("email:amend"), false);
    assert.equal(arranged.flags.get("email:orig")?.showCorrectedNote, true);
    assert.equal(arranged.flags.get("email:other")?.showCorrectedNote, false);
    assert.equal(arranged.total, 2);
    const sorted = arrangeMainLog(items, new Set(), 1, 50, { key: "sent", dir: "desc" });
    assert.deepEqual(sorted.pageKeys, ["email:other", "email:orig"]);
    assert.equal(sorted.flags.get("email:orig")?.showCorrectedNote, true);
  });

  it("keeps one row when a later correction points at the previous correction", () => {
    const items = [
      sortItem("email:orig", "original", "2026-09-24T13:32:00.000Z", null, { caseKey: "case-1" }),
      sortItem("email:first", "correction", "2026-09-25T09:12:00.000Z", "email:orig", { caseKey: "case-1" }),
      sortItem("email:second", "correction", "2026-09-26T09:12:00.000Z", "email:first", { caseKey: "case-1" }),
    ];
    const arranged = arrangeMainLog(items, new Set(), 1, 50);
    assert.deepEqual(arranged.pageKeys, ["email:orig"]);
    assert.equal(arranged.flags.get("email:orig")?.showCorrectedNote, true);
    assert.equal(arranged.total, 1);
  });

  it("keeps one row when the amendment was stored as another original on the same case", () => {
    const items = [
      sortItem("email:orig", "original", "2026-09-24T13:32:00.000Z", null, { caseKey: "case-1" }),
      sortItem("email:again", "original", "2026-09-25T09:12:00.000Z", null, { caseKey: "case-1" }),
    ];
    const arranged = arrangeMainLog(items, new Set(), 1, 50);
    assert.deepEqual(arranged.pageKeys, ["email:orig"]);
    assert.equal(arranged.flags.get("email:orig")?.showCorrectedNote, true);
    assert.equal(arranged.total, 1);
  });

  it("does not merge corrections that belong to different cases", () => {
    const items = [
      sortItem("email:a", "original", "2026-09-24T08:00:00.000Z", null, { caseKey: "case-a" }),
      sortItem("email:b", "correction", "2026-09-25T08:00:00.000Z", null, { caseKey: "case-b" }),
    ];
    const arranged = arrangeMainLog(items, new Set(), 1, 50);
    assert.deepEqual(arranged.pageKeys, ["email:b", "email:a"]);
    assert.equal(arranged.flags.get("email:b")?.showCorrectedNote, true);
    assert.equal(arranged.flags.get("email:a")?.showCorrectedNote, false);
  });

  it("treats a correction subject or a stored link as a correction", () => {
    assert.equal(mainLogEmailKind({ kind: "original", subject: "HHSRS hazard" }), "original");
    assert.equal(mainLogEmailKind({ kind: "correction", correctsEmailId: null }), "correction");
    assert.equal(mainLogEmailKind({ kind: "original", correctsEmailId: null, subject: "CORRECTION: HHSRS hazard" }), "correction");
    assert.equal(mainLogEmailKind({ kind: "original", correctsEmailId: "email-1", subject: "HHSRS hazard" }), "correction");
  });

  it("drops not-sent rows from an original-only filter and corrections from a not-sent filter", () => {
    assert.equal(mainLogEmailWhere(blankFilters({ type: "not_sent" })), null);
    assert.equal(mainLogNotSentWhere(blankFilters({ type: "original" })), null);
    assert.equal(mainLogNotSentWhere(blankFilters({ type: "correction" })), null);
    const emails = mainLogEmailWhere(blankFilters({ type: "correction", q: "Moor", from: "2026-09-25", to: "2026-09-25" }));
    assert.equal(emails?.kind, "correction");
    assert.ok(emails?.sentAt);
    const cases = mainLogNotSentWhere(blankFilters({ type: "not_sent", by: "Alex Surveyor" }));
    assert.match(JSON.stringify(cases), /sentEmails/);
    assert.match(JSON.stringify(cases), /Alex Surveyor/);
  });

  it("keeps the default order until a column is chosen", () => {
    const filters = parseMainLogFilters({ sort: "postcode", dir: "desc" });
    assert.equal(filters.sort, "");
    assert.equal(parseMainLogFilters({ sort: "project", dir: "DESC" }).dir, "desc");
    assert.equal(parseMainLogFilters({ sort: "sent" }).dir, "asc");
    const items = [
      sortItem("email:orig", "original", "2026-09-28T08:00:00.000Z", null, { project: "Zebra", by: "Zoe" }),
      sortItem("email:corr", "correction", "2026-09-24T08:00:00.000Z", "email:orig", { project: "Zebra", by: "Amy" }),
      sortItem("email:other", "original", "2026-09-25T08:00:00.000Z", null, { project: "Alpha", by: "Sam" }),
    ];
    const arranged = arrangeMainLog(items, new Set(["email:orig"]), 1, 50);
    assert.deepEqual(arranged.pageKeys, ["email:orig", "email:other"]);
    assert.equal(arranged.flags.get("email:orig")?.showCorrectedNote, true);
    const sorted = arrangeMainLog(items, new Set(["email:orig"]), 1, 50, { key: "by", dir: "asc" });
    assert.deepEqual(sorted.pageKeys, ["email:other", "email:orig"]);
    assert.equal(sorted.flags.get("email:orig")?.showCorrectedNote, true);
    assert.equal(sorted.pageKeys.includes("email:corr"), false);
  });

  it("sorts sent as a real date, not as dd/mm text, and reverses on the other direction", () => {
    const items = [
      sortItem("email:oct", "original", "2026-10-01T08:00:00.000Z"),
      sortItem("email:sep", "original", "2026-09-28T08:00:00.000Z"),
    ];
    const asc = arrangeMainLog(items, new Set(), 1, 50, { key: "sent", dir: "asc" });
    const desc = arrangeMainLog(items, new Set(), 1, 50, { key: "sent", dir: "desc" });
    assert.deepEqual(asc.pageKeys, ["email:sep", "email:oct"]);
    assert.deepEqual(desc.pageKeys, ["email:oct", "email:sep"]);
  });

  it("sorts each visible column and keeps blanks and larger numbers in the right place", () => {
    const items = [
      sortItem("email:a", "original", "2026-09-28T08:00:00.000Z", null, {
        project: "Zebra",
        ref: "MTVH-10",
        uprn: "200",
        address: "Zebra Road",
        hazard: "Falls",
        rating: "Moderate",
        by: "Zoe",
        to: "z@example.com",
        photos: 10,
        typeLabel: "Original",
      }),
      sortItem("email:b", "original", "2026-09-24T08:00:00.000Z", null, {
        project: "Alpha",
        ref: "MTVH-2",
        uprn: "20",
        address: "Alpha Road",
        hazard: "Damp",
        rating: "High",
        by: "Amy",
        to: "",
        photos: 2,
        typeLabel: "Correction",
      }),
      sortItem("case:c", "not_sent", "2026-09-26T08:00:00.000Z", null, {
        project: "",
        ref: "",
        uprn: "",
        address: "",
        hazard: "",
        rating: "",
        by: "",
        to: "m@example.com",
        photos: 0,
        typeLabel: "Not sent from portal",
      }),
    ];
    const project = arrangeMainLog(items, new Set(), 1, 50, { key: "project", dir: "asc" });
    assert.deepEqual(project.pageKeys, ["email:b", "email:a", "case:c"]);
    const projectDesc = arrangeMainLog(items, new Set(), 1, 50, { key: "project", dir: "desc" });
    assert.deepEqual(projectDesc.pageKeys, ["case:c", "email:a", "email:b"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "by", dir: "asc" }).pageKeys, ["email:b", "email:a", "case:c"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "by", dir: "desc" }).pageKeys, ["case:c", "email:a", "email:b"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "ref", dir: "asc" }).pageKeys, ["email:b", "email:a", "case:c"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "uprn", dir: "asc" }).pageKeys, ["email:b", "email:a", "case:c"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "address", dir: "asc" }).pageKeys, ["email:b", "email:a", "case:c"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "hazard", dir: "asc" }).pageKeys, ["email:b", "email:a", "case:c"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "rating", dir: "asc" }).pageKeys, ["email:b", "email:a", "case:c"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "to", dir: "asc" }).pageKeys, ["case:c", "email:a", "email:b"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "to", dir: "desc" }).pageKeys, ["email:b", "email:a", "case:c"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "photos", dir: "asc" }).pageKeys, ["case:c", "email:b", "email:a"]);
    assert.deepEqual(arrangeMainLog(items, new Set(), 1, 50, { key: "type", dir: "asc" }).pageKeys, ["email:b", "case:c", "email:a"]);
    const page = arrangeMainLog(items, new Set(), 2, 1, { key: "project", dir: "asc" });
    assert.deepEqual(page.pageKeys, ["email:a"]);
    assert.equal(page.pageCount, 3);
  });

  it("keeps the postcode out of the table line and in the full address", () => {
    const split = splitAddress("Flat 5, 40 Fictional Way, Sampleton, ZZ1 3GH", "ZZ1 3GH");
    assert.equal(split.line, "Flat 5, 40 Fictional Way, Sampleton");
    assert.equal(split.full, "Flat 5, 40 Fictional Way, Sampleton, ZZ1 3GH");
    assert.equal(addressFirstLine(split.full), "Flat 5, 40 Fictional Way");
    assert.equal(addressFirstLine("12 Laburnum Crescent, London SE5 8AB"), "12 Laburnum Crescent");
    assert.equal(addressFirstLine("12, Moor Cross, Bude, EX23 9EH"), "12, Moor Cross");
    assert.equal(addressFirstLine("3, A, New Road, Bude"), "3, A, New Road");
    assert.equal(addressFirstLine("G12, Quay Street, Bude, EX23 8JZ"), "G12, Quay Street");
    assert.equal(addressFirstLine("3 Peregrine Road"), "3 Peregrine Road");
    assert.equal(addressFirstLine("12, EX23 9EH"), "12");
    assert.equal(addressFirstLine("  "), "");
    assert.match(describeMainLogFilters(blankFilters({ type: "not_sent", q: "Moor" }), 1), /Not sent from portal/);
    assert.match(describeMainLogFilters(blankFilters({ q: "Moor" }), 1), /“Moor”/);
  });
});

function excelEntry(patch: Partial<MainLogEntry> & Pick<MainLogEntry, "key" | "kind">): MainLogEntry {
  return {
    at: new Date("2026-09-24T13:32:00.000Z"),
    reference: "MTVH-011",
    projectName: "MTVH 2026",
    uprn: "100000120011",
    lineAddress: "Flat 3, 40 Fictional Way, Sampleton",
    fullAddress: "Flat 3, 40 Fictional Way, Sampleton, ZZ1 3GH",
    postcode: "ZZ1 3GH",
    hazard: "Falling On Stairs Etc.",
    rating: "High - Emergency Risk",
    surveyorName: "Jane Example",
    createdAt: new Date("2026-09-20T09:00:00.000Z"),
    sentBy: "Carly Farrell",
    to: "repairs@savillshousing.co.uk",
    cc: "",
    bcc: "",
    from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
    subject: "HHSRS hazard",
    body: "Original body",
    photoNames: ["stair.jpg"],
    photoCount: 1,
    submissionId: "sub",
    photoPaths: [],
    correctionReason: "",
    correctionNote: "",
    correctsKey: null,
    originalSentAt: null,
    corrections: [],
    ...patch,
  };
}

describe("HHSRS main log workbook", () => {
  it("writes the example headers, freezes them, and shades corrections", async () => {
    const filters = blankFilters({ project: "MTVH 2026", type: "original" });
    const file = await buildMainLogWorkbook({
      entries: [
        excelEntry({ key: "email:a", kind: "original" }),
        excelEntry({
          key: "email:b",
          kind: "correction",
          at: new Date("2026-09-25T09:12:00.000Z"),
          originalSentAt: new Date("2026-09-24T13:32:00.000Z"),
          correctionReason: "Wrong address",
          correctionNote: "Flat number was 5, not 3.",
          subject: "CORRECTION: HHSRS hazard",
          body: "Please use the new address",
          sentBy: "Tom Sharp",
        }),
      ],
      filters,
      exportedBy: "Tom Sharp",
      exportedAt: new Date("2026-09-28T09:30:00.000Z"),
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("Main Log");
    assert.ok(sheet);
    assert.equal(sheet.getRow(1).getCell(1).value, "HHSRS Main Log export");
    assert.match(String(sheet.getRow(2).getCell(1).value), /Exported .* by Tom Sharp/);
    assert.match(String(sheet.getRow(2).getCell(1).value), /MTVH 2026/);
    assert.match(String(sheet.getRow(2).getCell(1).value), /Original/);
    const headers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map(
      (col) => sheet.getRow(4).getCell(col).value
    );
    assert.deepEqual(headers, [
      "Sent date",
      "Sent time",
      "Ref",
      "Type",
      "Correction of",
      "Reason",
      "Note",
      "Project",
      "UPRN",
      "Address",
      "Postcode",
      "Hazard",
      "Rating",
      "Sent by",
      "From",
      "To",
      "Cc",
      "Bcc",
      "Subject",
      "Photos",
      "Photo names",
      "Email text",
    ]);
    assert.equal(sheet.getRow(5).getCell(4).value, "Original");
    assert.equal(sheet.getRow(5).getCell(10).value, "Flat 3, 40 Fictional Way, Sampleton");
    assert.equal(sheet.getRow(5).getCell(11).value, "ZZ1 3GH");
    assert.equal(sheet.getRow(5).getCell(15).value, "hhsrs@savillshousing.co.uk");
    assert.equal(sheet.getRow(6).getCell(4).value, "Correction");
    assert.equal(sheet.getRow(6).getCell(6).value, "Wrong address");
    assert.match(String(sheet.getRow(6).getCell(5).value), /24\/09\/2026 14:32/);
    const fill = sheet.getRow(6).getCell(1).fill;
    assert.equal(fill.type, "pattern");
    if (fill.type === "pattern") assert.equal(fill.fgColor?.argb, "FFFEF3C7");
    const headerFill = sheet.getRow(4).getCell(1).fill;
    assert.equal(headerFill.type, "pattern");
    if (headerFill.type === "pattern") assert.equal(headerFill.fgColor?.argb, "FF0B1F3A");
    assert.equal(sheet.views[0]?.state, "frozen");
    assert.equal(sheet.views[0] && "ySplit" in sheet.views[0] ? sheet.views[0].ySplit : 0, 4);
    assert.equal(sheet.rowCount, 6);
  });
});

async function dbReady(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function request(
  app: ReturnType<typeof createApp>,
  method: string,
  url: string,
  opts: { cookie?: string; body?: string } = {}
): Promise<{ status: number; location: string; body: Buffer; contentType: string; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const headers: Record<string, string | number> = {};
      if (opts.cookie) headers.cookie = opts.cookie;
      if (opts.body) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        headers["content-length"] = Buffer.byteLength(opts.body);
      }
      const req = http.request({ host: "127.0.0.1", port, path: url, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          server.close();
          resolve({
            status: res.statusCode || 0,
            location: String(res.headers.location || ""),
            body: Buffer.concat(chunks),
            contentType: String(res.headers["content-type"] || ""),
            setCookie: ([] as string[]).concat(res.headers["set-cookie"] || []),
          });
        });
      });
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end(opts.body);
    });
  });
}

describe("HHSRS main log filters", () => {
  it("filters live rows, keeps cases that were not sent, and exports only the filter", async (t) => {
    if (!(await dbReady())) {
      t.skip("Postgres is not available");
      return;
    }
    const stamp = `log${Date.now().toString().slice(-7)}`;
    const project = await prisma.project.create({
      data: { name: `Log ${stamp}`, projectManager: "Test", hhsrsCode: "LOGX" },
    });
    const sentCase = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectId: project.id,
        projectName: project.name,
        reference: `${stamp}-1`,
        surveyDate: "2026-09-23",
        uprn: `${stamp}01`,
        fullAddress: `Flat 3, 40 ${stamp} Way`,
        postcode: "ZZ1 3GH",
        surveyorName: "Jane Example",
        category: "Falling On Stairs Etc.",
        rating: "High - Emergency Risk",
        comment: stamp,
        photoPaths: [`hhsrs-site-form/x/${stamp}.jpg`],
        status: "corrected",
        emailSentAt: new Date("2026-09-24T13:32:00.000Z"),
        emailSentBy: "Carly Farrell",
      },
    });
    const quiet = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectId: project.id,
        projectName: project.name,
        reference: `${stamp}-2`,
        surveyDate: "2026-09-22",
        uprn: `${stamp}02`,
        fullAddress: `9 ${stamp} Mews`,
        postcode: "ZZ8 9QR",
        surveyorName: "Jane Example",
        category: "Excess Cold",
        rating: "Moderate",
        comment: stamp,
        photoPaths: [],
        status: "email_sent",
        emailSentAt: new Date("2026-09-23T10:00:00.000Z"),
        emailSentBy: "Alex Surveyor",
        emailSubject: "Prepared but not sent",
        emailBody: "Draft only",
      },
    });
    const original = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: sentCase.id,
        sentAt: new Date("2026-09-24T13:32:00.000Z"),
        sentBy: "Carly Farrell",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "HHSRS hazard",
        body: "Original body stays",
        photoNames: [`${stamp}.jpg`],
        kind: "original",
      },
    });
    const correction = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: sentCase.id,
        sentAt: new Date("2026-09-25T09:12:00.000Z"),
        sentBy: "Tom Sharp",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "CORRECTION: HHSRS hazard",
        body: "Use flat 5",
        photoNames: [`${stamp}.jpg`],
        kind: "correction",
        correctionReason: "Wrong address",
        correctionNote: "Flat number was 5, not 3.",
        correctsEmailId: original.id,
      },
    });
    const unlinked = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: sentCase.id,
        sentAt: new Date("2026-09-25T08:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "CORRECTION: HHSRS hazard",
        body: "Unlinked amendment",
        photoNames: [`${stamp}.jpg`],
        kind: "correction",
        correctionReason: "Wrong details",
        correctionNote: "The link was not stored.",
        correctsEmailId: null,
      },
    });
    const mislabeled = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: sentCase.id,
        sentAt: new Date("2026-09-27T11:00:00.000Z"),
        sentBy: "Tom Sharp",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@savillshousing.co.uk",
        subject: "CORRECTION: HHSRS hazard",
        body: "Stored as another original",
        photoNames: [`${stamp}.jpg`],
        kind: "original",
        correctsEmailId: null,
      },
    });
    t.after(async () => {
      await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: [sentCase.id, quiet.id] } } });
      await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: [sentCase.id, quiet.id] } } });
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    });

    const all = await loadMainLog({ q: stamp });
    assert.deepEqual(all.entries.map((row) => row.key), [`email:${original.id}`, `case:${quiet.id}`]);
    assert.equal(all.total, 2);
    assert.equal(all.entries[0].lineAddress.includes("ZZ1"), false);
    assert.equal(all.flags.get(`email:${original.id}`)?.showCorrectedNote, true);
    assert.equal(all.flags.get(`email:${correction.id}`)?.showCorrectedNote, undefined);
    assert.equal(all.entries.some((row) => row.key === `email:${unlinked.id}`), false);
    assert.equal(all.entries.some((row) => row.key === `email:${mislabeled.id}`), false);

    const originalDay = await loadMainLog({ q: stamp, from: "2026-09-24", to: "2026-09-24" });
    assert.deepEqual(originalDay.entries.map((row) => row.key), [`email:${original.id}`]);
    assert.equal(originalDay.flags.get(`email:${original.id}`)?.showCorrectedNote, true);

    const corrections = await loadMainLog({ q: stamp, type: "correction" });
    assert.deepEqual(corrections.entries.map((row) => row.kind), ["correction"]);
    assert.match(corrections.entries[0] ? `${corrections.entries[0].correctionReason}` : "", /Wrong address/);

    const quietOnly = await loadMainLog({ q: stamp, type: "not_sent" });
    assert.deepEqual(quietOnly.entries.map((row) => row.kind), ["not_sent"]);
    assert.equal(quietOnly.entries[0]?.sentBy, "Alex Surveyor");

    const day = await loadMainLog({ q: stamp, from: "2026-09-25", to: "2026-09-25" });
    assert.deepEqual(day.entries.map((row) => row.key), [`email:${correction.id}`]);
    assert.equal(day.flags.get(`email:${correction.id}`)?.showCorrectedNote, true);

    const byName = await loadMainLog({ q: stamp, sort: "by", dir: "asc" });
    assert.deepEqual(byName.entries.map((row) => row.sentBy), ["Alex Surveyor", "Carly Farrell"]);
    const byNameDesc = await loadMainLog({ q: stamp, sort: "by", dir: "desc" });
    assert.deepEqual(byNameDesc.entries.map((row) => row.sentBy), ["Carly Farrell", "Alex Surveyor"]);
    const oldest = await loadMainLog({ q: stamp, sort: "sent", dir: "asc" });
    assert.deepEqual(oldest.entries.map((row) => row.key), [`case:${quiet.id}`, `email:${original.id}`]);
    const newest = await loadMainLog({ q: stamp, sort: "sent", dir: "desc" });
    assert.deepEqual(newest.entries.map((row) => row.key), [`email:${original.id}`, `case:${quiet.id}`]);

    const app = createApp({ basePath: "" });
    const login = await request(app, "POST", "/login", {
      body: "username=phil.m&password=PhilMoon2468",
    });
    assert.equal(login.status, 302);
    const cookie = login.setCookie.map((item) => item.split(";")[0]).join("; ");
    const page = await request(app, "GET", `/HHSRSreporter/main-log?q=${stamp}&open=email:${correction.id}`, { cookie });
    const html = page.body.toString("utf8");
    assert.equal(page.status, 200);
    assert.match(html, /Not sent from portal/);
    assert.match(html, /Correction of email sent 24\/09\/2026 14:32/);
    assert.match(html, /Reason: Wrong address/);
    assert.match(html, /View original email/);
    assert.doesNotMatch(html, /View pack/);
    assert.match(html, /Open case/);
    assert.match(html, new RegExp(`Flat 5|Use flat 5|${stamp}`));
    assert.doesNotMatch(html, new RegExp(`>${stamp} Way, ZZ1`));
    assert.match(html, /Export to Excel/);
    assert.doesNotMatch(html, /Export CSV/);
    assert.doesNotMatch(html, /Mock/);
    assert.doesNotMatch(html, /is-sorted/);
    assert.match(html, new RegExp(`href="/HHSRSreporter/main-log\\?q=${stamp}&amp;sort=project&amp;dir=asc"`));
    assert.match(html, new RegExp(`href="/HHSRSreporter/main-log\\?q=${stamp}&amp;sort=received&amp;dir=asc"`));
    assert.match(html, new RegExp(`href="/HHSRSreporter/main-log\\?q=${stamp}&amp;sort=surveyor&amp;dir=asc"`));
    assert.match(html, />Reference</);
    assert.doesNotMatch(html, /<th>Sent<\/th>|<th>Hazard<\/th>/);
    const table = html.slice(html.indexOf('id="main-log-table"'));
    const tbody = table.slice(table.indexOf("<tbody>"), table.indexOf("</tbody>"));
    assert.equal((tbody.match(/<tr/g) || []).length, 2);
    assert.equal((tbody.match(/Amended/g) || []).length, 1);
    assert.doesNotMatch(tbody, /Use flat 5/);
    assert.match(table, />Actioned</);
    assert.match(table, />By</);
    assert.match(tbody, /<td class="col-actioned ml-actioned"><b>24\/09\/2026<\/b><\/td>/);
    assert.match(tbody, /<td class="col-by ml-actioned-by"><b>Carly Farrell<\/b><\/td>/);
    assert.match(tbody, /<td class="col-by ml-actioned-by"><b>Alex Surveyor<\/b><\/td>/);
    assert.match(tbody, /<strong>Flat 3, 40 /);
    assert.match(tbody, /class="ml-addr-full">Flat 3, 40 /);
    assert.doesNotMatch(tbody, /<strong>Flat 3<\/strong>/);

    const detailsPage = await request(app, "GET", `/HHSRSreporter/main-log/${sentCase.id}/details`, { cookie });
    assert.equal(detailsPage.status, 200);
    const detailsHtml = detailsPage.body.toString("utf8");
    const surveyor = detailsHtml.slice(detailsHtml.indexOf("Surveyor entry"), detailsHtml.indexOf("Email sent"));
    const sentCard = detailsHtml.slice(detailsHtml.indexOf("Email sent"), detailsHtml.indexOf(">Correction<"));
    const correctionCard = detailsHtml.slice(detailsHtml.indexOf(">Correction<"));
    assert.match(surveyor, /Survey date 23\/09\/2026/);
    assert.doesNotMatch(surveyor, /25\/09\/2026 10:12/);
    assert.match(sentCard, /24\/09\/2026 14:32/);
    assert.doesNotMatch(sentCard, /25\/09\/2026 10:12/);
    assert.match(correctionCard, /25\/09\/2026 10:12/);
    assert.match(correctionCard, /Use flat 5/);

    const sorted = await request(app, "GET", `/HHSRSreporter/main-log?q=${stamp}&sort=project&dir=asc`, { cookie });
    const sortedHtml = sorted.body.toString("utf8");
    assert.equal(sorted.status, 200);
    assert.match(sortedHtml, /aria-sort="ascending"/);
    assert.match(sortedHtml, /class="col-proj is-sorted"/);
    assert.match(sortedHtml, /Sorted A to Z\. Click to reverse\./);
    assert.match(sortedHtml, /▲/);
    assert.match(sortedHtml, new RegExp(`href="/HHSRSreporter/main-log\\?q=${stamp}&amp;sort=project&amp;dir=desc"`));
    assert.match(sortedHtml, new RegExp(`href="/HHSRSreporter/main-log\\?q=${stamp}&amp;sort=received&amp;dir=asc"`));
    const projectTh = sortedHtml.match(/<th class="col-proj is-sorted"[\s\S]*?<\/th>/);
    assert.ok(projectTh);
    assert.match(projectTh[0], />Project<span class="ml-sort-ind"/);

    const newestPage = await request(app, "GET", `/HHSRSreporter/main-log?q=${stamp}&sort=received&dir=desc`, { cookie });
    const newestHtml = newestPage.body.toString("utf8");
    assert.match(newestHtml, /aria-sort="descending"/);
    assert.match(newestHtml, /Sorted newest first\. Click to reverse\./);
    assert.match(newestHtml, /▼/);
    assert.match(newestHtml, new RegExp(`href="/HHSRSreporter/main-log\\?q=${stamp}&amp;sort=received&amp;dir=asc"`));

    const file = await request(app, "GET", `/HHSRSreporter/main-log/export.xlsx?q=${stamp}&type=correction`, { cookie });
    assert.equal(file.status, 200);
    assert.match(file.contentType, /spreadsheetml/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("Main Log");
    assert.ok(sheet);
    assert.equal(sheet.getRow(4).getCell(1).value, "Sent date");
    assert.equal(sheet.rowCount, 5);
    assert.equal(sheet.getRow(5).getCell(4).value, "Correction");
    assert.equal(sheet.getRow(5).getCell(3).value, `${stamp}-1`);
    assert.doesNotMatch(JSON.stringify(sheet.getRow(5).values), new RegExp(`${stamp}-2`));
    const quietFile = await request(app, "GET", `/HHSRSreporter/main-log/export.xlsx?q=${stamp}&type=not_sent`, { cookie });
    const quietBook = new ExcelJS.Workbook();
    await quietBook.xlsx.load(quietFile.body as unknown as ExcelJS.Buffer);
    const quietSheet = quietBook.getWorksheet("Main Log");
    assert.equal(quietSheet?.getRow(5).getCell(4).value, "Not sent from portal");
    assert.equal(quietSheet?.rowCount, 5);

    const allFile = await request(app, "GET", `/HHSRSreporter/main-log/export.xlsx?q=${stamp}`, { cookie });
    const allBook = new ExcelJS.Workbook();
    await allBook.xlsx.load(allFile.body as unknown as ExcelJS.Buffer);
    const allSheet = allBook.getWorksheet("Main Log");
    assert.equal(allSheet?.rowCount, 6);
    assert.equal(allSheet?.getRow(5).getCell(4).value, "Original");
    assert.equal(allSheet?.getRow(5).getCell(7).value, "Amended");
    assert.equal(allSheet?.getRow(6).getCell(4).value, "Not sent from portal");
    assert.doesNotMatch(JSON.stringify(allSheet?.getRow(6).values), /Use flat 5/);
  });
});

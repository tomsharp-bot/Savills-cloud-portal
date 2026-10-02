import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { HHSRS_WAITING_STATUSES } from "./hhsrs-reporter.js";
import {
  PENDING_ISSUE_LIST_LIMIT,
  mergePendingDuplicates,
  pendingDuplicateListArgs,
  pendingIssueListArgs,
  withoutOpenCase,
} from "./hhsrs-pending-list.js";
import { prisma } from "./prisma.js";
import { createApp } from "../app.js";

process.env.DATABASE_URL ||= "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

describe("pending issue list query", () => {
  it("uses the waiting statuses and the same cap Pending already used", () => {
    const args = pendingIssueListArgs();
    assert.deepEqual(args.where.status.in, ["new", "in_review", "email_ready"]);
    assert.deepEqual([...HHSRS_WAITING_STATUSES], args.where.status.in);
    assert.equal((args.where.status.in as readonly string[]).includes("email_sent"), false);
    assert.deepEqual(args.orderBy, { createdAt: "desc" });
    assert.equal(args.take, 200);
    assert.equal(PENDING_ISSUE_LIST_LIMIT, 200);
    assert.equal("reference" in args.where, false);
    assert.equal("projectName" in args.where, false);
    assert.equal("claimedBy" in args.where, false);
  });

  it("drops only the case that is open, after the shared window is loaded", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.deepEqual(withoutOpenCase(rows, "b"), [{ id: "a" }, { id: "c" }]);
    assert.deepEqual(withoutOpenCase(rows), rows);
    assert.deepEqual(withoutOpenCase(rows, "missing"), rows);
  });

  it("does not cap Review and create at 12 rows", () => {
    const route = readFileSync("src/routes/hhsrs-reporter.ts", "utf8");
    assert.equal(route.match(/pendingIssueListArgs\(\)/g)?.length, 3);
    assert.equal(route.match(/pendingDuplicateListArgs\(\)/g)?.length, 1);
    assert.equal(route.match(/mergePendingDuplicates\(/g)?.length, 1);
    assert.doesNotMatch(route, /take:\s*12/);
  });

  it("adds duplicate filings to Pending without changing the waiting query", () => {
    const dupes = pendingDuplicateListArgs();
    assert.equal(dupes.where.status, "not_needed");
    assert.equal(dupes.where.notNeededReason, "duplicate");
    assert.equal("take" in dupes, false);
    const waiting = pendingIssueListArgs();
    assert.deepEqual([...waiting.where.status.in], ["new", "in_review", "email_ready"]);
    assert.equal(waiting.take, 200);

    const older = new Date("2026-09-01T00:00:00.000Z");
    const newer = new Date("2026-09-02T00:00:00.000Z");
    const merged = mergePendingDuplicates(
      [{ id: "waiting", createdAt: newer }],
      [
        { id: "dupe", createdAt: older },
        { id: "waiting", createdAt: newer },
      ]
    );
    assert.deepEqual(
      merged.map((row) => ({ id: row.id, pendingDupe: row.pendingDupe })),
      [
        { id: "waiting", pendingDupe: false },
        { id: "dupe", pendingDupe: true },
      ]
    );
  });

  it("puts Dupe after the UPRN on the Pending table only", () => {
    const table = readFileSync("views/hhsrs-reporter/partials/pending-issues-table.ejs", "utf8");
    const css = readFileSync("public/css/hhsrs-reporter.css", "utf8");
    const uprnCell = table.slice(table.indexOf('td class="col-uprn"'), table.indexOf('td class="col-surv"'));
    const addressCell = table.slice(table.indexOf("addr-cell"), table.indexOf("photo-att-cell"));
    assert.match(uprnCell, /row\.pendingDupe/);
    assert.match(uprnCell, /pending-dupe-tag">Dupe</);
    assert.doesNotMatch(addressCell, /pendingDupe|Dupe/);
    assert.doesNotMatch(table, /<th[^>]*>\s*Dupe\s*</);
    const rule = css.slice(css.indexOf("tr.pending-dupe"), css.indexOf(".pending-dupe-tag") + 180);
    assert.match(rule, /#waiting-table/);
    assert.match(rule, /#ffb347/);
    assert.doesNotMatch(rule, /#last-actioned|#main-log|rv-also/);
  });
});

type Hit = { status: number; body: string; setCookie: string[] };

function request(
  app: Express,
  method: string,
  url: string,
  opts: { body?: string; cookie?: string } = {}
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const headers: Record<string, string | number> = {};
      if (opts.body) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        headers["content-length"] = Buffer.byteLength(opts.body);
      }
      if (opts.cookie) headers.cookie = opts.cookie;
      const req = http.request({ host: "127.0.0.1", port, path: url, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          server.close();
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
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

async function dbReady(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    return Boolean(admin);
  } catch {
    return false;
  }
}

function tableSlice(html: string, tableId: string): string {
  const start = html.indexOf(`id="${tableId}"`);
  assert.ok(start >= 0, `missing table ${tableId}`);
  const end = html.indexOf("</table>", start);
  assert.ok(end > start, tableId);
  return html.slice(start, end);
}

function headers(html: string, tableId: string): string[] {
  const head = tableSlice(html, tableId);
  const thead = head.slice(head.indexOf("<thead>"), head.indexOf("</thead>"));
  return [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)]
    .map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function references(html: string, tableId: string): string[] {
  const body = tableSlice(html, tableId);
  const tbody = body.slice(body.indexOf("<tbody>"));
  return [...tbody.matchAll(/class="ref-chip">([^<]*)</g)].map((match) => match[1]);
}

function addresses(html: string, tableId: string): string[] {
  const body = tableSlice(html, tableId);
  const tbody = body.slice(body.indexOf("<tbody>"));
  return [...tbody.matchAll(/<td class="addr-cell[^"]*">\s*<strong>([^<]*)<\/strong>/g)].map((match) => match[1]);
}

function rowCount(html: string, tableId: string): number {
  const body = tableSlice(html, tableId);
  const tbody = body.slice(body.indexOf("<tbody>"));
  return [...tbody.matchAll(/<tr\b/g)].length;
}

function tbodyRows(html: string, tableId: string): string[] {
  const body = tableSlice(html, tableId);
  const tbody = body.slice(body.indexOf("<tbody>"));
  return tbody.split(/<tr\b/).slice(1);
}

function isPendingDupeRow(row: string): boolean {
  return /\bpending-dupe\b/.test(row);
}

function addressesInRows(rows: string[]): string[] {
  return rows.flatMap((row) => {
    const match = row.match(/<td class="addr-cell[^"]*">\s*<strong>([^<]*)<\/strong>/);
    return match ? [match[1]] : [];
  });
}

function badgeCount(html: string, sectionId: string): number {
  const start = html.indexOf(`id="${sectionId}"`);
  assert.ok(start >= 0, sectionId);
  const slice = html.slice(start, start + 900);
  const match = slice.match(/count-received">(\d+)\s/);
  assert.ok(match, `count badge in ${sectionId}`);
  return Number(match[1]);
}

const LIST_HEADERS = ["Project", "Address", "Photos", "UPRN", "Surveyor", "Category", "Rating", "Received"];
const PENDING_HEADERS = ["Reference", ...LIST_HEADERS];

describe("pending and review lists", () => {
  it("shows the same waiting cases, without a Pending reference column, except the open case", async (t) => {
    if (!(await dbReady())) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const stamp = `p${Date.now().toString().slice(-7)}`;
    const project = await prisma.project.create({
      data: { name: `Pending ${stamp}`, projectManager: "Test", stage: "current", hhsrsCode: "MTVH" },
    });
    const newest = Date.now() + 60_000;
    const waitingSpecs = [
      ...Array.from({ length: 19 }, (_, i) => ({
        status: "new",
        reference: `MTVH-${stamp}-${String(i + 1).padStart(3, "0")}`,
        claimedBy: "",
      })),
      { status: "new", reference: null as string | null, claimedBy: "" },
      { status: "in_review", reference: `MTVH-${stamp}-020`, claimedBy: "Phil Moon" },
      { status: "email_ready", reference: `MTVH-${stamp}-021`, claimedBy: "" },
    ];
    const sentRefs = ["email_sent", "email_sent", "email_sent"].map(
      (_status, i) => `MTVH-${stamp}-S${i + 1}`
    );
    const created = await Promise.all(
      waitingSpecs.map((spec, i) =>
        prisma.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: "MTVH 2026",
            reference: spec.reference,
            surveyDate: "2026-09-28",
            uprn: `${stamp}${String(i).padStart(2, "0")}`,
            fullAddress: `${i + 1} ${stamp} Harbour Lane`,
            postcode: "EX23 8AB",
            surveyorName: "Carly Farrell",
            category: "Falls on stairs",
            rating: "Category 1",
            comment: stamp,
            photoPaths: [],
            status: spec.status,
            claimedBy: spec.claimedBy,
            claimedAt: spec.claimedBy ? new Date() : null,
            createdAt: new Date(newest - i * 1000),
          },
        })
      )
    );
    const sent = await Promise.all(
      sentRefs.map((reference, i) =>
        prisma.hhsrsSiteSubmission.create({
          data: {
            projectId: project.id,
            projectName: "MTVH 2026",
            reference,
            surveyDate: "2026-09-20",
            uprn: `${stamp}s${i}`,
            fullAddress: `Sent ${i} ${stamp} Close`,
            postcode: "EX23 8AB",
            surveyorName: "Carly Farrell",
            category: "Damp and mould",
            rating: "Moderate",
            comment: stamp,
            photoPaths: [],
            status: "email_sent",
            createdAt: new Date(newest - (30 + i) * 1000),
          },
        })
      )
    );
    const noRefAddress = `20 ${stamp} Harbour Lane`;
    const open = created.find((row) => row.reference === `MTVH-${stamp}-020`);
    assert.ok(open);
    t.after(async () => {
      await prisma.hhsrsSiteSubmission.deleteMany({
        where: { id: { in: [...created, ...sent].map((row) => row.id) } },
      });
      await prisma.project.delete({ where: { id: project.id } });
    });

    const app = createApp({ basePath: "" });
    const login = await request(app, "POST", "/login", {
      body: "username=phil.m&password=PhilMoon2468",
    });
    assert.equal(login.status, 302);
    const cookie = login.setCookie.map((item) => item.split(";")[0]).join("; ");

    const pending = await request(app, "GET", "/HHSRSreporter", { cookie });
    const review = await request(app, "GET", "/HHSRSreporter/review", { cookie });
    assert.equal(pending.status, 200);
    assert.equal(review.status, 200);
    assert.deepEqual(headers(pending.body, "waiting-table"), LIST_HEADERS);
    assert.equal(tableSlice(pending.body, "waiting-table").includes("ref-chip"), false);
    assert.equal(tableSlice(pending.body, "waiting-table").includes(">Reference<"), false);
    assert.deepEqual(headers(pending.body, "last-actioned-table"), LIST_HEADERS);
    assert.equal(tableSlice(pending.body, "last-actioned-table").includes("ref-chip"), false);
    assert.deepEqual(headers(review.body, "rv-also-table"), PENDING_HEADERS);

    const pendingRowHtml = tbodyRows(pending.body, "waiting-table");
    const pendingWaiting = pendingRowHtml.filter((row) => !isPendingDupeRow(row));
    const reviewRefs = references(review.body, "rv-also-table");
    const reviewAddresses = addresses(review.body, "rv-also-table");
    const pendingWaitingAddresses = addressesInRows(pendingWaiting);
    assert.deepEqual([...pendingWaitingAddresses].sort(), [...reviewAddresses].sort());
    const own = (list: string[]) => list.filter((address) => address.includes(`${stamp} Harbour Lane`));
    const pendingOwn = own(pendingWaitingAddresses);
    const reviewOwn = own(reviewAddresses);
    assert.equal(reviewOwn[0], `1 ${stamp} Harbour Lane`);
    assert.equal(pendingOwn[0], `22 ${stamp} Harbour Lane`);
    assert.deepEqual(pendingOwn, [...reviewOwn].reverse());
    const pendingSection = pending.body.slice(pending.body.indexOf('id="not-actioned"'), pending.body.indexOf('id="last-actioned"'));
    assert.match(pendingSection, /class="pending-sort-default on"/);
    assert.match(pendingSection, /Project, then highest rating, then longest wait/);
    assert.match(pendingSection, /href="\/HHSRSreporter\?sort=rating"/);
    assert.equal(tableSlice(pending.body, "last-actioned-table").includes("ml-sort"), false);
    assert.equal(tableSlice(review.body, "rv-also-table").includes("ml-sort"), false);
    assert.doesNotMatch(review.body, /pending-sort-default/);
    assert.equal(pendingRowHtml.length, badgeCount(pending.body, "not-actioned"));
    assert.equal(rowCount(review.body, "rv-also-table"), badgeCount(review.body, "rv-also-waiting"));
    assert.equal(pendingWaiting.length, badgeCount(review.body, "rv-also-waiting"));
    for (const spec of waitingSpecs) {
      if (!spec.reference) continue;
      assert.equal(reviewRefs.includes(spec.reference), true, spec.reference);
      assert.equal(pending.body.includes(spec.reference), false, spec.reference);
    }
    assert.match(tableSlice(pending.body, "waiting-table"), new RegExp(noRefAddress));
    assert.match(tableSlice(review.body, "rv-also-table"), new RegExp(noRefAddress));
    for (const reference of sentRefs) {
      assert.equal(reviewRefs.includes(reference), false, reference);
      assert.equal(tableSlice(pending.body, "last-actioned-table").includes(reference), false);
    }

    const byRating = await request(app, "GET", "/HHSRSreporter?sort=rating", { cookie });
    assert.equal(byRating.status, 200);
    const ratingSection = byRating.body.slice(byRating.body.indexOf('id="not-actioned"'), byRating.body.indexOf('id="last-actioned"'));
    assert.match(ratingSection, /class="pending-sort-default"/);
    assert.doesNotMatch(ratingSection, /pending-sort-default on/);
    assert.match(ratingSection, /aria-sort="descending"/);
    assert.match(ratingSection, /Highest rating first/);
    assert.equal(own(addresses(byRating.body, "waiting-table"))[0], `1 ${stamp} Harbour Lane`);
    assert.equal(tableSlice(byRating.body, "last-actioned-table").includes("ml-sort"), false);
    assert.deepEqual(headers(byRating.body, "last-actioned-table"), LIST_HEADERS);

    const opened = await request(app, "GET", `/HHSRSreporter/review/${open.id}`, { cookie });
    assert.equal(opened.status, 200);
    assert.match(opened.body, new RegExp(`class="ref-chip">${open.reference}</span>`));
    const caseHeading = opened.body.slice(opened.body.indexOf('id="rv-case-heading"'), opened.body.indexOf('id="rv-case-badge"'));
    assert.match(caseHeading, new RegExp(open.reference || ""));
    const openedRefs = references(opened.body, "rv-also-table");
    assert.equal(openedRefs.includes(open.reference || ""), false);
    assert.deepEqual(
      openedRefs,
      reviewRefs.filter((reference) => reference !== open.reference)
    );
    assert.equal(badgeCount(opened.body, "rv-also-waiting"), rowCount(opened.body, "rv-also-table"));
    assert.equal(rowCount(opened.body, "rv-also-table"), pendingWaiting.length - 1);
    assert.equal(openedRefs.length, reviewRefs.length - 1);
  });

  it("keeps a duplicate on Pending with Dupe after the UPRN, and still on the Dupes tab", async (t) => {
    if (!(await dbReady())) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const stamp = `d${Date.now().toString().slice(-7)}`;
    const project = await prisma.project.create({
      data: {
        name: `Dupe pending ${stamp}`,
        projectManager: "Test",
        stage: "current",
        hhsrsCode: `D${stamp}`.slice(0, 8),
      },
    });
    const uprn = `58${stamp}`;
    const dupeAddress = `4 Sample Road ${stamp}`;
    const earlierAddress = `1 First ${stamp}`;
    const plainAddress = `12 Example Street ${stamp}`;
    const errorAddress = `9 Error Close ${stamp}`;
    const base = {
      projectId: project.id,
      projectName: project.name,
      surveyDate: "2026-09-28",
      postcode: "EX23 8AB",
      surveyorName: "Carly Farrell",
      category: "Falls on stairs",
      rating: "Severe",
      comment: stamp,
      photoPaths: [] as string[],
    };
    const plain = await prisma.hhsrsSiteSubmission.create({
      data: { ...base, uprn: `10${stamp}`, fullAddress: plainAddress, status: "new" },
    });
    const earlier = await prisma.hhsrsSiteSubmission.create({
      data: {
        ...base,
        uprn,
        fullAddress: earlierAddress,
        reference: `DUP-${stamp}-A`,
        status: "new",
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    const later = await prisma.hhsrsSiteSubmission.create({
      data: {
        ...base,
        uprn,
        fullAddress: dupeAddress,
        reference: `DUP-${stamp}-B`,
        status: "new",
      },
    });
    const errorCase = await prisma.hhsrsSiteSubmission.create({
      data: {
        ...base,
        uprn: `77${stamp}`,
        fullAddress: errorAddress,
        reference: `DUP-${stamp}-E`,
        status: "not_needed",
        notNeededReason: "surveyor_error",
        notNeededNote: "Wrong details",
      },
    });
    t.after(async () => {
      await prisma.hhsrsSiteSubmission.deleteMany({
        where: { id: { in: [plain.id, earlier.id, later.id, errorCase.id] } },
      });
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    });

    const app = createApp({ basePath: "" });
    const login = await request(app, "POST", "/login", {
      body: "username=phil.m&password=PhilMoon2468",
    });
    assert.equal(login.status, 302);
    const cookie = login.setCookie.map((item) => item.split(";")[0]).join("; ");

    const pending = await request(app, "GET", "/HHSRSreporter", { cookie });
    assert.equal(pending.status, 200);
    assert.deepEqual(headers(pending.body, "waiting-table"), LIST_HEADERS);
    const rows = tbodyRows(pending.body, "waiting-table");
    const dupeRow = rows.find((row) => row.includes(dupeAddress));
    const earlierRow = rows.find((row) => row.includes(earlierAddress));
    const plainRow = rows.find((row) => row.includes(plainAddress));
    assert.ok(dupeRow, "later duplicate stays on Pending");
    assert.ok(earlierRow, "earlier duplicate stays on Pending");
    assert.ok(plainRow);
    assert.match(dupeRow, /\bpending-dupe\b/);
    assert.match(earlierRow, /\bpending-dupe\b/);
    assert.doesNotMatch(plainRow, /\bpending-dupe\b/);
    assert.equal(tableSlice(pending.body, "waiting-table").includes(errorAddress), false);

    const uprnCell = dupeRow.match(/<td class="col-uprn">([\s\S]*?)<\/td>/);
    assert.ok(uprnCell);
    assert.match(uprnCell[1], new RegExp(`${uprn}</span> <span class="pending-dupe-tag">Dupe</span>`));
    const addrCell = dupeRow.match(/<td class="addr-cell[^"]*">([\s\S]*?)<\/td>/);
    assert.ok(addrCell);
    assert.match(addrCell[1], new RegExp(`<strong>${dupeAddress}</strong>`));
    assert.doesNotMatch(addrCell[1], /Dupe/);

    const last = pending.body.slice(pending.body.indexOf('id="last-actioned"'));
    assert.ok(last.startsWith('id="last-actioned"'));
    assert.equal(last.includes(dupeAddress), false);
    assert.equal(last.includes(earlierAddress), false);

    const dupes = await request(app, "GET", "/HHSRSreporter/duplicates", { cookie });
    assert.equal(dupes.status, 200);
    assert.match(dupes.body, new RegExp(dupeAddress));
    assert.match(dupes.body, new RegExp(earlierAddress));
    assert.match(dupes.body, new RegExp(errorAddress));
    const errorRow = dupes.body.split("<tr").find((part) => part.includes(errorAddress));
    assert.ok(errorRow);
    assert.match(errorRow, /Surveyor correction/);
    assert.doesNotMatch(errorRow, /Surveyor error/);
    assert.match(dupes.body, new RegExp(`data-dup-id="${later.id}"`));
    assert.match(dupes.body, new RegExp(`data-dup-id="${earlier.id}"`));

    const review = await request(app, "GET", "/HHSRSreporter/review", { cookie });
    const also = tableSlice(review.body, "rv-also-table");
    assert.equal(also.includes(dupeAddress), false);
    assert.equal(also.includes(earlierAddress), false);
    assert.match(also, new RegExp(plainAddress));

    const log = await request(
      app,
      "GET",
      `/HHSRSreporter/main-log?q=${encodeURIComponent(dupeAddress)}`,
      { cookie }
    );
    assert.equal(log.body.includes(`<strong>${dupeAddress}</strong>`), false);

    const [storedLater, storedEarlier, storedPlain, storedError] = await Promise.all([
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: later.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: earlier.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: plain.id } }),
      prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: errorCase.id } }),
    ]);
    assert.equal(storedLater.status, "not_needed");
    assert.equal(storedLater.notNeededReason, "duplicate");
    assert.equal(storedEarlier.status, "not_needed");
    assert.equal(storedEarlier.notNeededReason, "duplicate");
    assert.equal(storedPlain.status, "new");
    assert.equal(storedError.status, "not_needed");
    assert.equal(storedError.notNeededReason, "surveyor_error");
  });
});

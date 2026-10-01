import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { HHSRS_WAITING_STATUSES } from "./hhsrs-reporter.js";
import { PENDING_ISSUE_LIST_LIMIT, pendingIssueListArgs, withoutOpenCase } from "./hhsrs-pending-list.js";
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
    assert.doesNotMatch(route, /take:\s*12/);
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
  return [...thead.matchAll(/<th[^>]*>([^<]*)/g)].map((match) => match[1].trim()).filter(Boolean);
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

    const pendingAddresses = addresses(pending.body, "waiting-table");
    const reviewRefs = references(review.body, "rv-also-table");
    const reviewAddresses = addresses(review.body, "rv-also-table");
    assert.deepEqual(reviewAddresses, pendingAddresses);
    assert.equal(rowCount(pending.body, "waiting-table"), badgeCount(pending.body, "not-actioned"));
    assert.equal(rowCount(review.body, "rv-also-table"), badgeCount(review.body, "rv-also-waiting"));
    assert.equal(badgeCount(pending.body, "not-actioned"), badgeCount(review.body, "rv-also-waiting"));
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
    assert.equal(rowCount(opened.body, "rv-also-table"), rowCount(pending.body, "waiting-table") - 1);
    assert.equal(openedRefs.length, reviewRefs.length - 1);
  });
});

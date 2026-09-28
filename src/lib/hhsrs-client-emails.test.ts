import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { checkSendRequest } from "./hhsrs-send.js";
import { draftEmailFromReviewFields, mergeReviewDraftFields } from "./hhsrs-reporter.js";
import { REPORTER_DEMO_PROJECTS } from "./hhsrs-reporter-projects.js";
import {
  buildClientEmailCards,
  clientEmailChangedLine,
  parseAddressBox,
  recipientsFromStoredOrCode,
  sendBodyWithClientRecipients,
  type ClientEmailRow,
} from "./hhsrs-client-emails.js";

process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

const draftFields = {
  address: "1 High Street",
  notes: "Loose socket in the kitchen.",
  hazard: "Electrical Hazards",
  rating: "High",
  uprn: "100123",
  surveyDate: "2026-09-20",
  includeCause: true,
  photoCount: 0,
};

const sendBase = {
  hasReporterAccess: true,
  passwordSet: true,
  alreadySent: false,
  checked: true,
  to: "",
  cc: "",
  bcc: "",
  allowDomainsRaw: "*",
  totalBytes: 0,
};

describe("HHSRS client email address lists", () => {
  it("parses lines, commas, and repeats, and rejects a bad address", () => {
    const parsed = parseAddressBox(" desk@client.test, other@client.test\ndesk@client.test; third@client.test ");
    assert.deepEqual(parsed, {
      ok: true,
      addresses: ["desk@client.test", "other@client.test", "third@client.test"],
    });
    assert.deepEqual(parseAddressBox("  \n, ; "), { ok: true, addresses: [] });
    const bad = parseAddressBox("desk@client.test\nnot-an-email");
    assert.deepEqual(bad, { ok: false, error: "Not a valid address: not-an-email." });
  });

  it("uses a saved row, including an empty To, and falls back to code when there is no row", () => {
    const stored = recipientsFromStoredOrCode("Gateway 2026", {
      toAddresses: "desk@client.test",
      ccAddresses: "other@client.test",
      bccAddresses: "bcc@client.test",
    });
    assert.deepEqual(stored, {
      to: "desk@client.test",
      cc: "other@client.test",
      bcc: "bcc@client.test",
    });
    const cleared = recipientsFromStoredOrCode("Test Housing", {
      toAddresses: "",
      ccAddresses: "",
      bccAddresses: "",
    });
    assert.equal(cleared.to, "");
    const blocked = checkSendRequest({ ...sendBase, to: cleared.to, cc: cleared.cc, bcc: cleared.bcc });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error, "Add a To address.");

    const fallback = recipientsFromStoredOrCode("Test Housing", null);
    assert.equal(fallback.to, "cfarrell@savillshousing.co.uk");
    assert.equal(fallback.cc, "");
    const allowed = checkSendRequest({ ...sendBase, to: stored.to, cc: stored.cc, bcc: stored.bcc });
    assert.equal(allowed.ok, true);

    const gatewayCode = recipientsFromStoredOrCode("Gateway 2026", null);
    assert.equal(gatewayCode.to, "");
    const draft = draftEmailFromReviewFields(
      mergeReviewDraftFields(null, { ...draftFields, projectName: "Gateway 2026" }),
      stored
    );
    assert.equal(draft.to, "desk@client.test");
    assert.equal(draft.cc, "other@client.test");
    assert.equal(draft.bcc, "bcc@client.test");
    const codeDraft = draftEmailFromReviewFields(
      mergeReviewDraftFields(null, { ...draftFields, projectName: "Gateway 2026" })
    );
    assert.equal(codeDraft.to, "");
  });

  it("builds one card per active project and keeps an invalid edit on screen", () => {
    const row: ClientEmailRow = {
      projectName: "Test Housing",
      toAddresses: "cfarrell@savillshousing.co.uk",
      ccAddresses: "",
      bccAddresses: "",
      changedAt: new Date("2026-09-28T12:00:00Z"),
      changedByName: "",
    };
    const cards = buildClientEmailCards(REPORTER_DEMO_PROJECTS, [row], null);
    assert.equal(cards.length, REPORTER_DEMO_PROJECTS.length);
    assert.equal(cards.some((card) => card.projectName === "Flagship 2026"), false);
    assert.deepEqual(
      cards.map((card) => card.projectName),
      [...cards.map((card) => card.projectName)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
    );
    assert.equal(cards[0]?.projectName, "A2D 2026 Phase 4");
    assert.equal(cards.every((card) => card.open === false), true);
    const testHousing = cards.find((card) => card.projectName === "Test Housing");
    const gateway = cards.find((card) => card.projectName === "Gateway 2026");
    assert.ok(testHousing && gateway);
    assert.equal(testHousing.toText, "cfarrell@savillshousing.co.uk");
    assert.match(testHousing.changedLine, /^Last changed \d{2}\/\d{2}\/\d{4}$/);
    assert.equal(testHousing.changedLine.includes(" by "), false);
    assert.equal(gateway.toText, "");
    assert.equal(gateway.changedLine, "");
    assert.match(clientEmailChangedLine(row.changedAt, "Phil Moon"), /^Last changed \d{2}\/\d{2}\/\d{4} by Phil Moon$/);

    const invalid = buildClientEmailCards(REPORTER_DEMO_PROJECTS, [row], {
      projectName: "Gateway 2026",
      saved: false,
      error: "Not a valid address: not-an-email.",
      toText: "not-an-email",
      ccText: "other@client.test",
      bccText: "",
    });
    const gatewayInvalid = invalid.find((card) => card.projectName === "Gateway 2026");
    assert.ok(gatewayInvalid);
    assert.equal(gatewayInvalid.toText, "not-an-email");
    assert.equal(gatewayInvalid.error, "Not a valid address: not-an-email.");
    assert.equal(gatewayInvalid.saved, false);
    assert.equal(gatewayInvalid.open, true);
    assert.equal(invalid.find((card) => card.projectName === "Test Housing")?.open, false);

    const view = readFileSync("views/hhsrs-reporter/partials/client-email-card.ejs", "utf8");
    const js = readFileSync("public/js/hhsrs-reporter.js", "utf8");
    assert.match(view, /Choose a project/);
    assert.match(view, /id="client-email-project"/);
    assert.match(js, /Discard unsaved changes\?/);
    assert.match(js, /sessionStorage/);
  });

  it("fills a blank send form from stored recipients and leaves a typed To alone", () => {
    const stored = { to: "desk@client.test", cc: "other@client.test", bcc: "" };
    const filled = sendBodyWithClientRecipients({ checked: "1" }, stored);
    assert.equal(filled.to, "desk@client.test");
    assert.equal(filled.cc, "other@client.test");
    const kept = sendBodyWithClientRecipients({ to: "typed@client.test", cc: "", bcc: "" }, stored);
    assert.equal(kept.to, "typed@client.test");
    assert.equal(kept.cc, "");
  });
});

type CreateApp = (options?: { basePath?: string }) => Express;
type Hit = { status: number; location: string; body: string; setCookie: string[] };

let createApp: CreateApp;
let dbReady = false;

function request(
  app: Express,
  method: string,
  url: string,
  opts: { body?: string; cookie?: string; contentType?: string } = {}
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const payload = opts.body;
      const headers: Record<string, string | number> = {};
      if (payload) {
        headers["content-type"] = opts.contentType || "application/x-www-form-urlencoded";
        headers["content-length"] = Buffer.byteLength(payload);
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
  return setCookie
    .map((line) => line.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function login(app: Express, username: string, password: string): Promise<string> {
  const res = await request(app, "POST", "/login", {
    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
  });
  assert.equal(res.status, 302, res.body.slice(0, 200));
  const cookie = cookieHeader(res.setCookie);
  assert.match(cookie, /scp_session=/);
  return cookie;
}

function formBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

before(async () => {
  ({ createApp } = await import("../app.js"));
  const { prisma } = await import("./prisma.js");
  try {
    await prisma.$queryRaw`SELECT 1`;
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    await prisma.hhsrsClientEmail.findFirst();
    dbReady = Boolean(admin);
  } catch {
    dbReady = false;
  }
});

describe("HHSRS client email admin and send", { concurrency: 1 }, () => {
  it("lets an office admin save addresses and uses them for generate and send", async (t) => {
    if (!dbReady) {
      t.skip("Postgres with seeded users is not available");
      return;
    }
    const { prisma } = await import("./prisma.js");
    const { clientRecipientsForProject } = await import("./hhsrs-client-emails.js");
    const previousPassword = process.env.HHSRS_SMTP_PASSWORD;
    const previousAllow = process.env.HHSRS_SEND_ALLOW_DOMAINS;
    await prisma.hhsrsClientEmail.deleteMany({ where: { projectName: { not: "Test Housing" } } });
    await prisma.hhsrsClientEmail.upsert({
      where: { projectName: "Test Housing" },
      create: {
        projectName: "Test Housing",
        toAddresses: "cfarrell@savillshousing.co.uk",
        ccAddresses: "",
        bccAddresses: "",
        changedByName: "",
      },
      update: {
        toAddresses: "cfarrell@savillshousing.co.uk",
        ccAddresses: "",
        bccAddresses: "",
        changedByName: "",
      },
    });

    const app = createApp({ basePath: "" });
    const cookie = await login(app, "phil.m", "PhilMoon2468");
    const surveyorCookie = await login(app, "peter.m", "PeterMay2468");
    let caseId = "";
    try {
      const outsider = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        body: formBody({ projectName: "Gateway 2026", to: "desk@client.test", cc: "", bcc: "" }),
      });
      assert.equal(outsider.status, 302);
      assert.equal(outsider.location, "/login");

      const surveyor = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        cookie: surveyorCookie,
        body: formBody({ projectName: "Gateway 2026", to: "desk@client.test", cc: "", bcc: "" }),
      });
      assert.equal(surveyor.status, 403);
      assert.match(surveyor.body, /Admin only/);
      assert.equal(await prisma.hhsrsClientEmail.findUnique({ where: { projectName: "Gateway 2026" } }), null);

      const page = await request(app, "GET", "/HHSRSreporter/admin", { cookie });
      assert.equal(page.status, 200);
      assert.match(page.body, /Client email addresses/);
      assert.match(page.body, /Choose a project/);
      assert.match(page.body, /One address per line, or commas/);
      assert.match(page.body, /id="client-email-test-housing-to"[^>]*>cfarrell@savillshousing\.co\.uk<\/textarea>/);
      assert.match(page.body, /id="client-email-gateway-2026-to"[^>]*>\s*<\/textarea>/);
      assert.doesNotMatch(page.body, /Flagship 2026/);
      const closed = [...page.body.matchAll(/<form class="client-email-row"[^>]*>/g)].map((match) => match[0]);
      assert.ok(closed.length > 1);
      assert.equal(closed.every((tag) => /\shidden/.test(tag)), true);
      assert.match(page.body, /<option value="">Choose a project<\/option>\s*<option value="A2D 2026 Phase 4">/);
      const surveyorPage = await request(app, "GET", "/HHSRSreporter/admin", { cookie: surveyorCookie });
      assert.equal(surveyorPage.status, 403);

      const bad = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        cookie,
        body: formBody({ projectName: "Gateway 2026", to: "not-an-email", cc: "other@client.test", bcc: "" }),
      });
      assert.equal(bad.status, 302);
      const badPage = await request(app, "GET", "/HHSRSreporter/admin", {
        cookie: bad.setCookie.length ? cookieHeader(bad.setCookie) : cookie,
      });
      assert.match(badPage.body, /Not a valid address: not-an-email\./);
      assert.match(badPage.body, /id="client-email-gateway-2026-to"[^>]*>not-an-email<\/textarea>/);
      assert.match(badPage.body, /<option value="Gateway 2026" selected>/);
      const badForms = [...badPage.body.matchAll(/<form class="client-email-row"[^>]*>/g)].map((match) => match[0]);
      const badOpen = badForms.filter((tag) => !/\shidden/.test(tag));
      assert.equal(badOpen.length, 1);
      assert.match(badOpen[0], /data-project="Gateway 2026"/);
      assert.equal(await prisma.hhsrsClientEmail.findUnique({ where: { projectName: "Gateway 2026" } }), null);

      const unknown = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        cookie,
        body: formBody({ projectName: "Nope Housing", to: "desk@client.test", cc: "", bcc: "" }),
      });
      const unknownPage = await request(app, "GET", "/HHSRSreporter/admin", {
        cookie: unknown.setCookie.length ? cookieHeader(unknown.setCookie) : cookie,
      });
      assert.match(unknownPage.body, /Unknown project\./);

      const saved = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        cookie,
        body: formBody({
          projectName: "Gateway 2026",
          to: "desk@client.test",
          cc: "other@client.test, third@client.test",
          bcc: "bcc@client.test",
        }),
      });
      assert.equal(saved.status, 302);
      const savedPage = await request(app, "GET", "/HHSRSreporter/admin", {
        cookie: saved.setCookie.length ? cookieHeader(saved.setCookie) : cookie,
      });
      assert.match(savedPage.body, /Saved\./);
      assert.match(savedPage.body, /Last changed \d{2}\/\d{2}\/\d{4} by Phil Moon/);
      assert.match(savedPage.body, /<option value="Gateway 2026" selected>/);
      const savedForms = [...savedPage.body.matchAll(/<form class="client-email-row"[^>]*>/g)].map((match) => match[0]);
      const savedOpen = savedForms.filter((tag) => !/\shidden/.test(tag));
      assert.equal(savedOpen.length, 1);
      assert.match(savedOpen[0], /data-project="Gateway 2026"/);
      const gatewayRow = await prisma.hhsrsClientEmail.findUnique({ where: { projectName: "Gateway 2026" } });
      assert.ok(gatewayRow);
      assert.equal(gatewayRow.toAddresses, "desk@client.test");
      assert.equal(gatewayRow.ccAddresses, "other@client.test\nthird@client.test");
      assert.equal(gatewayRow.bccAddresses, "bcc@client.test");
      assert.equal(gatewayRow.changedByName, "Phil Moon");

      const drafted = await request(app, "POST", "/HHSRSreporter/draft.json", {
        cookie,
        contentType: "application/json",
        body: JSON.stringify({
          projectName: "Gateway 2026",
          address: "1 High Street",
          notes: "Loose socket in the kitchen.",
          hazard: "Electrical Hazards",
          rating: "High",
          uprn: "100123",
          surveyDate: "2026-09-20",
          includeCause: true,
          photoCount: 0,
        }),
      });
      assert.equal(drafted.status, 200);
      const payload = JSON.parse(drafted.body) as { ok: boolean; to: string; cc: string; bcc: string };
      assert.equal(payload.ok, true);
      assert.equal(payload.to, "desk@client.test");
      assert.equal(payload.cc, "other@client.test; third@client.test");
      assert.equal(payload.bcc, "bcc@client.test");

      const row = await prisma.hhsrsSiteSubmission.create({
        data: {
          projectName: "Gateway 2026",
          surveyDate: "2026-09-20",
          uprn: "client-email-" + Date.now(),
          fullAddress: "1 High Street",
          postcode: "EX1 1AA",
          surveyorName: "Alex Surveyor",
          category: "Electrical Hazards",
          rating: "High",
          comment: "Loose socket in the kitchen.",
          photoPaths: [],
          status: "new",
        },
      });
      caseId = row.id;
      process.env.HHSRS_SMTP_PASSWORD = "test-not-a-real-password";
      process.env.HHSRS_SEND_ALLOW_DOMAINS = "blocked.example";
      const sent = await request(app, "POST", `/HHSRSreporter/review/${row.id}/send`, {
        cookie,
        body: formBody({ checked: "1", to: "", cc: "", bcc: "", subject: "HHSRS", body: "Hello" }),
      });
      assert.equal(sent.status, 302);
      const sentPage = await request(app, "GET", sent.location || `/HHSRSreporter/review/${row.id}`, {
        cookie: sent.setCookie.length ? cookieHeader(sent.setCookie) : cookie,
      });
      assert.match(sentPage.body, /Not sent\. desk@client\.test is not allowed\./);
      const fresh = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: row.id } });
      assert.equal(fresh?.emailSentAt, null);

      await prisma.hhsrsClientEmail.update({
        where: { projectName: "Gateway 2026" },
        data: { toAddresses: "", ccAddresses: "", bccAddresses: "" },
      });
      const clearedDraft = await request(app, "POST", "/HHSRSreporter/draft.json", {
        cookie,
        contentType: "application/json",
        body: JSON.stringify({ projectName: "Gateway 2026", address: "1 High Street", notes: "Loose socket.", hazard: "Electrical Hazards", rating: "High", uprn: "100123", surveyDate: "2026-09-20", includeCause: true, photoCount: 0 }),
      });
      const clearedPayload = JSON.parse(clearedDraft.body) as { to: string };
      assert.equal(clearedPayload.to, "");
      const blockedSend = await request(app, "POST", `/HHSRSreporter/review/${row.id}/send`, {
        cookie,
        body: formBody({ checked: "1", to: "", cc: "", bcc: "" }),
      });
      const blockedPage = await request(app, "GET", blockedSend.location || `/HHSRSreporter/review/${row.id}`, {
        cookie: blockedSend.setCookie.length ? cookieHeader(blockedSend.setCookie) : cookie,
      });
      assert.match(blockedPage.body, /Add a To address\./);

      await prisma.hhsrsClientEmail.delete({ where: { projectName: "Gateway 2026" } });
      const codeDraft = await clientRecipientsForProject("Gateway 2026");
      assert.equal(codeDraft.to, "");
      const seeded = await clientRecipientsForProject("Test Housing");
      assert.equal(seeded.to, "cfarrell@savillshousing.co.uk");
    } finally {
      if (previousPassword === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = previousPassword;
      if (previousAllow === undefined) delete process.env.HHSRS_SEND_ALLOW_DOMAINS;
      else process.env.HHSRS_SEND_ALLOW_DOMAINS = previousAllow;
      if (caseId) await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: caseId } });
      await prisma.hhsrsClientEmail.deleteMany({ where: { projectName: { not: "Test Housing" } } });
      await prisma.hhsrsClientEmail.upsert({
        where: { projectName: "Test Housing" },
        create: {
          projectName: "Test Housing",
          toAddresses: "cfarrell@savillshousing.co.uk",
          ccAddresses: "",
          bccAddresses: "",
          changedByName: "",
        },
        update: {
          toAddresses: "cfarrell@savillshousing.co.uk",
          ccAddresses: "",
          bccAddresses: "",
          changedByName: "",
        },
      });
    }
  });
});

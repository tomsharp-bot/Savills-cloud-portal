import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { checkSendRequest } from "./hhsrs-send.js";
import { draftEmailFromReviewFields, mergeReviewDraftFields } from "./hhsrs-reporter.js";
import {
  buildClientEmailCards,
  clientEmailChangedLine,
  parseAddressBox,
  recipientsFromStoredOrCode,
  resolveClientEmailProject,
  sendBodyWithClientRecipients,
  type ClientEmailRow,
} from "./hhsrs-client-emails.js";

const liveEmailProjects = [
  { name: "Leeds Fed HA 2026", to: [] as string[], cc: [] as string[] },
  { name: "MTVH 2026", to: [] as string[], cc: [] as string[] },
  { name: "Vico 2026", to: [] as string[], cc: [] as string[] },
  { name: "Onward 2026", to: [] as string[], cc: [] as string[] },
  { name: "Test Housing", to: ["cfarrell@savillshousing.co.uk"], cc: [] as string[] },
];

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
    const leedsRoster = recipientsFromStoredOrCode("Leeds Fed HA 2026", null);
    assert.equal(leedsRoster.to, "");
    const leedsSaved = recipientsFromStoredOrCode("Leeds Fed HA 2026", {
      toAddresses: "leeds-fed@client.test",
      ccAddresses: "",
      bccAddresses: "",
    });
    assert.equal(leedsSaved.to, "leeds-fed@client.test");
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

  it("resolves live submission names onto the same key as the Admin card, and keeps LFHA roster settings", () => {
    const leeds = resolveClientEmailProject("Leeds Fed HA 2026");
    assert.equal(leeds.key, "Leeds Fed HA 2026");
    assert.equal(leeds.roster?.name, "LFHA (Leeds)");
    assert.equal(leeds.roster?.template, "LFHA");
    assert.equal(resolveClientEmailProject("LFHA (Leeds)").key, "Leeds Fed HA 2026");
    assert.equal(resolveClientEmailProject("LFHA 2026").key, "Leeds Fed HA 2026");
    assert.equal(resolveClientEmailProject("Leeds Federation").key, "Leeds Fed HA 2026");

    const mtvh = resolveClientEmailProject("MTVH 2026");
    assert.equal(mtvh.key, "MTVH 2026");
    assert.equal(mtvh.roster?.name, "MTVH Pilot 2026");
    assert.equal(resolveClientEmailProject("MTVH Pilot 2026").key, "MTVH 2026");
    assert.equal(resolveClientEmailProject("MTVH Phase 1 2026").key, "MTVH 2026");

    const vico = resolveClientEmailProject("Vico 2026");
    assert.equal(vico.key, "Vico 2026");
    assert.equal(vico.roster?.name, "Vico 2026 8k");
    assert.equal(vico.roster?.extras.vulnerabilities, true);
    assert.equal(resolveClientEmailProject("Vico 2026 8k").key, "Vico 2026");

    const onward = resolveClientEmailProject("Onward 2026");
    assert.equal(onward.key, "Onward 2026");
    assert.equal(onward.roster?.template, "Onward");
    assert.equal(resolveClientEmailProject("Onward (Leeds)").key, "Onward (Leeds)");
    assert.equal(resolveClientEmailProject("Onward (Leeds)").roster?.template, "Onward");

    const testHousing = resolveClientEmailProject("Test Housing");
    assert.equal(testHousing.key, "Test Housing");
    assert.deepEqual(testHousing.roster?.to, ["cfarrell@savillshousing.co.uk"]);
    assert.equal(resolveClientEmailProject("  ").key, "");
  });

  it("builds one card per live project name and keeps an invalid edit on screen", () => {
    const row: ClientEmailRow = {
      projectName: "Test Housing",
      toAddresses: "cfarrell@savillshousing.co.uk",
      ccAddresses: "",
      bccAddresses: "",
      changedAt: new Date("2026-09-28T12:00:00Z"),
      changedByName: "",
    };
    const cards = buildClientEmailCards(liveEmailProjects, [row], null);
    assert.equal(cards.length, liveEmailProjects.length);
    assert.equal(cards.some((card) => card.projectName === "Flagship 2026"), false);
    assert.equal(cards.some((card) => card.projectName === "LFHA (Leeds)"), false);
    assert.equal(cards.some((card) => card.projectName === "Vico 2026 8k"), false);
    assert.equal(cards.some((card) => card.projectName === "MTVH Pilot 2026"), false);
    assert.equal(cards.some((card) => card.projectName === "A2D 2026 Phase 4"), false);
    assert.deepEqual(
      cards.map((card) => card.projectName),
      ["Leeds Fed HA 2026", "MTVH 2026", "Onward 2026", "Test Housing", "Vico 2026"]
    );
    assert.equal(cards.every((card) => card.open === false), true);
    const testHousing = cards.find((card) => card.projectName === "Test Housing");
    const onward = cards.find((card) => card.projectName === "Onward 2026");
    assert.ok(testHousing && onward);
    assert.equal(testHousing.toText, "cfarrell@savillshousing.co.uk");
    assert.match(testHousing.changedLine, /^Last changed \d{2}\/\d{2}\/\d{4}$/);
    assert.equal(testHousing.changedLine.includes(" by "), false);
    assert.equal(onward.toText, "");
    assert.equal(onward.changedLine, "");
    assert.match(clientEmailChangedLine(row.changedAt, "Phil Moon"), /^Last changed \d{2}\/\d{2}\/\d{4} by Phil Moon$/);

    const invalid = buildClientEmailCards(liveEmailProjects, [row], {
      projectName: "Onward 2026",
      saved: false,
      error: "Not a valid address: not-an-email.",
      toText: "not-an-email",
      ccText: "other@client.test",
      bccText: "",
    });
    const onwardInvalid = invalid.find((card) => card.projectName === "Onward 2026");
    assert.ok(onwardInvalid);
    assert.equal(onwardInvalid.toText, "not-an-email");
    assert.equal(onwardInvalid.error, "Not a valid address: not-an-email.");
    assert.equal(onwardInvalid.saved, false);
    assert.equal(onwardInvalid.open, true);
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
    let cookie = await login(app, "phil.m", "PhilMoon2468");
    const surveyorCookie = await login(app, "peter.m", "PeterMay2468");
    const liveNames = ["Leeds Fed HA 2026", "MTVH 2026", "Vico 2026", "Onward 2026", "Test Housing"] as const;
    const savedTo: Record<string, string> = {
      "Leeds Fed HA 2026": "leeds-fed@client.test",
      "MTVH 2026": "mtvh@client.test",
      "Vico 2026": "vico@client.test",
      "Onward 2026": "onward@client.test",
      "Test Housing": "test-housing@client.test",
    };
    const createdProjectIds: string[] = [];
    const restoredStages: { id: string; stage: "current" | "archive" | "upcoming" }[] = [];
    let caseId = "";
    try {
      for (const name of liveNames) {
        if (name === "Test Housing") continue;
        const existing = await prisma.project.findUnique({ where: { name } });
        if (!existing) {
          const created = await prisma.project.create({
            data: { name, projectManager: "Test", stage: "current" },
          });
          createdProjectIds.push(created.id);
        } else if (existing.stage !== "current") {
          restoredStages.push({ id: existing.id, stage: existing.stage });
          await prisma.project.update({ where: { id: existing.id }, data: { stage: "current" } });
        }
      }

      const outsider = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        body: formBody({ projectName: "Onward 2026", "hhsrs-to": "desk@client.test", "hhsrs-cc": "", "hhsrs-bcc": "" }),
      });
      assert.equal(outsider.status, 302);
      assert.equal(outsider.location, "/login");

      const surveyor = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        cookie: surveyorCookie,
        body: formBody({ projectName: "Onward 2026", "hhsrs-to": "desk@client.test", "hhsrs-cc": "", "hhsrs-bcc": "" }),
      });
      assert.equal(surveyor.status, 403);
      assert.match(surveyor.body, /Admin only/);
      assert.equal(await prisma.hhsrsClientEmail.findUnique({ where: { projectName: "Onward 2026" } }), null);

      const page = await request(app, "GET", "/HHSRSreporter/admin", { cookie });
      assert.equal(page.status, 200);
      assert.match(page.body, /Client email addresses/);
      assert.match(page.body, /Choose a project/);
      assert.match(page.body, /One address per line, or commas/);
      assert.match(page.body, /autocomplete="off"[^>]*id="hhsrs-addr-test-housing-to"[^>]*>cfarrell@savillshousing\.co\.uk<\/textarea>/);
      assert.match(page.body, /name="hhsrs-to"/);
      assert.match(page.body, /id="hhsrs-addr-onward-2026-to"[^>]*>\s*<\/textarea>/);
      assert.match(page.body, /<option value="Leeds Fed HA 2026">/);
      assert.match(page.body, /<option value="MTVH 2026">/);
      assert.match(page.body, /<option value="Vico 2026">/);
      assert.match(page.body, /<option value="Onward 2026">/);
      assert.match(page.body, /<option value="Test Housing">/);
      assert.doesNotMatch(page.body, /<option value="LFHA \(Leeds\)">/);
      assert.doesNotMatch(page.body, /<option value="A2D 2026 Phase 4">/);
      assert.doesNotMatch(page.body, /<option value="Gateway 2026">/);
      assert.doesNotMatch(page.body, /<option value="Vico 2026 8k">/);
      assert.doesNotMatch(page.body, /<option value="MTVH Pilot 2026">/);
      assert.doesNotMatch(page.body, /<option value="MTVH Phase 1 2026">/);
      assert.doesNotMatch(page.body, /Flagship 2026/);
      const closed = [...page.body.matchAll(/<form class="client-email-row"[^>]*>/g)].map((match) => match[0]);
      assert.ok(closed.length > 1);
      assert.equal(closed.every((tag) => /\shidden/.test(tag)), true);
      const surveyorPage = await request(app, "GET", "/HHSRSreporter/admin", { cookie: surveyorCookie });
      assert.equal(surveyorPage.status, 403);

      const bad = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        cookie,
        body: formBody({ projectName: "Onward 2026", "hhsrs-to": "not-an-email", "hhsrs-cc": "other@client.test", "hhsrs-bcc": "" }),
      });
      assert.equal(bad.status, 302);
      const badPage = await request(app, "GET", "/HHSRSreporter/admin", {
        cookie: bad.setCookie.length ? cookieHeader(bad.setCookie) : cookie,
      });
      assert.match(badPage.body, /Not a valid address: not-an-email\./);
      assert.match(badPage.body, /id="hhsrs-addr-onward-2026-to"[^>]*>not-an-email<\/textarea>/);
      assert.match(badPage.body, /<option value="Onward 2026" selected>/);
      const badForms = [...badPage.body.matchAll(/<form class="client-email-row"[^>]*>/g)].map((match) => match[0]);
      const badOpen = badForms.filter((tag) => !/\shidden/.test(tag));
      assert.equal(badOpen.length, 1);
      assert.match(badOpen[0], /data-project="Onward 2026"/);
      assert.equal(await prisma.hhsrsClientEmail.findUnique({ where: { projectName: "Onward 2026" } }), null);

      const unknown = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        cookie,
        body: formBody({ projectName: "Nope Housing", "hhsrs-to": "desk@client.test", "hhsrs-cc": "", "hhsrs-bcc": "" }),
      });
      const unknownPage = await request(app, "GET", "/HHSRSreporter/admin", {
        cookie: unknown.setCookie.length ? cookieHeader(unknown.setCookie) : cookie,
      });
      assert.match(unknownPage.body, /Unknown project\./);
      const rosterOnly = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
        cookie,
        body: formBody({ projectName: "LFHA (Leeds)", "hhsrs-to": "leeds-fed@client.test", "hhsrs-cc": "", "hhsrs-bcc": "" }),
      });
      const rosterPage = await request(app, "GET", "/HHSRSreporter/admin", {
        cookie: rosterOnly.setCookie.length ? cookieHeader(rosterOnly.setCookie) : cookie,
      });
      assert.match(rosterPage.body, /Unknown project\./);
      assert.equal(await prisma.hhsrsClientEmail.findUnique({ where: { projectName: "LFHA (Leeds)" } }), null);

      let saveCookie = cookie;
      for (const name of liveNames) {
        const saved = await request(app, "POST", "/HHSRSreporter/admin/client-emails", {
          cookie: saveCookie,
          body: formBody({
            projectName: name,
            "hhsrs-to": savedTo[name],
            "hhsrs-cc": name === "Onward 2026" ? "other@client.test, third@client.test" : "",
            "hhsrs-bcc": name === "Onward 2026" ? "bcc@client.test" : "",
          }),
        });
        assert.equal(saved.status, 302, name);
        if (saved.setCookie.length) saveCookie = cookieHeader(saved.setCookie);
      }
      cookie = saveCookie;
      const savedPage = await request(app, "GET", "/HHSRSreporter/admin", { cookie });
      assert.match(savedPage.body, /Saved\./);
      assert.match(savedPage.body, /Last changed \d{2}\/\d{2}\/\d{4} by Phil Moon/);
      assert.match(savedPage.body, /<option value="Test Housing" selected>/);
      const onwardRow = await prisma.hhsrsClientEmail.findUnique({ where: { projectName: "Onward 2026" } });
      assert.ok(onwardRow);
      assert.equal(onwardRow.toAddresses, "onward@client.test");
      assert.equal(onwardRow.ccAddresses, "other@client.test\nthird@client.test");
      assert.equal(onwardRow.bccAddresses, "bcc@client.test");
      assert.equal(onwardRow.changedByName, "Phil Moon");
      assert.equal(await prisma.hhsrsClientEmail.findUnique({ where: { projectName: "MTVH Pilot 2026" } }), null);
      assert.equal(await prisma.hhsrsClientEmail.findUnique({ where: { projectName: "Vico 2026 8k" } }), null);

      const aliases: Record<string, string> = {
        "Leeds Fed HA 2026": "Leeds Fed HA 2026",
        "LFHA (Leeds)": "Leeds Fed HA 2026",
        "MTVH 2026": "MTVH 2026",
        "MTVH Pilot 2026": "MTVH 2026",
        "Vico 2026": "Vico 2026",
        "Vico 2026 8k": "Vico 2026",
        "Onward 2026": "Onward 2026",
        "Test Housing": "Test Housing",
      };
      for (const [submissionName, liveName] of Object.entries(aliases)) {
        const picked = await clientRecipientsForProject(submissionName);
        assert.equal(picked.to, savedTo[liveName], submissionName);
      }

      for (const name of liveNames) {
        const drafted = await request(app, "POST", "/HHSRSreporter/draft.json", {
          cookie,
          contentType: "application/json",
          body: JSON.stringify({
            projectName: name,
            address: "1 High Street",
            notes: "Loose socket in the kitchen.",
            hazard: "Electrical Hazards",
            rating: "High",
            uprn: "100123",
            surveyDate: "2026-09-20",
            includeCause: true,
            photoCount: 0,
            cat1Confirmed: true,
            onwardTopic: "Electrical",
            callOutcome: "Not yet called",
          }),
        });
        assert.equal(drafted.status, 200, drafted.body.slice(0, 180));
        const payload = JSON.parse(drafted.body) as { ok: boolean; to: string; cc: string; bcc: string };
        assert.equal(payload.ok, true, name);
        assert.equal(payload.to, savedTo[name], name);
      }
      const onwardDraft = JSON.parse(
        (
          await request(app, "POST", "/HHSRSreporter/draft.json", {
            cookie,
            contentType: "application/json",
            body: JSON.stringify({
              projectName: "Onward 2026",
              address: "1 High Street",
              notes: "Loose socket in the kitchen.",
              hazard: "Electrical Hazards",
              rating: "High",
              uprn: "100123",
              surveyDate: "2026-09-20",
              includeCause: true,
              photoCount: 0,
              cat1Confirmed: true,
              onwardTopic: "Electrical",
              callOutcome: "Not yet called",
            }),
          })
        ).body
      ) as { cc: string; bcc: string };
      assert.equal(onwardDraft.cc, "other@client.test; third@client.test");
      assert.equal(onwardDraft.bcc, "bcc@client.test");

      const row = await prisma.hhsrsSiteSubmission.create({
        data: {
          projectName: "Leeds Fed HA 2026",
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
      assert.match(sentPage.body, /Not sent\. leeds-fed@client\.test is not allowed\./);
      const fresh = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: row.id } });
      assert.equal(fresh?.emailSentAt, null);

      const resent = await request(app, "POST", `/HHSRSreporter/find/${row.id}/resend`, {
        cookie,
        body: formBody({
          checked: "1",
          to: "",
          cc: "",
          bcc: "",
          subject: "HHSRS",
          body: "Hello",
          correctionReason: "Wrong recipient",
        }),
      });
      assert.equal(resent.status, 302);
      const resentPage = await request(app, "GET", resent.location || `/HHSRSreporter/find?case=${row.id}`, {
        cookie: resent.setCookie.length ? cookieHeader(resent.setCookie) : cookie,
      });
      assert.match(resentPage.body, /Not sent\. leeds-fed@client\.test is not allowed\./);

      await prisma.hhsrsClientEmail.update({
        where: { projectName: "Onward 2026" },
        data: { toAddresses: "", ccAddresses: "", bccAddresses: "" },
      });
      const clearedDraft = await request(app, "POST", "/HHSRSreporter/draft.json", {
        cookie,
        contentType: "application/json",
        body: JSON.stringify({ projectName: "Onward 2026", address: "1 High Street", notes: "Loose socket.", hazard: "Electrical Hazards", rating: "High", uprn: "100123", surveyDate: "2026-09-20", includeCause: true, photoCount: 0, cat1Confirmed: true, onwardTopic: "Electrical", callOutcome: "Not yet called" }),
      });
      const clearedPayload = JSON.parse(clearedDraft.body) as { to: string };
      assert.equal(clearedPayload.to, "");
      await prisma.hhsrsSiteSubmission.update({ where: { id: row.id }, data: { projectName: "Onward 2026" } });
      const blockedSend = await request(app, "POST", `/HHSRSreporter/review/${row.id}/send`, {
        cookie,
        body: formBody({ checked: "1", to: "", cc: "", bcc: "" }),
      });
      const blockedPage = await request(app, "GET", blockedSend.location || `/HHSRSreporter/review/${row.id}`, {
        cookie: blockedSend.setCookie.length ? cookieHeader(blockedSend.setCookie) : cookie,
      });
      assert.match(blockedPage.body, /Add a To address\./);

      await prisma.hhsrsClientEmail.delete({ where: { projectName: "Onward 2026" } });
      const codeDraft = await clientRecipientsForProject("Onward 2026");
      assert.equal(codeDraft.to, "");
      const seeded = await clientRecipientsForProject("Test Housing");
      assert.equal(seeded.to, "test-housing@client.test");
    } finally {
      if (previousPassword === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = previousPassword;
      if (previousAllow === undefined) delete process.env.HHSRS_SEND_ALLOW_DOMAINS;
      else process.env.HHSRS_SEND_ALLOW_DOMAINS = previousAllow;
      if (caseId) await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: caseId } });
      if (createdProjectIds.length) await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
      for (const item of restoredStages) {
        await prisma.project.update({ where: { id: item.id }, data: { stage: item.stage } });
      }
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

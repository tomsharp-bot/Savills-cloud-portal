import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { prisma } from "./prisma.js";
import { HHSRS_SITE_PHOTO_STORAGE, type SitePhotoStorage } from "./hhsrs-site-photos.js";

process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

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
  opts: { cookie?: string; form?: FormData; fields?: Record<string, string>; json?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.form) {
    body = opts.form;
  } else if (opts.fields) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.fields).toString();
  } else if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    headers.accept = "application/json";
    body = JSON.stringify(opts.json);
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

function optionTag(html: string, projectId: string): string {
  const match = html.match(new RegExp(`<option[^>]*value="${projectId}"[^>]*>`));
  assert.ok(match, `project option ${projectId}`);
  return match[0];
}

function reviewForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  form.set("photos", new Blob([Uint8Array.from(jpegBytes())], { type: "image/jpeg" }), "room.jpg");
  return form;
}

describe("HHSRS manual address when a project has no stock", () => {
  it("types an address when a project has no stock, or when a stock UPRN is not found", async (t) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      t.skip("Postgres is not available");
      return;
    }
    const surveyor = await prisma.user.findFirst({ where: { role: "surveyor", frozen: false }, orderBy: { name: "asc" } });
    const admin = await prisma.user.findFirst({ where: { username: "phil.m", role: "admin" } });
    if (!surveyor?.name || !admin) {
      t.skip("Seeded admin and surveyor are not available");
      return;
    }

    const stamp = Date.now().toString(36);
    const bare = await prisma.project.create({
      data: { name: `ZZ No Stock ${stamp}`, projectManager: "Tom Sharp", stage: "current" },
    });
    const stocked = await prisma.project.create({
      data: { name: `ZZ Has Stock ${stamp}`, projectManager: "Tom Sharp", stage: "current" },
    });
    const asset = await prisma.asset.create({
      data: {
        projectId: stocked.id,
        kind: "dwelling",
        uprn: "200040123456",
        number: "4",
        street: "Stock Street",
        city: "Leeds",
        postcode: "LS2 7EY",
      },
    });
    const createdIds: string[] = [];
    t.after(async () => {
      if (createdIds.length) {
        await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined);
      }
      await prisma.asset.deleteMany({ where: { projectId: { in: [bare.id, stocked.id] } } }).catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: { in: [bare.id, stocked.id] } } }).catch(() => undefined);
    });

    const app = createApp({ basePath: "" });
    app.set(HHSRS_SITE_PHOTO_STORAGE, memoryStorage());
    const { server, port } = await listen(app);
    t.after(() => server.close());

    const login = await request(port, "POST", "/login", {
      fields: { username: "phil.m", password: "PhilMoon2468" },
    });
    assert.equal(login.status, 302);
    const cookie = cookieHeader(login.setCookie);
    assert.match(cookie, /scp_session=/);

    const formPage = await request(port, "GET", "/HHSRS-site-form/new", { cookie });
    assert.equal(formPage.status, 200);
    const bareOption = optionTag(formPage.body, bare.id);
    const stockOption = optionTag(formPage.body, stocked.id);
    assert.match(bareOption, /data-manual-address="1"/);
    assert.doesNotMatch(stockOption, /data-manual-address/);
    assert.match(formPage.body, /id="btn-lookup-uprn"/);
    assert.match(formPage.body, /No address list for this project yet\. Type the address\./);

    const common = {
      surveyDate: "2026-09-20",
      surveyorName: surveyor.name,
      category: "Damp & Mould Growth",
      rating: "Low",
      comment: `Manual address ${stamp}`,
    };
    const typed = await request(port, "POST", "/HHSRS-site-form/review", {
      cookie,
      form: reviewForm({
        ...common,
        projectId: bare.id,
        uprn: "100040123456",
        addressSource: "manual",
        addressLine1: "12 Moor Lane",
        addressLine2: "Flat 2",
        town: "Leeds",
        postcode: "ls1 4dy",
      }),
    });
    assert.equal(typed.status, 302, typed.body);
    assert.match(typed.location, /^\/HHSRS-site-form\/review\?draft=/);
    const review = await request(port, "GET", typed.location, { cookie });
    assert.equal(review.status, 200);
    assert.match(review.body, /12 Moor Lane, Flat 2, Leeds/);
    assert.match(review.body, /LS1 4DY/);
    assert.doesNotMatch(review.body, /ls1 4dy/);

    const submitted = await request(port, "POST", "/HHSRS-site-form/submit", {
      cookie,
      fields: { draftId: new URL(typed.location, "http://127.0.0.1").searchParams.get("draft") || "" },
    });
    assert.equal(submitted.status, 302, submitted.body);
    const submissionId = new URL(submitted.location, "http://127.0.0.1").searchParams.get("id") || "";
    assert.ok(submissionId);
    createdIds.push(submissionId);
    const row = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    assert.equal(row.addressSource, "manual");
    assert.equal(row.fullAddress, "12 Moor Lane, Flat 2, Leeds");
    assert.equal(row.postcode, "LS1 4DY");
    assert.equal(row.uprn, "100040123456");

    const office = await request(port, "GET", `/HHSRSreporter/review/${submissionId}`, { cookie });
    assert.equal(office.status, 200);
    assert.match(office.body, /value="12 Moor Lane, Flat 2, Leeds, LS1 4DY"/);
    assert.match(office.body, /id="address-typed-note"/);
    assert.match(office.body, /Address typed by surveyor/);

    const email = await request(port, "POST", "/HHSRSreporter/draft.json", {
      cookie,
      json: {
        caseId: submissionId,
        projectName: bare.name,
        address: "12 Moor Lane, Flat 2, Leeds, LS1 4DY",
        uprn: "100040123456",
        surveyDate: "2026-09-20",
        hazard: "Damp & Mould Growth",
        rating: "Low",
        notes: `Manual address ${stamp}`,
        photoCount: 1,
      },
    });
    assert.equal(email.status, 200, email.body);
    const emailJson = JSON.parse(email.body) as { ok?: boolean; body?: string };
    assert.equal(emailJson.ok, true);
    assert.match(emailJson.body || "", /• Address: 12 Moor Lane, Flat 2, Leeds, LS1 4DY/);

    const alerts = await request(port, "GET", "/HHSRSreporter/pending-alerts.json", { cookie });
    assert.equal(alerts.status, 200);
    const pending = JSON.parse(alerts.body) as { pending: Array<{ id: string; fullAddress: string }> };
    const alert = pending.pending.find((item) => item.id === submissionId);
    assert.ok(alert);
    assert.equal(alert.fullAddress, "12 Moor Lane, Flat 2, Leeds");

    const typedOnStock = await request(port, "POST", "/HHSRS-site-form/review", {
      cookie,
      form: reviewForm({
        ...common,
        projectId: stocked.id,
        uprn: "999000111222",
        addressSource: "manual",
        addressLine1: "9 Typed Road",
        addressLine2: "",
        town: "Leeds",
        postcode: "LS1 1AA",
        comment: `Typed after a missed UPRN ${stamp}`,
      }),
    });
    assert.equal(typedOnStock.status, 302, typedOnStock.body);
    const stockTypedReview = await request(port, "GET", typedOnStock.location, { cookie });
    assert.match(stockTypedReview.body, /9 Typed Road, Leeds/);
    assert.match(stockTypedReview.body, /LS1 1AA/);
    const stockTypedSubmit = await request(port, "POST", "/HHSRS-site-form/submit", {
      cookie,
      fields: { draftId: new URL(typedOnStock.location, "http://127.0.0.1").searchParams.get("draft") || "" },
    });
    assert.equal(stockTypedSubmit.status, 302, stockTypedSubmit.body);
    const stockTypedId = new URL(stockTypedSubmit.location, "http://127.0.0.1").searchParams.get("id") || "";
    createdIds.push(stockTypedId);
    const stockTypedRow = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: stockTypedId } });
    assert.equal(stockTypedRow.addressSource, "manual");
    assert.equal(stockTypedRow.fullAddress, "9 Typed Road, Leeds");
    assert.equal(stockTypedRow.uprn, "999000111222");
    const stockTypedOffice = await request(port, "GET", `/HHSRSreporter/review/${stockTypedId}`, { cookie });
    assert.equal(stockTypedOffice.status, 200);
    assert.match(stockTypedOffice.body, /Address typed by surveyor/);
    const stockForm = await request(port, "GET", "/HHSRS-site-form/new", { cookie });
    assert.doesNotMatch(optionTag(stockForm.body, stocked.id), /data-manual-address/);
    assert.match(stockForm.body, /Type the address instead/);
    assert.match(stockForm.body, /Back to UPRN search/);

    const lookedUp = await request(port, "POST", "/HHSRS-site-form/review", {
      cookie,
      form: reviewForm({
        ...common,
        projectId: stocked.id,
        uprn: "200040123456",
        fullAddress: "4, Stock Street, Leeds",
        postcode: "LS2 7EY",
        addressConfirmed: "true",
        comment: `Stock lookup ${stamp}`,
      }),
    });
    assert.equal(lookedUp.status, 302, lookedUp.body);
    const stockReview = await request(port, "GET", lookedUp.location, { cookie });
    assert.match(stockReview.body, /4, Stock Street, Leeds/);
    assert.match(stockReview.body, /LS2 7EY/);
    const stockSubmit = await request(port, "POST", "/HHSRS-site-form/submit", {
      cookie,
      fields: { draftId: new URL(lookedUp.location, "http://127.0.0.1").searchParams.get("draft") || "" },
    });
    assert.equal(stockSubmit.status, 302, stockSubmit.body);
    const stockId = new URL(stockSubmit.location, "http://127.0.0.1").searchParams.get("id") || "";
    createdIds.push(stockId);
    const stockRow = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: stockId } });
    assert.equal(stockRow.addressSource, "");
    assert.equal(stockRow.fullAddress, "4, Stock Street, Leeds");
    assert.equal(stockRow.postcode, "LS2 7EY");
    const stockOffice = await request(port, "GET", `/HHSRSreporter/review/${stockId}`, { cookie });
    assert.equal(stockOffice.status, 200);
    assert.doesNotMatch(stockOffice.body, /Address typed by surveyor/);

    await prisma.asset.create({
      data: { projectId: bare.id, kind: "dwelling", uprn: "300040123456", number: "1", street: "Now Loaded" },
    });
    const afterStock = await request(port, "GET", "/HHSRS-site-form/new", { cookie });
    assert.doesNotMatch(optionTag(afterStock.body, bare.id), /data-manual-address/);
    const backToLookup = await request(port, "POST", "/HHSRS-site-form/review", {
      cookie,
      form: reviewForm({
        ...common,
        projectId: bare.id,
        uprn: "100040123456",
        addressSource: "manual",
        addressLine1: "12 Moor Lane",
        postcode: "LS1 4DY",
        comment: `Stock loaded ${stamp}`,
      }),
    });
    assert.equal(backToLookup.status, 302, backToLookup.body);
    const loadedReview = await request(port, "GET", backToLookup.location, { cookie });
    assert.match(loadedReview.body, /12 Moor Lane/);
    assert.match(loadedReview.body, /LS1 4DY/);
    assert.equal(asset.uprn, "200040123456");
  });
});

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieSession from "cookie-session";
import ejs from "ejs";
import type { Express } from "express";

const renderCard = (data: Record<string, unknown>) =>
  (
    ejs as unknown as {
      renderFile: (file: string, data: Record<string, unknown>) => Promise<string>;
    }
  ).renderFile(path.join(process.cwd(), "views/hhsrs-reporter/partials/site-form-access-card.ejs"), data);
import type { AuthedUser } from "./access.js";

process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";
process.env.NODE_ENV ||= "test";

type CreateApp = (options?: { basePath?: string }) => Express;
type AccessModule = typeof import("./hhsrs-site-access.js");

type Hit = {
  status: number;
  location: string;
  body: string;
  setCookie: string[];
};

const CODE = "135790";
const SECRET_ADDRESS = "12 Secret Tenant Street";

let createApp: CreateApp;
let access: AccessModule;
let siteFormRouter: express.Router;
let reporterRouter: express.Router;

function request(
  app: Express,
  method: string,
  url: string,
  opts: { body?: string; cookie?: string; accept?: string; forwardedFor?: string } = {}
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const payload = opts.body;
      const headers: Record<string, string | number> = {};
      if (payload) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        headers["content-length"] = Buffer.byteLength(payload);
      }
      if (opts.cookie) headers.cookie = opts.cookie;
      if (opts.accept) headers.accept = opts.accept;
      if (opts.forwardedFor) headers["x-forwarded-for"] = opts.forwardedFor;
      const req = http.request({ host: "127.0.0.1", port, path: url, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
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

function cookiePair(setCookie: string[]): string {
  return setCookie
    .map((line) => line.split(";")[0])
    .filter((part) => part.startsWith("hhsrs_site_access="))
    .join("; ");
}

function person(role: AuthedUser["role"], name: string): AuthedUser {
  return {
    id: `user-${role}`,
    username: role === "admin" ? "tom.s" : "peter.m",
    role,
    name,
    firstName: name.split(" ")[0] || "",
    surname: name.split(" ").slice(1).join(" "),
    email: null,
    initials: "TS",
    agency: null,
    company: null,
    clientRole: null,
    frozen: false,
  };
}

function appWithUser(user: AuthedUser | null): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "views"));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    cookieSession({
      name: "scp_session",
      keys: ["test-session-secret"],
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    })
  );
  app.use((req, res, next) => {
    res.locals.basePath = "";
    res.locals.baseUrl = (href: string) => href;
    if (user) req.user = user;
    next();
  });
  app.use("/HHSRS-site-form", siteFormRouter);
  app.use("/HHSRSreporter", reporterRouter);
  return app;
}

before(async () => {
  access = await import("./hhsrs-site-access.js");
  access.useMemorySiteFormAccess({ code: CODE });
  ({ createApp } = await import("../app.js"));
  ({ hhsrsSiteFormRouter: siteFormRouter } = await import("../routes/hhsrs-site-form.js"));
  ({ hhsrsReporterRouter: reporterRouter } = await import("../routes/hhsrs-reporter.js"));
});

describe("HHSRS site form access code", { concurrency: 1 }, () => {
  it("shows the code screen and blocks every data endpoint without a code", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const home = await request(app, "GET", "/HHSRS-site-form");
    assert.equal(home.status, 200);
    assert.match(home.body, /Enter access code/);
    assert.match(home.body, /You only need to do this once on this phone\./);
    assert.match(home.body, /inputmode="numeric"/);
    assert.match(home.body, /maxlength="6"/);
    assert.match(home.body, />Continue</);
    assert.match(home.body, /No code\? Ask the HHSRS team\./);
    assert.doesNotMatch(home.body, /name="projectId"/);
    assert.doesNotMatch(home.body, /Report new issue/);
    assert.doesNotMatch(home.body, new RegExp(CODE));

    const form = await request(app, "GET", "/HHSRS-site-form/new");
    assert.equal(form.status, 200);
    assert.match(form.body, /Enter access code/);
    assert.doesNotMatch(form.body, /name="projectId"/);
    assert.doesNotMatch(form.body, /Demo current project/);

    const lookup = await request(
      app,
      "GET",
      "/HHSRS-site-form/stock-lookup?projectId=p1&uprn=100040123456",
      { accept: "application/json" }
    );
    assert.equal(lookup.status, 401);
    assert.deepEqual(JSON.parse(lookup.body), { error: "Access code required" });
    assert.doesNotMatch(lookup.body, /Moor Cross|fullAddress|match/);

    const photo = await request(app, "GET", "/HHSRS-site-form/draft/abc/photo/secret.jpg");
    assert.equal(photo.status, 401);
    assert.deepEqual(JSON.parse(photo.body), { error: "Access code required" });

    const review = await request(app, "POST", "/HHSRS-site-form/review", {
      body: `fullAddress=${encodeURIComponent(SECRET_ADDRESS)}&uprn=100040123456`,
    });
    assert.equal(review.status, 401);
    assert.match(review.body, /Enter access code/);
    assert.doesNotMatch(review.body, /Secret Tenant Street/);

    for (const pathName of ["/HHSRS-site-form/submit", "/HHSRS-site-form/edit", "/HHSRS-site-form/cancel"]) {
      const blocked = await request(app, "POST", pathName, { body: "draftId=abc" });
      assert.equal(blocked.status, 401, pathName);
      assert.doesNotMatch(blocked.body, /Secret Tenant Street/);
    }

    const css = await request(app, "GET", "/HHSRS-site-form/assets/form.css");
    assert.equal(css.status, 200);
    assert.match(css.body, /\.hhsrs-gate \.gate-input/);
  });

  it("rejects a wrong code and accepts the right one with a long signed cookie", async () => {
    access.resetSiteFormAttemptsForTests();
    const app = createApp({ basePath: "/projectprogress" });
    const ip = "198.51.100.10";
    const wrong = await request(app, "POST", "/HHSRS-site-form/access", {
      body: "code=000000&next=/HHSRS-site-form/new",
      forwardedFor: ip,
    });
    assert.equal(wrong.status, 401);
    assert.match(wrong.body, /Wrong code\. Try again\./);
    assert.equal(cookiePair(wrong.setCookie), "");
    assert.doesNotMatch(wrong.body, new RegExp(CODE));

    const right = await request(app, "POST", "/HHSRS-site-form/access", {
      body: `code=${CODE}&next=/HHSRS-site-form/new`,
      forwardedFor: ip,
    });
    assert.equal(right.status, 302);
    assert.equal(right.location, "/HHSRS-site-form/new");
    const issued = right.setCookie.find((line) => line.startsWith("hhsrs_site_access="));
    assert.ok(issued, "missing access cookie");
    assert.match(issued, /HttpOnly/i);
    assert.match(issued, /Secure/i);
    assert.match(issued, /SameSite=Lax/i);
    assert.match(issued, /Max-Age=34560000/);
    assert.match(issued, /Path=\/HHSRS-site-form/);
    assert.doesNotMatch(issued, new RegExp(CODE));

    const cookie = cookiePair(right.setCookie);
    const opened = await request(app, "GET", "/HHSRS-site-form/new", { cookie });
    assert.equal(opened.status, 200);
    assert.match(opened.body, /name="projectId"/);
    assert.doesNotMatch(opened.body, /Enter access code/);

    const lookup = await request(app, "GET", "/HHSRS-site-form/stock-lookup?projectId=hhsrs-demo-current&uprn=100", {
      cookie,
      accept: "application/json",
    });
    assert.notEqual(lookup.status, 401);
    assert.doesNotMatch(lookup.body, /Access code required/);
  });

  it("drops every phone when the code changes", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const before = await access.loadSiteFormAccess();
    const oldCookie = access.siteFormAccessCookieHeader(before);
    const opened = await request(app, "GET", "/HHSRS-site-form/new", { cookie: oldCookie });
    assert.match(opened.body, /name="projectId"/);

    const next = await access.changeSiteFormAccessCode("246801", "Tom Sharp");
    assert.notEqual(next.fingerprint, before.fingerprint);
    assert.equal(next.version, before.version + 1);
    assert.equal(next.code, "246801");
    assert.match(access.accessChangedLine(next), /^Last changed \d{2}\/\d{2}\/\d{4} by Tom Sharp$/);

    const stale = await request(app, "GET", "/HHSRS-site-form/new", { cookie: oldCookie });
    assert.match(stale.body, /Enter access code/);
    assert.doesNotMatch(stale.body, /name="projectId"/);
    const staleLookup = await request(app, "GET", "/HHSRS-site-form/stock-lookup?projectId=p1&uprn=1", {
      cookie: oldCookie,
      accept: "application/json",
    });
    assert.equal(staleLookup.status, 401);

    const fresh = await request(app, "GET", "/HHSRS-site-form/new", {
      cookie: access.siteFormAccessCookieHeader(next),
    });
    assert.match(fresh.body, /name="projectId"/);

    const tampered = oldCookie.replace(/.$/, (char) => (char === "a" ? "b" : "a"));
    const bad = await request(app, "GET", "/HHSRS-site-form/stock-lookup?uprn=1", {
      cookie: tampered,
      accept: "application/json",
    });
    assert.equal(bad.status, 401);
  });

  it("locks an address after 10 wrong tries for 15 minutes", async () => {
    access.resetSiteFormAttemptsForTests();
    const app = createApp({ basePath: "/projectprogress" });
    const ip = "198.51.100.44";
    const current = (await access.loadSiteFormAccess()).code;
    for (let n = 0; n < 10; n += 1) {
      const wrong = await request(app, "POST", "/HHSRS-site-form/access", {
        body: "code=000000&next=/HHSRS-site-form",
        forwardedFor: ip,
      });
      assert.equal(wrong.status, 401, `attempt ${n + 1}`);
      assert.match(wrong.body, /Wrong code\. Try again\./);
    }
    const locked = await request(app, "POST", "/HHSRS-site-form/access", {
      body: `code=${current}&next=/HHSRS-site-form/new`,
      forwardedFor: ip,
    });
    assert.equal(locked.status, 429);
    assert.match(locked.body, /Too many tries\. Wait a few minutes\./);
    assert.equal(cookiePair(locked.setCookie), "");

    const other = await request(app, "POST", "/HHSRS-site-form/access", {
      body: `code=${current}&next=/HHSRS-site-form`,
      forwardedFor: "198.51.100.45",
    });
    assert.equal(other.status, 302);

    assert.equal(access.siteFormAttemptLocked(ip, Date.now()), true);
    assert.equal(access.siteFormAttemptLocked(ip, Date.now() + access.SITE_FORM_ATTEMPT_WINDOW_MS), false);
  });

  it("lets a signed-in portal user open the form and the stock lookup without the code", async () => {
    const app = appWithUser(person("surveyor", "Peter May"));
    const form = await request(app, "GET", "/HHSRS-site-form/new");
    assert.equal(form.status, 200);
    assert.match(form.body, /name="projectId"/);
    assert.doesNotMatch(form.body, /Enter access code/);

    const lookup = await request(app, "GET", "/HHSRS-site-form/stock-lookup?projectId=hhsrs-demo-current&uprn=100040123456", {
      accept: "application/json",
    });
    assert.notEqual(lookup.status, 401);
    assert.doesNotMatch(lookup.body, /Secret Tenant|Moor Cross/);
  });

  it("keeps the access code on the admin page and away from everyone else", async () => {
    const hidden = await renderCard({
      siteFormAccessCode: "135790",
      siteFormAccessChangedLine: "Last changed 28/09/2026 by Tom Sharp",
      siteFormAccessSaved: false,
      siteFormAccessError: "",
      siteFormAccessEditing: false,
      reporterBase: "/HHSRSreporter",
    });
    assert.match(hidden, /Site form access code/);
    assert.match(hidden, /••••••/);
    assert.match(hidden, />Show</);
    assert.match(hidden, /Surveyors enter this once on each phone\./);
    assert.match(hidden, /Last changed 28\/09\/2026 by Tom Sharp/);
    assert.match(hidden, />Change code</);
    assert.match(hidden, /hidden/);
    assert.doesNotMatch(hidden, />135790</);

    const open = await renderCard({
      siteFormAccessCode: "135790",
      siteFormAccessChangedLine: "Last changed 28/09/2026 by Tom Sharp",
      siteFormAccessSaved: true,
      siteFormAccessError: "",
      siteFormAccessEditing: true,
      reporterBase: "/HHSRSreporter",
    });
    assert.match(open, /Code changed\./);
    assert.match(open, /New code/);
    assert.match(open, /Make one for me/);
    assert.match(open, /All phones will need the new code\./);
    assert.match(open, />Save</);
    assert.match(open, />Cancel</);
    assert.match(open, /id="site-access-form"(?![^>]*hidden)/);

    const portal = createApp({ basePath: "/projectprogress" });
    const outsider = await request(portal, "POST", "/HHSRSreporter/admin/site-form-access", {
      body: "code=112233",
    });
    assert.equal(outsider.status, 302);
    assert.equal(outsider.location, "/projectprogress/login");
    assert.notEqual((await access.loadSiteFormAccess()).code, "112233");

    const before = await access.loadSiteFormAccess();
    const surveyorApp = appWithUser(person("surveyor", "Peter May"));
    const surveyor = await request(surveyorApp, "POST", "/HHSRSreporter/admin/site-form-access", {
      body: "code=112233",
    });
    assert.equal(surveyor.status, 403);
    assert.match(surveyor.body, /Admin only/);
    assert.equal((await access.loadSiteFormAccess()).code, before.code);
    assert.doesNotMatch(surveyor.body, new RegExp(before.code));

    const adminApp = appWithUser(person("admin", "Tom Sharp"));
    const saved = await request(adminApp, "POST", "/HHSRSreporter/admin/site-form-access", {
      body: "code=112233",
    });
    assert.equal(saved.status, 302);
    assert.equal(saved.location, "/HHSRSreporter/admin");
    const after = await access.loadSiteFormAccess();
    assert.equal(after.code, "112233");
    assert.equal(after.changedByName, "Tom Sharp");
    assert.equal(after.version, before.version + 1);

    const bad = await request(adminApp, "POST", "/HHSRSreporter/admin/site-form-access", {
      body: "code=12",
    });
    assert.equal(bad.status, 302);
    assert.equal((await access.loadSiteFormAccess()).code, "112233");

    const outside = access.safeSiteFormNext("https://evil.example/steal");
    assert.equal(outside, "/HHSRS-site-form");
    assert.equal(access.isSixDigitCode("012345"), true);
    assert.equal(access.isSixDigitCode("12345"), false);
    assert.equal(access.SITE_FORM_ACCESS_MAX_AGE_SEC, 400 * 24 * 60 * 60);
  });

  it("generates a 6-digit code the first time none is stored", async (t) => {
    const { prisma } = await import("./prisma.js");
    access.resetSiteFormAccessForTests();
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.hhsrsSiteFormAccess.deleteMany();
    } catch {
      t.skip("Postgres is not available");
      return;
    }
    const created = await access.loadSiteFormAccess();
    assert.match(created.code, /^[0-9]{6}$/);
    assert.equal(created.version, 1);
    assert.equal(created.changedByName, "");
    assert.equal(access.accessChangedLine(created).includes(" by "), false);
    const again = await access.loadSiteFormAccess();
    assert.equal(again.code, created.code);
    assert.equal(again.fingerprint, created.fingerprint);
  });
});

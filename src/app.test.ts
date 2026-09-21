import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

process.env.DATABASE_URL ||=
  "postgresql://portal:portal@127.0.0.1:5432/savills_cloud_portal?schema=public";
process.env.SESSION_SECRET ||= "test-session-secret";

type CreateApp = (options?: { basePath?: string }) => Express;

type Hit = {
  status: number;
  location: string;
  body: string;
  contentType: string;
};

let createApp: CreateApp;

function request(
  app: Express,
  method: string,
  url: string,
  opts: { body?: string | Buffer; contentType?: string } = {}
): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const payload = opts.body;
      const contentLength = payload
        ? Buffer.isBuffer(payload)
          ? payload.length
          : Buffer.byteLength(payload)
        : 0;
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: url,
          method,
          headers: payload
            ? {
                "content-type": opts.contentType || "application/x-www-form-urlencoded",
                "content-length": contentLength,
              }
            : undefined,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode || 0,
              location: String(res.headers.location || ""),
              body: Buffer.concat(chunks).toString("utf8"),
              contentType: String(res.headers["content-type"] || ""),
            });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end(payload);
    });
  });
}

function hhsrsReviewFields(): Record<string, string> {
  return {
    projectId: "hhsrs-demo-current",
    surveyDate: "2026-09-20",
    uprn: "100123",
    fullAddress: "1 High Street",
    postcode: "EX1 1AA",
    surveyorName: "Alex Surveyor",
    category: "Damp & Mould Growth",
    rating: "High",
    comment: "Visible mould in bathroom.",
    clientCallReference: "",
    otherDetails: "",
  };
}

function multipartForm(
  fields: Record<string, string>,
  files: { field: string; filename: string; type: string; data: Buffer }[] = []
): { body: Buffer; contentType: string } {
  const boundary = "----hhsrsTestBoundary7MA4YWxkTrZu0gW";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`
      )
    );
    parts.push(file.data);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function fakeJpeg(bytes: number): Buffer {
  const buf = Buffer.alloc(bytes, 0x41);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

before(async () => {
  ({ createApp } = await import("./app.js"));
});

describe("createApp without BASE_PATH (local default)", () => {
  it("serves /health at the container root", async () => {
    const app = createApp({ basePath: "" });
    const res = await request(app, "GET", "/health");
    assert.equal(res.status, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.ok, true);
    assert.equal(json.service, "savills-cloud-portal");
  });

  it("serves login and static assets at the domain root", async () => {
    const app = createApp({ basePath: "" });
    const login = await request(app, "GET", "/login");
    assert.equal(login.status, 200);
    assert.match(login.body, /Savills Cloud Portal/);
    assert.match(login.body, /action="\/login"/);
    assert.match(login.body, /href="\/css\/app.css"/);

    const css = await request(app, "GET", "/css/app.css");
    assert.equal(css.status, 200);
    assert.match(css.contentType, /css/);
  });

  it("redirects / to /login when signed out", async () => {
    const app = createApp({ basePath: "" });
    const res = await request(app, "GET", "/");
    assert.equal(res.status, 302);
    assert.equal(res.location, "/login");
  });
});

describe("createApp with BASE_PATH=/projectprogress", () => {
  it("keeps DigitalOcean /health at the container root", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const res = await request(app, "GET", "/health");
    assert.equal(res.status, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.ok, true);
  });

  it("also exposes health under the base path", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const res = await request(app, "GET", "/projectprogress/health");
    assert.equal(res.status, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.ok, true);
  });

  it("sends domain-root / to /projectprogress with a one-line portal link", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const res = await request(app, "GET", "/");
    assert.equal(res.status, 302);
    assert.equal(res.location, "/projectprogress");
    assert.match(res.body, /Savills Cloud Portal/);
    assert.match(res.body, /href="\/projectprogress"/);
  });

  it("does not serve the app at unprefixed /login", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const res = await request(app, "GET", "/login");
    assert.equal(res.status, 404);
  });

  it("serves login, CSS and form actions under /projectprogress", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const login = await request(app, "GET", "/projectprogress/login");
    assert.equal(login.status, 200);
    assert.match(login.body, /action="\/projectprogress\/login"/);
    assert.match(login.body, /href="\/projectprogress\/css\/app.css"/);
    assert.match(login.body, /APP_BASE_PATH = "\/projectprogress"/);

    const css = await request(app, "GET", "/projectprogress/css/app.css");
    assert.equal(css.status, 200);

    const rootCss = await request(app, "GET", "/css/app.css");
    assert.equal(rootCss.status, 404);
  });

  it("redirects /projectprogress and /projectprogress/ to login when signed out", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const bare = await request(app, "GET", "/projectprogress");
    assert.equal(bare.status, 302);
    assert.equal(bare.location, "/projectprogress/login");
    const slash = await request(app, "GET", "/projectprogress/");
    assert.equal(slash.status, 302);
    assert.equal(slash.location, "/projectprogress/login");
  });

  it("sends unauthenticated /projectprogress/projects to /projectprogress/login", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const res = await request(app, "GET", "/projectprogress/projects");
    assert.equal(res.status, 302);
    assert.equal(res.location, "/projectprogress/login");
  });
});

describe("HHSRS site form at domain-root paths", () => {
  it("serves the landing page at /HHSRS-site-form when the portal is prefixed", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const res = await request(app, "GET", "/HHSRS-site-form");
    assert.equal(res.status, 200);
    assert.match(res.body, /Savills HHSRS Site Reporting/);
    assert.match(res.body, /Click Here For New Issue Form/);
    assert.match(res.body, /href="\/HHSRS-site-form\/new"/);
    assert.match(res.body, /href="\/HHSRS-site-form\/assets\/form.css"/);
    assert.doesNotMatch(res.body, /\/projectprogress\/HHSRS-site-form/);
  });

  it("serves CSS and the new-issue form at root paths", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const css = await request(app, "GET", "/HHSRS-site-form/assets/form.css");
    assert.equal(css.status, 200);
    assert.match(css.contentType, /css/);

    const form = await request(app, "GET", "/HHSRS-site-form/new");
    assert.equal(form.status, 200);
    assert.match(form.body, /name="projectId"/);
    assert.match(form.body, /Demo current project \(local\)/);
    assert.match(form.body, /name="surveyDate"/);
    assert.match(form.body, /HHSRS category/);
    assert.match(form.body, /Client call reference \(if required\)/);
    assert.match(form.body, /Any other details/);
    assert.match(form.body, /action="\/HHSRS-site-form\/review"/);
    assert.match(form.body, /each photo up to 40MB/i);
    assert.match(form.body, /accept="[^"]*image\/heic[^"]*image\/heif/);
    assert.match(form.body, /data-max-file-mb="40"/);
    assert.match(form.body, /id="clear-form"/);
    assert.match(form.body, /hhsrs-btn-secondary/);
    assert.match(form.body, /type="button"[^>]*>Clear Form</);
    const reviewIdx = form.body.indexOf(">Review<");
    const clearIdx = form.body.indexOf(">Clear Form<");
    assert.ok(reviewIdx !== -1 && clearIdx > reviewIdx, "Clear Form sits under Review on the new-issue form");
    assert.match(css.body, /\.hhsrs-btn-secondary/);

    const js = await request(app, "GET", "/HHSRS-site-form/assets/form.js");
    assert.equal(js.status, 200);
    assert.match(js.body, /Clear the form\? This cannot be undone\./);
    assert.match(js.body, /Europe\/London/);
  });

  it("accepts a JPEG larger than the old 8MB cap and rejects over 40MB", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const okUpload = multipartForm(hhsrsReviewFields(), [
      { field: "photos", filename: "iphone.jpg", type: "image/jpeg", data: fakeJpeg(9 * 1024 * 1024) },
    ]);
    const accepted = await request(app, "POST", "/HHSRS-site-form/review", okUpload);
    assert.equal(accepted.status, 302);
    assert.match(accepted.location, /^\/HHSRS-site-form\/review\?draft=/);
    assert.doesNotMatch(accepted.body, /8MB/);

    const heic = multipartForm(hhsrsReviewFields(), [
      { field: "photos", filename: "IMG_1234.HEIC", type: "image/heic", data: fakeJpeg(1024) },
    ]);
    const heicRes = await request(app, "POST", "/HHSRS-site-form/review", heic);
    assert.equal(heicRes.status, 302);

    const tooBig = multipartForm(hhsrsReviewFields(), [
      {
        field: "photos",
        filename: "huge.jpg",
        type: "image/jpeg",
        data: fakeJpeg(40 * 1024 * 1024 + 64),
      },
    ]);
    const rejected = await request(app, "POST", "/HHSRS-site-form/review", tooBig);
    assert.equal(rejected.status, 200);
    assert.match(rejected.body, /each photo up to 40MB/i);
    assert.doesNotMatch(rejected.body, /8MB or smaller/);
  });

  it("also serves the landing page at lowercase /hhsrs-site-form", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const res = await request(app, "GET", "/hhsrs-site-form");
    assert.equal(res.status, 200);
    assert.match(res.body, /Savills HHSRS Site Reporting/);
  });

  it("shows a local demo project and can open the review page", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const form = await request(app, "GET", "/HHSRS-site-form/new");
    assert.match(form.body, /Demo current project \(local\)/);

    const body = [
      "projectId=hhsrs-demo-current",
      "surveyDate=2026-09-20",
      "uprn=100123",
      "fullAddress=1+High+Street",
      "postcode=EX1+1AA",
      "surveyorName=Alex+Surveyor",
      "category=" + encodeURIComponent("Damp & Mould Growth"),
      "rating=High",
      "comment=" + encodeURIComponent("Visible mould in bathroom."),
      "clientCallReference=",
      "otherDetails=",
    ].join("&");
    const reviewPost = await request(app, "POST", "/HHSRS-site-form/review", { body });
    assert.equal(reviewPost.status, 302);
    assert.match(reviewPost.location, /^\/HHSRS-site-form\/review\?draft=/);
    assert.doesNotMatch(reviewPost.location, /projectprogress/);

    const review = await request(app, "GET", reviewPost.location);
    assert.equal(review.status, 200);
    assert.match(review.body, /Review issue/);
    assert.match(review.body, /Damp &amp; Mould Growth/);
    assert.match(review.body, /Visible mould in bathroom/);
    assert.match(review.body, />Submit</);
    assert.match(review.body, />Edit</);
    assert.match(review.body, />Cancel</);
    assert.doesNotMatch(review.body, /Clear Form/);
  });

  it("returns validation errors on Review without saving", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const res = await request(app, "POST", "/HHSRS-site-form/review", {
      body: "projectId=&uprn=&comment=",
    });
    assert.equal(res.status, 200);
    assert.match(res.body, /Please fix the following/);
    assert.match(res.body, /Select a project/);
    assert.match(res.body, /Enter the UPRN/);
  });

  it("keeps /health and /projectprogress portal routes unchanged", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const health = await request(app, "GET", "/health");
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);

    const root = await request(app, "GET", "/");
    assert.equal(root.status, 302);
    assert.equal(root.location, "/projectprogress");

    const login = await request(app, "GET", "/projectprogress/login");
    assert.equal(login.status, 200);
    assert.match(login.body, /Savills Cloud Portal/);

    const unprefixedLogin = await request(app, "GET", "/login");
    assert.equal(unprefixedLogin.status, 404);

    const adminList = await request(app, "GET", "/projectprogress/hhsrs-submissions");
    assert.equal(adminList.status, 302);
    assert.equal(adminList.location, "/projectprogress/login");
  });
});

describe("Account password and Personnel temp reset", () => {
  it("keeps login working and sends signed-out users to login from Change password", async () => {
    const app = createApp({ basePath: "" });
    const login = await request(app, "GET", "/login");
    assert.equal(login.status, 200);
    assert.match(login.body, /name="password"/);
    assert.match(login.body, /Log in/);
    assert.doesNotMatch(login.body, /PhilMoon2468/);
    assert.doesNotMatch(login.body, /Demo accounts/);
    assert.doesNotMatch(login.body, /phil\.m/);

    const account = await request(app, "GET", "/account/password");
    assert.equal(account.status, 302);
    assert.equal(account.location, "/login");

    const accountRoot = await request(app, "GET", "/account");
    assert.equal(accountRoot.status, 302);
    assert.equal(accountRoot.location, "/login");

    const personnel = await request(app, "GET", "/personnel");
    assert.equal(personnel.status, 302);
    assert.equal(personnel.location, "/login");
  });

  it("prefixes Change password under BASE_PATH=/projectprogress", async () => {
    const app = createApp({ basePath: "/projectprogress" });
    const account = await request(app, "GET", "/projectprogress/account/password");
    assert.equal(account.status, 302);
    assert.equal(account.location, "/projectprogress/login");
  });

  it("ships Change password in the header and copy/reset helpers on static assets", async () => {
    const app = createApp({ basePath: "" });
    const css = await request(app, "GET", "/css/app.css");
    assert.equal(css.status, 200);
    assert.match(css.body, /\.account-card/);
    assert.match(css.body, /\.temp-pw-row/);
    assert.match(css.body, /\.pw-admin-note/);

    const js = await request(app, "GET", "/js/app.js");
    assert.equal(js.status, 200);
    assert.match(js.body, /data-copy/);
    assert.match(js.body, /change-password-form/);
    assert.match(js.body, /New password must be at least 10 characters/);
  });
});

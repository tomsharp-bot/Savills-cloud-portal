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

function request(app: Express, method: string, url: string): Promise<Hit> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        { host: "127.0.0.1", port, path: url, method },
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
      req.end();
    });
  });
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

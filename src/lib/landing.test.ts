import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postLoginPath } from "./landing.js";

const root = process.cwd();

describe("postLoginPath", () => {
  it("sends admins to the hub and everyone else to Project Progress", () => {
    assert.equal(postLoginPath("admin"), "/admin");
    assert.equal(postLoginPath("surveyor"), "/projects");
    assert.equal(postLoginPath("client"), "/projects");
    assert.equal(postLoginPath(null), "/projects");
    assert.equal(postLoginPath(undefined), "/projects");
  });
});

describe("admin hub tiles", () => {
  it("links HHSRS Reporter at the domain root and the other sections under the portal", () => {
    const hub = readFileSync(join(root, "views/admin.ejs"), "utf8");
    assert.match(hub, /baseUrl\('\/HHSRSreporter'\)/);
    assert.match(hub, /HHSRS Reporter/);
    assert.match(hub, /baseUrl\('\/projects'\)/);
    assert.match(hub, /Project Progress/);
    assert.match(hub, /baseUrl\('\/personnel'\)/);
    assert.match(hub, /Personnel/);
    assert.match(hub, /baseUrl\('\/photos'\)/);
    assert.match(hub, />Photos</);
    assert.match(hub, /baseUrl\('\/projects-programme'\)/);
    assert.match(hub, /Projects Programme/);
    assert.doesNotMatch(hub, /projectprogress\/HHSRSreporter/);
    assert.doesNotMatch(hub, /class="admin-tile is-soon"/);
  });

  it("sends the header home link to the hub for admins and Project Progress otherwise", () => {
    const topbar = readFileSync(join(root, "views/partials/topbar.ejs"), "utf8");
    assert.match(topbar, /baseUrl\(isAdmin \? '\/admin' : '\/projects'\)/);
    assert.match(topbar, /baseUrl\('\/photos'\)/);
    assert.match(topbar, /Photo Storage/);
  });
});

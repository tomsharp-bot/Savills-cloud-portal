import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postLoginPath } from "./landing.js";

const root = process.cwd();

describe("postLoginPath", () => {
  it("sends admins to the hub, surveyors to their home, and clients to Project Progress", () => {
    assert.equal(postLoginPath("admin"), "/admin");
    assert.equal(postLoginPath("surveyor"), "/surveyor");
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
    assert.match(hub, /baseUrl\('\/reference-documents'\)/);
    assert.match(hub, /Reference Documents/);
    assert.doesNotMatch(hub, /projectprogress\/HHSRSreporter/);
    assert.doesNotMatch(hub, /class="admin-tile is-soon"/);
  });

  it("gives surveyors a two-tile home and keeps the other admin sections off it", () => {
    const page = readFileSync(join(root, "views/surveyor.ejs"), "utf8");
    assert.match(page, /baseUrl\('\/projects'\)/);
    assert.match(page, /Project Progress/);
    assert.match(page, /baseUrl\('\/reference-documents'\)/);
    assert.match(page, /Reference Documents/);
    assert.equal(page.match(/class="admin-tile"/g)?.length, 2);
    assert.doesNotMatch(page, /Personnel/);
    assert.doesNotMatch(page, /Photo Storage/);
    assert.doesNotMatch(page, /HHSRS Reporter/);
    assert.doesNotMatch(page, /Projects Programme/);
  });

  it("sends the header home link to the admin hub, the surveyor home, or Project Progress", () => {
    const topbar = readFileSync(join(root, "views/partials/topbar.ejs"), "utf8");
    assert.match(topbar, /baseUrl\(isAdmin \? '\/admin' : \(isSurveyor \? '\/surveyor' : '\/projects'\)\)/);
    assert.match(topbar, /isAdmin \|\| isSurveyor/);
    assert.match(topbar, /baseUrl\('\/reference-documents'\)/);
    assert.match(topbar, /Reference Documents/);
    assert.match(topbar, /baseUrl\('\/photos'\)/);
    assert.match(topbar, /Photo Storage/);
    assert.match(topbar, /href="<%= baseUrl\('\/projects'\) %>">Projects/);
    assert.match(topbar, /<details class="nav-menu">/);
    assert.match(topbar, /baseUrl\('\/personnel'\)/);
    const projectsAt = topbar.indexOf(`baseUrl('/projects') %>">Projects`);
    const menuAt = topbar.indexOf("nav-menu");
    const personnelAt = topbar.indexOf("baseUrl('/personnel')");
    assert.ok(projectsAt >= 0 && projectsAt < menuAt && menuAt < personnelAt);
    assert.doesNotMatch(topbar, /<a class="linkish"[^>]*>Personnel<\/a>/);
  });
});

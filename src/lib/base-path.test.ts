import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  baseUrl,
  configuredBasePath,
  normalizeBasePath,
  prefixRedirectUrl,
} from "./base-path.js";

describe("normalizeBasePath", () => {
  it("treats empty, whitespace and / as no prefix (local default)", () => {
    assert.equal(normalizeBasePath(""), "");
    assert.equal(normalizeBasePath("   "), "");
    assert.equal(normalizeBasePath("/"), "");
    assert.equal(normalizeBasePath(undefined), "");
    assert.equal(normalizeBasePath(null), "");
  });

  it("accepts /projectprogress with or without trailing slash or leading slash", () => {
    assert.equal(normalizeBasePath("/projectprogress"), "/projectprogress");
    assert.equal(normalizeBasePath("/projectprogress/"), "/projectprogress");
    assert.equal(normalizeBasePath("projectprogress"), "/projectprogress");
    assert.equal(normalizeBasePath("  /projectprogress/  "), "/projectprogress");
  });
});

describe("configuredBasePath", () => {
  it("prefers BASE_PATH over APP_BASE_PATH", () => {
    assert.equal(configuredBasePath({ BASE_PATH: "/projectprogress", APP_BASE_PATH: "/other" }), "/projectprogress");
    assert.equal(configuredBasePath({ APP_BASE_PATH: "/projectprogress" }), "/projectprogress");
    assert.equal(configuredBasePath({}), "");
  });
});

describe("baseUrl", () => {
  it("leaves paths unchanged when no prefix is set", () => {
    assert.equal(baseUrl("/login"), "/login");
    assert.equal(baseUrl("/projects?tab=loader"), "/projects?tab=loader");
    assert.equal(baseUrl("/"), "/");
    assert.equal(baseUrl(""), "/");
  });

  it("prefixes in-app paths and query strings", () => {
    const base = "/projectprogress";
    assert.equal(baseUrl("/login", base), "/projectprogress/login");
    assert.equal(baseUrl("/projects/abc?tab=loader", base), "/projectprogress/projects/abc?tab=loader");
    assert.equal(baseUrl("/", base), "/projectprogress");
    assert.equal(baseUrl("", base), "/projectprogress");
    assert.equal(baseUrl("personnel", base), "/projectprogress/personnel");
  });

  it("does not double-prefix or rewrite absolute URLs", () => {
    const base = "/projectprogress";
    assert.equal(baseUrl("/projectprogress/login", base), "/projectprogress/login");
    assert.equal(baseUrl("https://example.com/login", base), "https://example.com/login");
    assert.equal(baseUrl("//cdn.example/x", base), "//cdn.example/x");
  });

  it("leaves HHSRS site-form root paths unprefixed", () => {
    const base = "/projectprogress";
    assert.equal(baseUrl("/HHSRS-site-form", base), "/HHSRS-site-form");
    assert.equal(baseUrl("/HHSRS-site-form/new", base), "/HHSRS-site-form/new");
    assert.equal(baseUrl("/hhsrs-site-form", base), "/hhsrs-site-form");
    assert.equal(baseUrl("/login", base), "/projectprogress/login");
  });
});

describe("prefixRedirectUrl", () => {
  it("prefixes absolute in-app redirects and leaves others alone", () => {
    assert.equal(prefixRedirectUrl("/login", ""), "/login");
    assert.equal(prefixRedirectUrl("/login", "/projectprogress"), "/projectprogress/login");
    assert.equal(prefixRedirectUrl("/projectprogress/projects", "/projectprogress"), "/projectprogress/projects");
    assert.equal(prefixRedirectUrl("https://savillscloudportal.co.uk/x", "/projectprogress"), "https://savillscloudportal.co.uk/x");
    assert.equal(prefixRedirectUrl("next", "/projectprogress"), "next");
    assert.equal(prefixRedirectUrl("", "/projectprogress"), "/projectprogress");
    assert.equal(prefixRedirectUrl("/HHSRS-site-form", "/projectprogress"), "/HHSRS-site-form");
    assert.equal(prefixRedirectUrl("/HHSRS-site-form/thanks?id=1", "/projectprogress"), "/HHSRS-site-form/thanks?id=1");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AuthedUser } from "./access.js";
import {
  canEditSampleAnalysis,
  canManageReferenceDocuments,
  canSeeCompletions,
  canSeeProjectTab,
  canSeeReferenceDocuments,
  defaultProjectTab,
  visibleProjectTabs,
} from "./access.js";

function user(role: AuthedUser["role"]): AuthedUser {
  return {
    id: role,
    username: role,
    role,
    name: role,
    email: null,
    initials: null,
    agency: null,
    company: null,
    clientRole: null,
    frozen: false,
  };
}

describe("Reference documents access", () => {
  it("lets admins and surveyors in, and keeps clients out", () => {
    assert.equal(canSeeReferenceDocuments(user("admin")), true);
    assert.equal(canSeeReferenceDocuments(user("surveyor")), true);
    assert.equal(canSeeReferenceDocuments(user("client")), false);
    assert.equal(canSeeReferenceDocuments(null), false);
    assert.equal(canManageReferenceDocuments(user("admin")), true);
    assert.equal(canManageReferenceDocuments(user("surveyor")), false);
    assert.equal(canManageReferenceDocuments(user("client")), false);
  });
});

describe("Project tab visibility", () => {
  it("lets clients see only Completions", () => {
    const client = user("client");
    assert.deepEqual(visibleProjectTabs(client), ["completions"]);
    assert.equal(defaultProjectTab(client), "completions");
    assert.equal(canSeeProjectTab(client, "summary"), false);
    assert.equal(canSeeProjectTab(client, "sample-analysis"), false);
    assert.equal(canSeeProjectTab(client, "dwellings"), false);
    assert.equal(canSeeProjectTab(client, "documents"), false);
    assert.equal(canSeeProjectTab(client, "loader"), false);
    assert.equal(canSeeCompletions(client), true);
  });

  it("hides Completions from surveyors", () => {
    const surveyor = user("surveyor");
    assert.equal(canSeeProjectTab(surveyor, "completions"), false);
    assert.equal(canSeeCompletions(surveyor), false);
    assert.equal(canSeeProjectTab(surveyor, "dwellings"), true);
    assert.equal(canSeeProjectTab(surveyor, "summary"), true);
    assert.equal(canSeeProjectTab(surveyor, "sample-analysis"), true);
    assert.equal(canEditSampleAnalysis(surveyor), false);
    assert.equal(canSeeProjectTab(surveyor, "documents"), true);
    const surveyorTabs = visibleProjectTabs(surveyor);
    assert.equal(surveyorTabs[surveyorTabs.indexOf("summary") + 1], "sample-analysis");
    assert.equal(canSeeProjectTab(surveyor, "loader"), false);
    assert.ok(!visibleProjectTabs(surveyor).includes("completions"));
  });

  it("lets admins see every project tab including Completions", () => {
    const admin = user("admin");
    assert.equal(canSeeCompletions(admin), true);
    assert.equal(canSeeProjectTab(admin, "completions"), true);
    assert.equal(canSeeProjectTab(admin, "loader"), true);
    assert.equal(canSeeProjectTab(admin, "dwellings"), true);
    assert.equal(canSeeProjectTab(admin, "sample-analysis"), true);
    assert.equal(canEditSampleAnalysis(admin), true);
    assert.ok(visibleProjectTabs(admin).includes("completions"));
    const adminTabs = visibleProjectTabs(admin);
    assert.equal(adminTabs[adminTabs.indexOf("summary") + 1], "sample-analysis");
  });
});

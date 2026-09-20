import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loginBlockedForMissingAccess, NO_SITE_ACCESS_ERROR } from "./login-access.js";

describe("Login access gate", () => {
  it("uses the exact site-access error text", () => {
    assert.equal(
      NO_SITE_ACCESS_ERROR,
      "Error: You do not currently have access to this site, please contact the Project Management Team."
    );
  });

  it("never blocks admins, even with zero project ticks", () => {
    assert.equal(loginBlockedForMissingAccess("admin", 0), false);
    assert.equal(loginBlockedForMissingAccess("admin", 3), false);
  });

  it("blocks client and surveyor when no projects are ticked", () => {
    assert.equal(loginBlockedForMissingAccess("client", 0), true);
    assert.equal(loginBlockedForMissingAccess("surveyor", 0), true);
  });

  it("allows client and surveyor when at least one project is ticked", () => {
    assert.equal(loginBlockedForMissingAccess("client", 1), false);
    assert.equal(loginBlockedForMissingAccess("surveyor", 2), false);
  });
});

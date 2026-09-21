import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  issueTempPassword,
  MIN_PASSWORD_LENGTH,
  newPasswordError,
  randomTempPassword,
  tempPassword,
  verifyPassword,
} from "./passwords.js";

describe("tempPassword (legacy Name2468)", () => {
  it("uses letters from the name plus 2468", () => {
    assert.equal(tempPassword("Phil Moon"), "PhilMoon2468");
    assert.equal(tempPassword("Jordan Jones"), "JordanJones2468");
  });
});

describe("randomTempPassword", () => {
  it("is at least the minimum length and uses an unambiguous charset", () => {
    const pw = randomTempPassword();
    assert.ok(pw.length >= MIN_PASSWORD_LENGTH);
    assert.match(pw, /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/);
    assert.doesNotMatch(pw, /[0O1Il]/);
  });

  it("is stronger than the Name2468 mock and unique per call", () => {
    const a = randomTempPassword();
    const b = randomTempPassword();
    assert.notEqual(a, b);
    assert.notEqual(a, tempPassword("Phil Moon"));
    assert.doesNotMatch(a, /2468$/);
  });
});

describe("issueTempPassword", () => {
  it("returns a plaintext temp and a hash that verifies it", async () => {
    const issued = await issueTempPassword();
    assert.ok(issued.plain.length >= MIN_PASSWORD_LENGTH);
    assert.notEqual(issued.hash, issued.plain);
    assert.equal(await verifyPassword(issued.plain, issued.hash), true);
    assert.equal(await verifyPassword("wrong-password", issued.hash), false);
  });
});

describe("newPasswordError", () => {
  it("requires a password of at least 10 characters that matches confirm", () => {
    assert.equal(newPasswordError("", "x"), "Enter a new password.");
    assert.equal(newPasswordError("short", "short"), "New password must be at least 10 characters.");
    assert.equal(newPasswordError("longenough1", "longenough2"), "New password and confirmation do not match.");
    assert.equal(newPasswordError("longenough1", "longenough1"), "");
  });
});

describe("hashPassword / verifyPassword", () => {
  it("stores a bcrypt hash, not the plaintext", async () => {
    const plain = "UserChosen2468";
    const hash = await hashPassword(plain);
    assert.notEqual(hash, plain);
    assert.match(hash, /^\$2[aby]?\$/);
    assert.equal(await verifyPassword(plain, hash), true);
  });
});

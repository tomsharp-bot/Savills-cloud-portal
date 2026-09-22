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

const TEMP_PW_RE = /^([a-z]{6})\.([a-z]{6})\.2468$/;

describe("tempPassword (legacy Name2468)", () => {
  it("uses letters from the name plus 2468", () => {
    assert.equal(tempPassword("Phil Moon"), "PhilMoon2468");
    assert.equal(tempPassword("Jordan Jones"), "JordanJones2468");
  });
});

describe("randomTempPassword", () => {
  it("uses two 6-letter words then .2468 (e.g. orange.forest.2468)", () => {
    const pw = randomTempPassword();
    assert.ok(pw.length >= MIN_PASSWORD_LENGTH);
    const match = TEMP_PW_RE.exec(pw);
    assert.ok(match, `expected word.word.2468, got ${pw}`);
    assert.equal(match![1].length, 6);
    assert.equal(match![2].length, 6);
    assert.match(pw, /\.2468$/);
  });

  it("is unique per call and not the legacy Name2468 mock", () => {
    const a = randomTempPassword();
    const b = randomTempPassword();
    assert.notEqual(a, b);
    assert.notEqual(a, tempPassword("Phil Moon"));
    assert.match(a, TEMP_PW_RE);
    assert.match(b, TEMP_PW_RE);
  });
});

describe("issueTempPassword", () => {
  it("returns a plaintext temp and a hash that verifies it", async () => {
    const issued = await issueTempPassword();
    assert.match(issued.plain, TEMP_PW_RE);
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

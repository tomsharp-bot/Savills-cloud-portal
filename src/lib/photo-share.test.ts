import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHOTO_SHARE_MONTHS,
  assessPhotoShareToken,
  bytesForPoolPhoto,
  cleanShareCode,
  generatePhotoShareSecret,
  hashPhotoShareSecret,
  isPhotoShareSecret,
  photoShareAddress,
  photoShareByCodeUrl,
  photoShareExpiresAt,
  photoShareHelpText,
  pickPoolPhotoByCode,
} from "./photo-share.js";

describe("photo share tokens", () => {
  it("issues a 12 month address and stores only a hash of the secret", () => {
    const secret = generatePhotoShareSecret();
    assert.equal(isPhotoShareSecret(secret), true);
    assert.equal(isPhotoShareSecret("short"), false);
    const hash = hashPhotoShareSecret(secret);
    assert.equal(hash.length, 64);
    assert.equal(hash.includes(secret), false);
    assert.notEqual(hash, secret);
    const from = new Date(Date.UTC(2026, 8, 24, 12, 0, 0));
    const expires = photoShareExpiresAt(from);
    assert.equal(PHOTO_SHARE_MONTHS, 12);
    assert.equal(expires.toISOString().slice(0, 10), "2027-09-24");
    const address = photoShareAddress("https://savillscloudportal.co.uk", secret);
    assert.equal(address, `https://savillscloudportal.co.uk/photos/share/${secret}`);
    assert.equal(address.includes("/projectprogress"), false);
    const byCode = photoShareByCodeUrl(address, "635569-Front Door1");
    assert.equal(byCode, `${address}/by-code/635569-Front%20Door1`);
    const help = photoShareHelpText(address);
    assert.match(help, /Data Horizontal DW!F1/);
    assert.match(help, /\/by-code\//);
    assert.match(help, /does not sign you in/);
    assert.doesNotMatch(help, /screen-app|Photos Pool:/);
  });

  it("rejects missing, expired, and revoked codes", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    assert.equal(assessPhotoShareToken(null, now).ok, false);
    const expired = assessPhotoShareToken(
      { projectId: "p1", expiresAt: new Date("2026-09-24T12:00:00Z"), revokedAt: null },
      now
    );
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.status, 401);
    const revoked = assessPhotoShareToken(
      { projectId: "p1", expiresAt: new Date("2027-09-24T12:00:00Z"), revokedAt: now },
      now
    );
    assert.equal(revoked.ok, false);
    if (!revoked.ok) assert.equal(revoked.status, 403);
    const live = assessPhotoShareToken(
      { projectId: "p1", expiresAt: new Date("2027-09-24T12:00:00Z"), revokedAt: null },
      now
    );
    assert.deepEqual(live, { ok: true, projectId: "p1" });
  });

  it("matches a pool code exactly, then case-insensitively, and only returns that project's bytes", async () => {
    const photos = [{ code: "635569-Front Door1" }, { code: "Other" }];
    assert.equal(pickPoolPhotoByCode(photos, "635569-Front Door1")?.code, "635569-Front Door1");
    assert.equal(pickPoolPhotoByCode(photos, "635569-front door1")?.code, "635569-Front Door1");
    assert.equal(pickPoolPhotoByCode(photos, "missing"), null);
    assert.equal(cleanShareCode("../secret"), null);
    assert.equal(cleanShareCode("pool/secret"), null);
    assert.equal(cleanShareCode("635569-Front Door1"), "635569-Front Door1");

    const calls: string[] = [];
    const outside = await bytesForPoolPhoto(
      "proj",
      { code: "secret", fileName: "secret.jpg", spacesKey: "photos/other/pool/secret.jpg" },
      async (key) => {
        calls.push(key);
        return Buffer.from("nope");
      }
    );
    assert.equal(outside.ok, false);
    assert.equal(calls.length, 0);

    const missing = await bytesForPoolPhoto(
      "proj",
      { code: "635569-Front Door1", fileName: "635569-Front Door1.jpg", spacesKey: "" },
      async () => Buffer.from("x")
    );
    assert.equal(missing.ok, false);

    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    const found = await bytesForPoolPhoto(
      "proj",
      {
        code: "635569-Front Door1",
        fileName: "635569-Front Door1.jpg",
        spacesKey: "photos/proj/pool/635569-Front Door1.jpg",
      },
      async (key) => {
        calls.push(key);
        return jpeg;
      }
    );
    assert.equal(found.ok, true);
    if (found.ok) {
      assert.equal(found.contentType, "image/jpeg");
      assert.equal(found.body.equals(jpeg), true);
      assert.match(found.disposition, /635569-Front Door1\.jpg/);
      assert.equal(found.disposition.includes("photos/proj"), false);
    }
    assert.deepEqual(calls, ["photos/proj/pool/635569-Front Door1.jpg"]);
  });
});

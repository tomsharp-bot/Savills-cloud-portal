import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accentClassForName,
  buildFolderName,
  buildPlaceholderZip,
  buildPoolCodes,
  leadFirstName,
  nextFolderSequence,
  parsePhotoCodes,
  uprnFromCode,
} from "./photos.js";
import { spacesStatus } from "./spaces.js";

describe("leadFirstName", () => {
  it("takes the first token from Project Progress projectManager", () => {
    assert.equal(leadFirstName("Tom Sharp"), "Tom");
    assert.equal(leadFirstName("Greg K"), "Greg");
    assert.equal(leadFirstName("Carly M"), "Carly");
    assert.equal(leadFirstName("—"), "—");
    assert.equal(leadFirstName("TBC"), "—");
    assert.equal(leadFirstName(""), "—");
  });
});

describe("photo code helpers", () => {
  it("parses codes and skips duplicates case-insensitively", () => {
    assert.deepEqual(parsePhotoCodes("2245623-Kitchen-1, 2245623-Bathroom-1\n2245623-kitchen-1"), [
      "2245623-Kitchen-1",
      "2245623-Bathroom-1",
    ]);
  });

  it("reads UPRN as the first segment", () => {
    assert.equal(uprnFromCode("2245623-Kitchen-1"), "2245623");
  });

  it("builds deterministic demo pool codes", () => {
    const codes = buildPoolCodes("ONW", 4);
    assert.equal(codes.length, 4);
    assert.match(codes[0], /^\d+-Kitchen-1$/);
    assert.match(codes[1], /^\d+-Bathroom-2$/);
  });
});

describe("folder naming", () => {
  it("picks the next numbered folder sequence", () => {
    assert.equal(nextFolderSequence(["1. Pictures Batch 1", "2. Pictures Batch 2"]), 3);
    assert.equal(nextFolderSequence(["Onward_Pack.zip"]), 1);
  });

  it("forces the sequence prefix on the typed name", () => {
    assert.equal(buildFolderName(3, "Pictures Batch 3"), "3. Pictures Batch 3");
    assert.equal(buildFolderName(3, "3. Extra"), "3. Extra");
    assert.equal(buildFolderName(3, ""), null);
  });
});

describe("placeholder zip", () => {
  it("builds a zip that starts with the local file header", () => {
    const zip = buildPlaceholderZip([{ name: "a.txt", body: "hello" }]);
    assert.equal(zip[0], 0x50);
    assert.equal(zip[1], 0x4b);
    assert.ok(zip.length > 30);
  });
});

describe("accentClassForName", () => {
  it("returns a stable accent class", () => {
    assert.equal(accentClassForName("Onward"), "acc-Onward");
    assert.match(accentClassForName("Test 1"), /^acc-/);
  });
});

describe("spacesStatus", () => {
  it("reports unconfigured when credentials are missing", () => {
    const s = spacesStatus({
      endpoint: "",
      region: "lon1",
      bucket: "cloud-portal-vault",
      key: "",
      secret: "",
    });
    assert.equal(s.configured, false);
    assert.equal(s.hasCredentials, false);
    assert.equal(s.bucket, "cloud-portal-vault");
  });

  it("reports configured when endpoint and credentials are set", () => {
    const s = spacesStatus({
      endpoint: "https://lon1.digitaloceanspaces.com",
      region: "lon1",
      bucket: "cloud-portal-vault",
      key: "key",
      secret: "secret",
    });
    assert.equal(s.configured, true);
    assert.equal(s.hasCredentials, true);
  });
});

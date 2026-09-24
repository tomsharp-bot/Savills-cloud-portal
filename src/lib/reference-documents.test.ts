import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  REF_DOC_MAX_BYTES,
  REFERENCE_COLUMNS,
  ReferenceStorageError,
  referenceFileTooLargeMessage,
  columnsWithCounts,
  contentDisposition,
  displayType,
  formatRefUpdated,
  isAllowedRefExt,
  loadReferenceFile,
  previewKind,
  referenceFilePath,
  referenceStorageBlockMessage,
  referenceUploadDir,
  removeReferenceFile,
  storeReferenceBytes,
} from "./reference-documents.js";
import { config } from "../config.js";
import {
  classifyReferenceStorage,
  normalizeSpacesEndpoint,
  putSpacesObject,
  spacesHealth,
  spacesRequireFlag,
  resolveReferenceStorageMode,
  spacesRequired,
  spacesStartupReport,
  spacesStatus,
  spacesTargetOk,
} from "./spaces.js";

describe("reference document upload limit", () => {
  it("allows each file up to 50 MB", () => {
    assert.equal(REF_DOC_MAX_BYTES, 50 * 1024 * 1024);
    assert.equal(referenceFileTooLargeMessage(), "Each file must be 50MB or smaller.");
    const route = readFileSync(join(process.cwd(), "src/routes/reference-documents.ts"), "utf8");
    assert.match(route, /fileSize: REF_DOC_MAX_BYTES/);
    assert.match(route, /referenceFileTooLargeMessage\(\)/);
    assert.doesNotMatch(route, /20MB/);
  });
});

describe("reference document categories", () => {
  it("lays the six categories out in three columns", () => {
    assert.deepEqual(REFERENCE_COLUMNS, [
      ["general", "blocks"],
      ["hhsrs", "rdsap"],
      ["new-starter", "other"],
    ]);
    const columns = columnsWithCounts(new Map([["blocks", 2]]));
    assert.equal(columns[0][0].title, "General Surveying Docs");
    assert.equal(columns[0][0].count, 0);
    assert.equal(columns[0][1].title, "Blocks");
    assert.equal(columns[0][1].count, 2);
    assert.equal(columns[1][0].title, "HHSRS");
    assert.equal(columns[1][1].title, "RDSAP");
    assert.equal(columns[2][0].title, "New Starter Docs");
    assert.equal(columns[2][1].title, "Other");
  });

  it("labels file types and only previews PDF and images in the portal", () => {
    assert.equal(displayType("notes.pdf"), "PDF");
    assert.equal(displayType("docx"), "Word");
    assert.equal(displayType("sheet.xlsx"), "Excel");
    assert.equal(displayType("photo.JPEG"), "Image");
    assert.equal(previewKind("pdf"), "pdf");
    assert.equal(previewKind("png"), "image");
    assert.equal(previewKind("docx"), "");
    assert.equal(isAllowedRefExt("pdf"), true);
    assert.equal(isAllowedRefExt("jpg"), true);
    assert.equal(isAllowedRefExt("exe"), false);
    assert.equal(isAllowedRefExt("html"), false);
    assert.equal(formatRefUpdated(new Date(2026, 6, 20)), "20-07-2026");
  });

  it("rejects path traversal and keeps download names on one line", () => {
    assert.throws(() => referenceFilePath("../secrets.pdf"));
    assert.throws(() => referenceFilePath("nested/file.pdf"));
    const ok = referenceFilePath("abc-def.pdf");
    assert.match(ok, /reference-documents[/\\]abc-def\.pdf$/);
    assert.equal(contentDisposition("view", 'hello\r\n"world".pdf'), 'inline; filename="helloworld.pdf"');
    assert.equal(contentDisposition("download", "pack.pdf"), 'attachment; filename="pack.pdf"');
  });
});

describe("reference document page markup", () => {
  it("hides upload and delete unless the viewer is an admin", () => {
    const view = readFileSync(join(process.cwd(), "views/reference-documents.ejs"), "utf8");
    assert.match(view, /if \(isAdmin\) \{ %>\s*<form class="drop" id="dropZone"/);
    assert.match(view, /Drag and drop files here/);
    assert.match(view, /if \(isAdmin\) \{ %>\s*<form class="inline-form"/);
    assert.match(view, /data-open/);
    assert.match(view, />Download</);
    assert.match(view, /grid-col/);
    const hub = readFileSync(join(process.cwd(), "views/partials/surveyor-hub.ejs"), "utf8");
    assert.match(hub, /Project Progress/);
    assert.match(hub, /Reference Documents/);
    assert.equal(hub.match(/class="hub-card/g)?.length, 2);
    assert.doesNotMatch(hub, /Personnel/);
    assert.doesNotMatch(hub, /photos/);
  });
});

describe("reference document disk storage", () => {
  it("does not call Spaces when credentials are missing", async () => {
    if (spacesStatus().configured) return;
    assert.equal(
      await putSpacesObject("reference-documents/general/unused.pdf", Buffer.from("%PDF"), "application/pdf"),
      false
    );
  });

  it("round-trips a file on local disk when Spaces is not configured and not required", async () => {
    if (spacesStatus().configured || spacesRequired()) return;
    const storedName = `${randomUUID()}.pdf`;
    const body = Buffer.from("%PDF-1.4 reference-doc-test");
    const stored = await storeReferenceBytes({
      category: "general",
      storedName,
      buffer: body,
      contentType: "application/pdf",
    });
    assert.equal(stored.storage, "disk");
    assert.equal(stored.spacesKey, "");
    try {
      const loaded = await loadReferenceFile({ storedName, spacesKey: "" });
      assert.ok(loaded);
      assert.equal(loaded.kind, "path");
    } finally {
      assert.equal(await removeReferenceFile({ storedName, spacesKey: "" }), true);
    }
  });
});

describe("reference document Spaces durability", () => {
  it("sends production and REQUIRE_SPACES to Spaces or blocks them", () => {
    assert.equal(spacesRequired("production"), true);
    assert.equal(spacesRequireFlag(undefined), false);
    assert.equal(spacesRequireFlag(""), false);
    assert.equal(spacesRequireFlag("true"), true);
    assert.equal(spacesRequireFlag("1"), true);
    assert.equal(spacesRequireFlag("yes"), true);
    assert.equal(spacesRequireFlag("false"), false);
    assert.equal(
      classifyReferenceStorage({ required: true, configured: true, targetOk: true }),
      "spaces"
    );
    assert.equal(
      classifyReferenceStorage({ required: true, configured: true, targetOk: false }),
      "blocked"
    );
    assert.equal(
      classifyReferenceStorage({ required: true, configured: false, targetOk: false }),
      "blocked"
    );
    assert.equal(
      classifyReferenceStorage({ required: false, configured: false, targetOk: false }),
      "disk"
    );
    assert.equal(
      classifyReferenceStorage({ required: false, configured: true, targetOk: false }),
      "spaces"
    );
    assert.equal(resolveReferenceStorageMode("blocked", "disk"), "blocked");
    assert.equal(resolveReferenceStorageMode("spaces", "disk"), "spaces");
    assert.equal(resolveReferenceStorageMode("disk", "blocked"), "blocked");
  });

  it("accepts the lon1 vault endpoint with or without a scheme and trailing slash", () => {
    assert.equal(normalizeSpacesEndpoint("https://lon1.digitaloceanspaces.com/"), "https://lon1.digitaloceanspaces.com");
    assert.equal(normalizeSpacesEndpoint("lon1.digitaloceanspaces.com"), "https://lon1.digitaloceanspaces.com");
    assert.equal(normalizeSpacesEndpoint("https://LON1.digitaloceanspaces.com"), "https://lon1.digitaloceanspaces.com");
    assert.equal(
      spacesTargetOk({
        configured: true,
        endpoint: "https://lon1.digitaloceanspaces.com/",
        region: "lon1",
        bucket: "cloud-portal-vault",
        hasCredentials: true,
      }),
      true
    );
    assert.equal(
      spacesTargetOk({
        configured: true,
        endpoint: "https://nyc3.digitaloceanspaces.com",
        region: "lon1",
        bucket: "cloud-portal-vault",
        hasCredentials: true,
      }),
      false
    );
  });

  it("refuses local disk when Spaces storage is blocked", async () => {
    const storedName = `${randomUUID()}.pdf`;
    try {
      await assert.rejects(
        () =>
          storeReferenceBytes(
            {
              category: "general",
              storedName,
              buffer: Buffer.from("%PDF-1.4"),
              contentType: "application/pdf",
            },
            "blocked"
          ),
        (err: unknown) => err instanceof ReferenceStorageError && /not saved on the server disk/i.test(err.message)
      );
      await assert.rejects(() => access(referenceFilePath(storedName)));
      assert.equal(await loadReferenceFile({ storedName, spacesKey: "" }, "blocked"), null);
      const message = referenceStorageBlockMessage();
      assert.match(message, /SPACES_ENDPOINT/);
      assert.match(message, /SPACES_KEY/);
      assert.match(message, /SPACES_SECRET/);
      assert.match(message, /cloud-portal-vault/);
      assert.match(message, /lon1/);
      if (config.spaces.secret) assert.equal(message.includes(config.spaces.secret), false);
      if (config.spaces.key) assert.equal(message.includes(config.spaces.key), false);
    } finally {
      await unlink(referenceFilePath(storedName)).catch(() => undefined);
    }
  });

  it("does not open or delete via a local path when the row has a Spaces key", async () => {
    if (spacesStatus().configured) return;
    const storedName = `${randomUUID()}.pdf`;
    await mkdir(referenceUploadDir(), { recursive: true });
    await writeFile(referenceFilePath(storedName), Buffer.from("local-only"));
    const spacesKey = `reference-documents/general/${storedName}`;
    try {
      assert.equal(await loadReferenceFile({ storedName, spacesKey }), null);
      assert.equal(await removeReferenceFile({ storedName, spacesKey }), false);
      await access(referenceFilePath(storedName));
    } finally {
      await unlink(referenceFilePath(storedName)).catch(() => undefined);
    }
  });

  it("startup and health reports name the vault and omit credential values", () => {
    const report = spacesStartupReport();
    const health = spacesHealth();
    assert.match(report.message, /cloud-portal-vault/);
    assert.match(report.message, /lon1/);
    assert.equal(health.bucket, "cloud-portal-vault");
    assert.equal(health.region, "lon1");
    assert.equal(health.credentials === "present" || health.credentials === "missing", true);
    assert.equal("key" in health, false);
    assert.equal("secret" in health, false);
    const blob = `${report.message}\n${JSON.stringify(health)}`;
    if (config.spaces.secret) assert.equal(blob.includes(config.spaces.secret), false);
    if (config.spaces.key) assert.equal(blob.includes(config.spaces.key), false);
    if (spacesRequired() && !spacesStatus().configured) assert.equal(report.level, "error");
  });
});

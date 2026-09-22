import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  REFERENCE_COLUMNS,
  columnsWithCounts,
  contentDisposition,
  displayType,
  formatRefUpdated,
  isAllowedRefExt,
  loadReferenceFile,
  previewKind,
  referenceFilePath,
  removeReferenceFile,
  storeReferenceBytes,
} from "./reference-documents.js";
import { putSpacesObject, spacesStatus } from "./spaces.js";

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

  it("round-trips a file on local disk when Spaces is not configured", async () => {
    if (spacesStatus().configured) return;
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

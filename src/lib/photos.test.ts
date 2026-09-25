import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accentClassForName,
  buildFolderName,
  buildPlaceholderZip,
  buildPoolCodes,
  canonicalCodes,
  deleteStoredPhoto,
  isProjectPoolKey,
  leadFirstName,
  moveStoredPhoto,
  nextFolderSequence,
  parsePhotoCodes,
  parseRenamedPhotoName,
  parseUploadedPhotoName,
  photoObjectKey,
  poolPhotoImagePath,
  poolListWhere,
  poolRecentSince,
  poolThumbPath,
  blurMimeMatches,
  POOL_RECENT_DAYS,
  photoTooLargeMessage,
  placeholderThumbUrl,
  toPoolView,
  PHOTO_UPLOAD_MAX_BYTES,
  uploadMimeAllowed,
  uploadProjectPhoto,
  replaceCodeInList,
  replaceSubstringInCode,
  uprnFromCode,
  withoutCodes,
  type PhotoStorageOps,
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

describe("pool photo thumbs", () => {
  it("points thumbUrl at the authenticated app path when the Spaces key is in this project", () => {
    const code = "2245623-Kitchen-1";
    const view = toPoolView({
      id: "row1",
      projectId: "proj1",
      code,
      fileName: `${code}.jpg`,
      spacesKey: "photos/proj1/pool/2245623-Kitchen-1.jpg",
      createdAt: new Date(),
    });
    assert.equal(view.thumbUrl, "/photos/projects/proj1/pool/2245623-Kitchen-1/image");
    assert.equal(view.thumbUrl, poolPhotoImagePath("proj1", code));
    assert.equal(view.thumbUrl.includes("digitaloceanspaces.com"), false);
    assert.equal(view.spacesKey, "photos/proj1/pool/2245623-Kitchen-1.jpg");
  });

  it("encodes the project and code and keeps a coloured placeholder when there is no pool object", () => {
    assert.equal(
      poolPhotoImagePath("proj 1", "Kitchen 1"),
      "/photos/projects/proj%201/pool/Kitchen%201/image"
    );
    const empty = toPoolView({
      id: "row2",
      projectId: "proj1",
      code: "2245623-Hall-1",
      fileName: "2245623-Hall-1.jpg",
      spacesKey: "",
      createdAt: new Date(),
    });
    assert.equal(empty.thumbUrl, placeholderThumbUrl("2245623-Hall-1"));
    assert.match(empty.thumbUrl, /^data:image\/svg\+xml/);
    const foreign = toPoolView({
      id: "row3",
      projectId: "proj1",
      code: "2245623-Roof-1",
      fileName: "2245623-Roof-1.jpg",
      spacesKey: "photos/other-project/pool/secret.jpg",
      createdAt: new Date(),
    });
    assert.match(foreign.thumbUrl, /^data:image\/svg\+xml/);
    assert.equal(foreign.thumbUrl.includes("/image"), false);
  });

  it("loads stored thumbs from the app URL and leaves blob and data sources alone", () => {
    const js = readFileSync(join(process.cwd(), "public/js/photos.js"), "utf8");
    assert.match(js, /function thumbSrc\(thumbUrl\)/);
    assert.match(js, /data:\|blob:/);
    assert.match(js, /img\.src = thumbSrc\(photo\.thumbUrl\)/);
    assert.match(js, /img\.src = thumbSrc\(meta\.thumbUrl \|\| ""\)/);
    assert.match(js, /escapeHtml\(thumbSrc\(meta\.thumbUrl\)\)/);
    assert.match(js, /URL\.createObjectURL\(file\)/);
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

describe("photo rename names", () => {
  it("keeps the current extension and rejects a different one or a path", () => {
    const ok = parseRenamedPhotoName("2245623-Kitchen-1.jpg", "2245623-Lounge-1");
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.code, "2245623-Lounge-1");
      assert.equal(ok.fileName, "2245623-Lounge-1.jpg");
    }
    const withExt = parseRenamedPhotoName("2245623-Kitchen-1.JPG", "2245623-Lounge-1.jpg");
    assert.equal(withExt.ok, true);
    if (withExt.ok) assert.equal(withExt.fileName, "2245623-Lounge-1.jpg");
    const otherExt = parseRenamedPhotoName("2245623-Kitchen-1.jpg", "2245623-Lounge-1.png");
    assert.equal(otherExt.ok, false);
    const path = parseRenamedPhotoName("2245623-Kitchen-1.jpg", "../other");
    assert.equal(path.ok, false);
    const slash = parseRenamedPhotoName("2245623-Kitchen-1.jpg", "pool/secret");
    assert.equal(slash.ok, false);
    assert.equal(parseRenamedPhotoName("2245623-Kitchen-1.jpg", "   ").ok, false);
  });

  it("builds a pool key only inside the project prefix", () => {
    const projectId = "proj1";
    assert.equal(photoObjectKey(projectId, "2245623-Lounge-1", ".jpg"), "photos/proj1/pool/2245623-Lounge-1.jpg");
    assert.equal(photoObjectKey(projectId, "../secret", ".jpg"), null);
    assert.equal(isProjectPoolKey(projectId, "photos/proj1/pool/2245623-Lounge-1.jpg"), true);
    assert.equal(isProjectPoolKey(projectId, "photos/other/pool/2245623-Lounge-1.jpg"), false);
    assert.equal(isProjectPoolKey(projectId, "photos/proj1/pool/../../secret.jpg"), false);
  });
});

describe("photo code find and replace", () => {
  it("replaces each occurrence and skips a miss or an empty find", () => {
    const changed = replaceSubstringInCode("224466-Front Door1", "224466", "113355");
    assert.deepEqual(changed, { ok: true, code: "113355-Front Door1" });
    const all = replaceSubstringInCode("aa-aa", "a", "b");
    assert.deepEqual(all, { ok: true, code: "bb-bb" });
    const miss = replaceSubstringInCode("113355-Hall", "224466", "1");
    assert.equal(miss.ok, false);
    const empty = replaceSubstringInCode("224466-Hall", "", "1");
    assert.equal(empty.ok, false);
    const same = replaceSubstringInCode("224466-Hall", "nope", "1");
    assert.equal(same.ok, false);
  });
});

describe("photo code lists", () => {
  it("resolves requested codes against the folder or pool and drops duplicates", () => {
    const resolved = canonicalCodes(
      [" kitchen ", "KITCHEN", "bath"],
      ["Kitchen", "Bath"],
      "missing"
    );
    assert.deepEqual(resolved, { ok: true, codes: ["Kitchen", "Bath"] });
    const missing = canonicalCodes(["Hall"], ["Kitchen"], "One or more photos are not in this folder.");
    assert.equal(missing.ok, false);
  });

  it("replaces and removes codes without touching other names", () => {
    assert.deepEqual(replaceCodeInList(["Kitchen", "Bath"], "kitchen", "Lounge"), {
      codes: ["Lounge", "Bath"],
      changed: true,
    });
    assert.deepEqual(withoutCodes(["Kitchen", "Bath", "kitchen"], ["KITCHEN"]), ["Bath"]);
  });
});

describe("Spaces photo delete and rename", () => {
  const projectId = "proj1";

  function ops(overrides: Partial<PhotoStorageOps> = {}): PhotoStorageOps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      configured: overrides.configured || (() => true),
      remove: overrides.remove || (async (key) => {
        calls.push(`remove ${key}`);
        return true;
      }),
      copy: overrides.copy || (async (from, to) => {
        calls.push(`copy ${from} -> ${to}`);
        return "copied";
      }),
      put: overrides.put || (async (key, body) => {
        calls.push(`put ${key} ${body.length}`);
        return true;
      }),
    };
  }

  it("deletes a project pool object and ignores placeholders", async () => {
    const storage = ops();
    const key = "photos/proj1/pool/Kitchen.jpg";
    assert.deepEqual(await deleteStoredPhoto(projectId, "", storage), { ok: true });
    assert.equal(storage.calls.length, 0);
    assert.deepEqual(await deleteStoredPhoto(projectId, key, storage), { ok: true });
    assert.deepEqual(storage.calls, [`remove ${key}`]);
  });

  it("does not delete a key outside the project, or when storage is down", async () => {
    const foreign = ops();
    const blocked = await deleteStoredPhoto(projectId, "photos/other/pool/Kitchen.jpg", foreign);
    assert.equal(blocked.ok, false);
    assert.equal(foreign.calls.length, 0);
    const down = ops({ configured: () => false });
    const unavailable = await deleteStoredPhoto(projectId, "photos/proj1/pool/Kitchen.jpg", down);
    assert.equal(unavailable.ok, false);
    if (!unavailable.ok) assert.match(unavailable.error, /not available/);
    assert.equal(down.calls.length, 0);
  });

  it("moves an object and removes the new key if the old key cannot be deleted", async () => {
    const from = "photos/proj1/pool/Kitchen.jpg";
    const to = "photos/proj1/pool/Lounge.jpg";
    const removed: string[] = [];
    const storage = ops({
      remove: async (key) => {
        removed.push(key);
        return key !== from;
      },
    });
    const moved = await moveStoredPhoto(projectId, from, to, storage);
    assert.equal(moved.ok, false);
    assert.deepEqual(storage.calls, [`copy ${from} -> ${to}`]);
    assert.deepEqual(removed, [from, to]);
  });

  it("points metadata at the new key when the source object is already gone", async () => {
    const from = "photos/proj1/pool/Kitchen.jpg";
    const to = "photos/proj1/pool/Lounge.jpg";
    const storage = ops({
      copy: async () => "missing",
    });
    const moved = await moveStoredPhoto(projectId, from, to, storage);
    assert.deepEqual(moved, { ok: true, spacesKey: to });
    assert.equal(storage.calls.length, 0);
  });

  it("leaves a placeholder with no object key", async () => {
    const storage = ops();
    const moved = await moveStoredPhoto(projectId, "", "photos/proj1/pool/Lounge.jpg", storage);
    assert.deepEqual(moved, { ok: true, spacesKey: "" });
    assert.equal(storage.calls.length, 0);
  });
});

describe("pool recent window", () => {
  it("limits the default query to the last 7 days and lets a code search cover the whole pool", () => {
    assert.equal(POOL_RECENT_DAYS, 7);
    const now = new Date("2026-09-25T12:00:00.000Z");
    assert.equal(poolRecentSince(now).toISOString(), "2026-09-18T12:00:00.000Z");
    const recent = poolListWhere("proj", { now });
    assert.equal(recent.window, "recent");
    assert.equal(recent.where.projectId, "proj");
    assert.deepEqual(recent.where.createdAt, { gte: new Date("2026-09-18T12:00:00.000Z") });
    assert.equal(recent.where.OR, undefined);

    const search = poolListWhere("proj", { q: " Kitchen ", showAll: false, now });
    assert.equal(search.window, "search");
    assert.equal(search.where.createdAt, undefined);
    assert.deepEqual(search.where.OR, [
      { code: { contains: "Kitchen", mode: "insensitive" } },
      { fileName: { contains: "Kitchen", mode: "insensitive" } },
    ]);

    const all = poolListWhere("proj", { showAll: true, now });
    assert.equal(all.window, "all");
    assert.equal(all.where.createdAt, undefined);
    assert.equal(all.where.OR, undefined);
  });

  it("adds a cache-busting version only after the stored bytes have been replaced", () => {
    assert.equal(
      poolThumbPath({
        id: "row",
        projectId: "proj1",
        code: "Kitchen",
        fileName: "Kitchen.jpg",
        spacesKey: "photos/proj1/pool/Kitchen.jpg",
      }),
      "/photos/projects/proj1/pool/Kitchen/image"
    );
    assert.equal(
      poolThumbPath({
        id: "row",
        projectId: "proj1",
        code: "Kitchen",
        fileName: "Kitchen.jpg",
        spacesKey: "photos/proj1/pool/Kitchen.jpg",
        revision: 2,
      }),
      "/photos/projects/proj1/pool/Kitchen/image?v=2"
    );
    assert.equal(blurMimeMatches(".jpg", "image/jpeg"), true);
    assert.equal(blurMimeMatches(".png", "image/jpeg"), false);
    assert.equal(blurMimeMatches(".heic", "image/heic"), false);
  });
});

describe("photo lightbox markup", () => {
  it("keeps the lightbox inside Photo Storage so overlay styles apply, and sizes it to the viewport", () => {
    const view = readFileSync(join(process.cwd(), "views/photos-project.ejs"), "utf8");
    const css = readFileSync(join(process.cwd(), "public/css/photos.css"), "utf8");
    const pageOpen = view.indexOf('class="photos-page"');
    const lightbox = view.indexOf('id="photoLightbox"');
    const pageClose = view.lastIndexOf("</div>");
    const script = view.indexOf("<script>");
    assert.ok(pageOpen >= 0 && lightbox > pageOpen, "lightbox should follow the photos page root");
    assert.ok(lightbox < pageClose && pageClose < script, "lightbox should sit inside the photos page, before scripts");
    assert.match(css, /\.lightbox-backdrop\s*\{[^}]*position:\s*fixed/s);
    assert.match(css, /\.lightbox-backdrop\s*\{[^}]*align-items:\s*center/s);
    assert.match(css, /\.lightbox-backdrop\s*\{[^}]*justify-content:\s*center/s);
    assert.match(css, /max-height:\s*min\(78vh,\s*820px\)/);
    assert.match(css, /\.lightbox-stage\s*\{[^}]*flex-direction:\s*row/s);
    assert.match(css, /\.lightbox-rename\s*\{/);
    assert.match(css, /#renameModal\s*\{[^}]*z-index:\s*500/s);
    assert.match(view, /id="lightboxRenameInput"/);
    assert.match(view, /id="btnBlurSave"/);
    assert.match(view, /id="lightboxBlurPanel"/);
    assert.match(view, /class="lightbox-stage"/);
    const blurBox = view.indexOf('id="lightboxBlurPanel"');
    const renameBoxEarly = view.indexOf('id="lightboxRenameForm"');
    assert.ok(blurBox > renameBoxEarly, "blur sits under the rename section");
    const renameBox = view.indexOf('id="lightboxRenameInput"');
    const lightboxEnd = view.indexOf('id="renameModal"');
    assert.ok(renameBox > lightbox && renameBox < lightboxEnd, "rename box sits inside the lightbox");
  });

  it("offers Delete and Rename beside Download zip, and keeps Rename to a single photo", () => {
    const view = readFileSync(join(process.cwd(), "views/photos-project.ejs"), "utf8");
    const js = readFileSync(join(process.cwd(), "public/js/photos.js"), "utf8");
    const css = readFileSync(join(process.cwd(), "public/css/photos.css"), "utf8");
    assert.match(view, /id="btnDownloadZip"/);
    assert.match(view, /id="btnDeletePhotos"/);
    assert.match(view, /id="btnRenamePhoto"/);
    assert.match(view, /id="btnLightboxRename"/);
    assert.match(js, /Delete " \+ n \+ " " \+ noun \+ "\? This cannot be undone\./);
    assert.match(js, /rename\.disabled = !poolSelectMode \|\| n !== 1/);
    assert.match(js, /data-folder-delete/);
    assert.match(js, /data-folder-rename/);
    assert.match(js, /data-folder-zip/);
    assert.match(view, /id="poolUploadInput"/);
    assert.match(view, /data-upload-zone/);
    assert.match(view, /Upload photos/);
    assert.match(view, /id="btnUploadRetry"/);
    assert.match(view, /Retry failed/);
    assert.match(js, /data-upload-zone/);
    assert.match(js, /data-folder-id/);
    assert.match(js, /uploadConcurrency/);
    assert.match(js, /A photo with that name already exists in this project/);
    assert.match(js, /const files = Array\.from\(input\.files \|\| \[\]\);\s*input\.value = "";/);
    assert.match(view, /id="btnPhotoShare"/);
    assert.match(view, /Get photo sharing code/);
    assert.match(view, /Data Horizontal DW!F1/);
    assert.match(view, /id="poolFind"/);
    assert.match(view, /id="poolReplaceWith"/);
    assert.match(view, /id="btnPoolReplace"/);
    assert.match(view, />Find this</);
    assert.match(view, />Replace with</);
    assert.match(js, /photo-code-input/);
    assert.match(js, /<textarea class="photo-code-input"/);
    assert.match(js, /commitCodeEdit/);
    assert.match(css, /\.photo-grid\s*\{[^}]*minmax\(192px,\s*1fr\)/s);
    assert.match(css, /\.folder-photos\s*\{[^}]*minmax\(192px,\s*1fr\)/s);
    assert.match(css, /\.photo-code-input\s*\{[^}]*overflow-wrap:\s*break-word/s);
    assert.match(css, /\.photo-code-input\s*\{[^}]*max-height:\s*calc\(1\.3em \* 3/s);
    assert.doesNotMatch(css, /repeat\(15,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(js, /data-folder-replace-confirm/);
    assert.match(js, /poolReplaceApi/);
    assert.match(view, /id="btnPoolShowAll"/);
    assert.match(view, />Show all</);
    assert.match(view, /Showing photos added in the last 7 days/);
    assert.match(js, /This replaces the stored photo; the unblurred version will not be kept/);
    assert.match(js, /imageOrientation:\s*"from-image"/);
    assert.match(js, /quality:\s*0\.95/);
    assert.match(js, /Showing photos added in the last 7 days/);
  });
});

describe("photo upload names", () => {
  it("uses the file stem as the photo code and keeps a safe extension", () => {
    const jpeg = parseUploadedPhotoName("2245623-Kitchen-1.jpg");
    assert.equal(jpeg.ok, true);
    if (jpeg.ok) {
      assert.equal(jpeg.name.code, "2245623-Kitchen-1");
      assert.equal(jpeg.name.fileName, "2245623-Kitchen-1.jpg");
      assert.equal(jpeg.name.ext, ".jpg");
    }
    const upper = parseUploadedPhotoName("IMG_1234.HEIC");
    assert.equal(upper.ok, true);
    if (upper.ok) {
      assert.equal(upper.name.code, "IMG_1234");
      assert.equal(upper.name.fileName, "IMG_1234.heic");
      assert.equal(upper.name.ext, ".heic");
    }
    const jpegExt = parseUploadedPhotoName("room.JPEG");
    assert.equal(jpegExt.ok, true);
    if (jpegExt.ok) assert.equal(jpegExt.name.fileName, "room.jpg");
    assert.equal(parseUploadedPhotoName("notes.txt").ok, false);
    assert.equal(parseUploadedPhotoName("").ok, false);
    assert.equal(parseUploadedPhotoName(".jpg").ok, false);
    assert.equal(parseUploadedPhotoName("../secret.jpg").ok, false);
    assert.equal(parseUploadedPhotoName("pool/secret.jpg").ok, false);
    assert.equal(parseUploadedPhotoName("pool\\secret.jpg").ok, false);
    assert.equal(uploadMimeAllowed("image/jpeg"), true);
    assert.equal(uploadMimeAllowed(""), true);
    assert.equal(uploadMimeAllowed("application/octet-stream"), true);
    assert.equal(uploadMimeAllowed("text/html"), false);
    assert.match(photoTooLargeMessage(), /40 MB/);
    assert.equal(PHOTO_UPLOAD_MAX_BYTES, 40 * 1024 * 1024);
  });

  it("rejects an unsafe name, a non-image type, and an oversized file before storage", async () => {
    const calls: string[] = [];
    const storage: PhotoStorageOps & { calls: string[] } = {
      calls,
      configured: () => true,
      remove: async () => true,
      copy: async () => "copied",
      put: async () => {
        calls.push("put");
        return true;
      },
    };
    const pathName = await uploadProjectPhoto(
      "proj",
      { originalName: "../secret.jpg", buffer: Buffer.from("x") },
      { kind: "pool" },
      storage
    );
    assert.equal(pathName.ok, false);
    if (!pathName.ok) assert.equal(pathName.status, 400);
    const html = await uploadProjectPhoto(
      "proj",
      { originalName: "room.jpg", buffer: Buffer.from("x"), mime: "text/html" },
      { kind: "pool" },
      storage
    );
    assert.equal(html.ok, false);
    const empty = await uploadProjectPhoto(
      "proj",
      { originalName: "room.jpg", buffer: Buffer.alloc(0) },
      { kind: "pool" },
      storage
    );
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.status, 400);
    const huge = await uploadProjectPhoto(
      "proj",
      { originalName: "room.jpg", buffer: Buffer.alloc(PHOTO_UPLOAD_MAX_BYTES + 1) },
      { kind: "pool" },
      storage
    );
    assert.equal(huge.ok, false);
    if (!huge.ok) assert.equal(huge.status, 413);
    assert.equal(storage.calls.length, 0);
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

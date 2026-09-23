import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HHSRS_CATEGORIES, isHhsrsCategory, isHhsrsRating } from "./hhsrs-categories.js";
import {
  emptyHhsrsValues,
  HHSRS_MAX_FILE_BYTES,
  HHSRS_MAX_FILE_MB,
  HHSRS_MAX_PHOTOS,
  HHSRS_MAX_REQUEST_BYTES,
  hhsrsMulterLimits,
  hhsrsPhotoHint,
  hhsrsPhotoSizeError,
  hhsrsUrl,
  isAllowedImageName,
  keepRequestedPhotos,
  listKeepPhotoNames,
  readHhsrsValues,
  siteFormProjectFlags,
  todayLondonDate,
  validateHhsrsForm,
  validatePhotos,
  type HhsrsDraft,
} from "./hhsrs-site-form.js";

describe("HHSRS categories", () => {
  it("lists 21 unique hazard names without ratings", () => {
    assert.equal(HHSRS_CATEGORIES.length, 21);
    assert.equal(new Set(HHSRS_CATEGORIES).size, 21);
    for (const name of HHSRS_CATEGORIES) {
      assert.equal(isHhsrsCategory(name), true);
      assert.doesNotMatch(name, /\b(Low|Medium|High)\b/);
    }
    assert.equal(isHhsrsCategory("Not a hazard"), false);
    assert.equal(isHhsrsRating("Low"), true);
    assert.equal(isHhsrsRating("Critical"), false);
  });
});

describe("hhsrsUrl", () => {
  it("keeps the form at the domain-root path", () => {
    assert.equal(hhsrsUrl(), "/HHSRS-site-form");
    assert.equal(hhsrsUrl("/"), "/HHSRS-site-form");
    assert.equal(hhsrsUrl("/new"), "/HHSRS-site-form/new");
    assert.equal(hhsrsUrl("/HHSRS-site-form/thanks"), "/HHSRS-site-form/thanks");
  });
});

describe("validateHhsrsForm", () => {
  const project = { id: "proj-1", name: "Devon HA" };
  const valid = {
    ...emptyHhsrsValues(),
    projectId: "proj-1",
    surveyDate: "2026-09-20",
    uprn: "1001",
    fullAddress: "1 High Street",
    postcode: "EX1 1AA",
    surveyorName: "Alex Surveyor",
    category: "Damp & Mould Growth",
    rating: "High",
    comment: "Visible mould in bathroom.",
  };

  it("accepts a complete issue and copies the active project name", () => {
    const result = validateHhsrsForm(valid, project);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.projectName, "Devon HA");
      assert.equal(result.data.clientCallReference, "");
    }
  });

  it("requires the listed fields and an active project", () => {
    const result = validateHhsrsForm(emptyHhsrsValues(), null);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors.projectId, "Select a project.");
      assert.equal(result.errors.uprn, "Enter the UPRN.");
      assert.equal(result.errors.fullAddress, "Enter the full address.");
      assert.equal(result.errors.postcode, "Enter the postcode.");
      assert.equal(result.errors.surveyorName, "Enter the surveyor name.");
      assert.equal(result.errors.category, "Select an HHSRS category.");
      assert.equal(result.errors.rating, "Select a rating.");
      assert.equal(result.errors.comment, "Enter a comment.");
    }
    const archived = validateHhsrsForm(valid, null);
    assert.equal(archived.ok, false);
    if (!archived.ok) assert.equal(archived.errors.projectId, "Select an active (Current) project.");
  });

  it("rejects invalid dates, categories and ratings", () => {
    const badDate = validateHhsrsForm({ ...valid, surveyDate: "2026-02-30" }, project);
    assert.equal(badDate.ok, false);
    const badCat = validateHhsrsForm({ ...valid, category: "Damp & Mould Growth — High" }, project);
    assert.equal(badCat.ok, false);
    const badRating = validateHhsrsForm({ ...valid, rating: "Cat 1" }, project);
    assert.equal(badRating.ok, false);
  });

  it("reads trimmed body fields and defaults the survey date", () => {
    const values = readHhsrsValues({
      projectId: "  proj-1  ",
      uprn: " 1001 ",
      comment: " note ",
    });
    assert.equal(values.projectId, "proj-1");
    assert.equal(values.uprn, "1001");
    assert.equal(values.surveyDate, todayLondonDate());
    assert.equal(values.cat1Confirmed, false);
    assert.match(todayLondonDate(), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(readHhsrsValues({ cat1Confirmed: "true" }).cat1Confirmed, true);
  });

  it("keeps Category 1 only for Onward and flags Saxon and call extras", () => {
    const onward = validateHhsrsForm({ ...valid, cat1Confirmed: true }, { id: "proj-1", name: "Onward 2026" });
    assert.equal(onward.ok, true);
    if (onward.ok) assert.equal(onward.data.cat1Confirmed, true);

    const other = validateHhsrsForm({ ...valid, cat1Confirmed: true }, project);
    assert.equal(other.ok, true);
    if (other.ok) assert.equal(other.data.cat1Confirmed, false);

    assert.equal(siteFormProjectFlags("Onward Liverpool 2026").onward, true);
    assert.equal(siteFormProjectFlags("Onward Liverpool 2026").calls, true);
    assert.equal(siteFormProjectFlags("Onward Liverpool 2026").saxon, false);
    assert.equal(siteFormProjectFlags("Saxon Weald 2026 Phase 4").saxon, true);
    assert.equal(siteFormProjectFlags("Saxon Weald 2026 Phase 4").calls, true);
    assert.equal(siteFormProjectFlags("Saxon Weald 2026 Phase 4").onward, false);
    assert.equal(siteFormProjectFlags("Cornwall 2026 Ph2").online, true);
    assert.equal(siteFormProjectFlags("Gateway 2026").calls, false);
    assert.equal(siteFormProjectFlags("Demo current project (local)").onward, false);
  });
});

describe("validatePhotos", () => {
  it("caps at 4 images and checks type and size", () => {
    const ok = { originalname: "a.jpg", mimetype: "image/jpeg", size: 1000 };
    assert.equal(validatePhotos([ok, ok], 2), undefined);
    assert.match(String(validatePhotos([ok], 4)), /up to 4/);
    assert.equal(validatePhotos([{ ...ok, size: HHSRS_MAX_FILE_BYTES }], 0), undefined);
    assert.match(String(validatePhotos([{ ...ok, size: HHSRS_MAX_FILE_BYTES + 1 }], 0)), /40MB/);
    assert.match(String(validatePhotos([{ originalname: "x.gif", mimetype: "image/gif", size: 10 }], 0)), /JPEG/);
    assert.equal(
      validatePhotos([{ originalname: "IMG_1234.HEIC", mimetype: "image/heic", size: 12 * 1024 * 1024 }], 0),
      undefined
    );
    assert.equal(isAllowedImageName("shot.heif", "image/heif"), true);
    assert.equal(isAllowedImageName("shot.webp", "image/webp"), true);
  });

  it("exposes a 40MB per-file limit and a 4-photo request budget", () => {
    assert.equal(HHSRS_MAX_FILE_MB, 40);
    assert.equal(HHSRS_MAX_PHOTOS, 4);
    assert.equal(HHSRS_MAX_FILE_BYTES, 40 * 1024 * 1024);
    assert.ok(HHSRS_MAX_REQUEST_BYTES >= HHSRS_MAX_PHOTOS * HHSRS_MAX_FILE_BYTES);
    assert.equal(hhsrsMulterLimits.fileSize, HHSRS_MAX_FILE_BYTES);
    assert.equal(hhsrsMulterLimits.files, HHSRS_MAX_PHOTOS);
    assert.match(hhsrsPhotoSizeError(), /each photo up to 40MB/i);
    assert.match(hhsrsPhotoHint(), /each photo up to 40MB/i);
  });

  it("keeps only requested draft photos", () => {
    const draft = {
      photos: [
        { storedName: "keep.jpg", originalName: "a.jpg", mime: "image/jpeg", size: 1 },
        { storedName: "drop.jpg", originalName: "b.jpg", mime: "image/jpeg", size: 1 },
      ],
    } as HhsrsDraft;
    assert.deepEqual(
      keepRequestedPhotos(draft, listKeepPhotoNames({ keepPhotos: ["keep.jpg"] })).map((p) => p.storedName),
      ["keep.jpg"]
    );
  });
});

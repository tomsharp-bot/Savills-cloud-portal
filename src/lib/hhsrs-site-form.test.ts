import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HHSRS_CATEGORIES, isHhsrsCategory, isHhsrsRating } from "./hhsrs-categories.js";
import {
  emptyHhsrsValues,
  hhsrsUrl,
  keepRequestedPhotos,
  listKeepPhotoNames,
  readHhsrsValues,
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
    assert.match(todayLondonDate(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("validatePhotos", () => {
  it("caps at 4 images and checks type and size", () => {
    const ok = { originalname: "a.jpg", mimetype: "image/jpeg", size: 1000 };
    assert.equal(validatePhotos([ok, ok], 2), undefined);
    assert.match(String(validatePhotos([ok], 4)), /up to 4/);
    assert.match(String(validatePhotos([{ ...ok, size: 9 * 1024 * 1024 }], 0)), /8MB/);
    assert.match(String(validatePhotos([{ originalname: "x.gif", mimetype: "image/gif", size: 10 }], 0)), /JPEG/);
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

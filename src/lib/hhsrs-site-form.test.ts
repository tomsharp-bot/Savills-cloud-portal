import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ejs from "ejs";
import { HHSRS_CATEGORIES, HHSRS_SITE_FORM_RATINGS, isHhsrsCategory, isHhsrsRating, isHhsrsSiteFormRating } from "./hhsrs-categories.js";
import {
  composeCallNotes,
  formatHhsrsSurveyDate,
  emptyHhsrsValues,
  formatStockAddressLine,
  HHSRS_MAX_FILE_BYTES,
  HHSRS_MAX_FILE_MB,
  HHSRS_MAX_PHOTOS,
  HHSRS_MIN_PHOTOS,
  CALL_REF_BLANK_REASONS,
  HHSRS_MAX_REQUEST_BYTES,
  hhsrsMulterLimits,
  hhsrsPhotoHint,
  hhsrsPhotoSizeError,
  hhsrsUrl,
  isAllowedImageName,
  keepRequestedPhotos,
  listKeepPhotoNames,
  normalizeUprn,
  readHhsrsValues,
  siteFormProjectFlags,
  siteFormSectionState,
  siteSubmissionCallFields,
  stockMatchFromRows,
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
    assert.deepEqual(HHSRS_SITE_FORM_RATINGS, [
      "Low",
      "Medium",
      "Slight",
      "Moderate",
      "Severe",
      "High - Emergency Risk",
      "High - Severe Risk",
    ]);
    assert.equal(isHhsrsSiteFormRating("High - Emergency Risk"), true);
    assert.equal(isHhsrsSiteFormRating("High"), false);
    assert.equal(isHhsrsSiteFormRating("Extreme"), false);
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
    rating: "Severe",
    comment: "Visible mould in bathroom.",
    otherDetails: "No access issues.",
    addressConfirmed: true,
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
      assert.equal(result.errors.addressConfirmed, "Confirm the address is correct.");
      assert.equal(result.errors.surveyorName, "Select a surveyor.");
      assert.equal(result.errors.category, "Select an HHSRS category.");
      assert.equal(result.errors.rating, "Select a rating.");
      assert.equal(result.errors.comment, "Enter a comment.");
      assert.equal(result.errors.otherDetails, undefined);
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
    const badRating = validateHhsrsForm({ ...valid, rating: "High" }, project);
    assert.equal(badRating.ok, false);
    const extreme = validateHhsrsForm({ ...valid, rating: "Extreme" }, project);
    assert.equal(extreme.ok, false);
    const emergency = validateHhsrsForm({ ...valid, rating: "High - Emergency Risk" }, project);
    assert.equal(emergency.ok, true);
    const stranger = validateHhsrsForm(valid, project, { surveyorNames: ["Pat Jones"] });
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.errors.surveyorName, "Select a surveyor from Personnel.");
    const known = validateHhsrsForm(valid, project, { surveyorNames: ["Alex Surveyor"] });
    assert.equal(known.ok, true);
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
    assert.equal(values.addressConfirmed, false);
    assert.equal(values.callUnreached, false);
    assert.match(todayLondonDate(), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(readHhsrsValues({ cat1Confirmed: "true" }).cat1Confirmed, false);
    assert.equal(readHhsrsValues({ addressConfirmed: "on" }).addressConfirmed, true);
    assert.equal(readHhsrsValues({ uprn: " 1000 403 " }).uprn, "1000403");
    const legacy = readHhsrsValues({ callUnreached: "on", callUnreachedNote: " No answer " });
    assert.equal(legacy.callUnreached, true);
    assert.equal(legacy.callRefBlankReason, "No answer");
    assert.equal(legacy.callUnreachedNote, "");
  });

  it("shows a stored YYYY-MM-DD survey date as DD/MM/YYYY", () => {
    const stored = "2026-09-25";
    assert.equal(formatHhsrsSurveyDate(stored), "25/09/2026");
    assert.equal(formatHhsrsSurveyDate("2026-09-20"), "20/09/2026");
    assert.equal(stored, "2026-09-25");
    assert.equal(formatHhsrsSurveyDate(""), "");
    assert.equal(formatHhsrsSurveyDate("25/09/2026"), "25/09/2026");
  });

  it("does not store Category 1 from the site form, and flags Saxon and call extras", () => {
    const onward = validateHhsrsForm(
      { ...valid, cat1Confirmed: true, clientCallReference: "CR-9" },
      { id: "proj-1", name: "Onward 2026" }
    );
    assert.equal(onward.ok, true);
    if (onward.ok) assert.equal(onward.data.cat1Confirmed, false);

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
    assert.equal(siteFormProjectFlags("MTVH 2026").calls, false);
    assert.equal(siteFormProjectFlags("MTVH Pilot 2026").calls, false);
    assert.equal(siteFormProjectFlags("MTVH Phase 1 2026").calls, false);
    assert.equal(siteFormProjectFlags("A2D 2026 Phase 4").calls, true);
    assert.equal(siteFormProjectFlags("Vico 2026 8k").calls, true);
  });

  it("accepts a blank other details field, and skips call reference unless the project needs it", () => {
    const blankDetails = { ...valid, otherDetails: "   " };
    const devon = validateHhsrsForm(blankDetails, project);
    assert.equal(devon.ok, true);
    if (devon.ok) assert.equal(devon.data.otherDetails, "");

    const mtvh = validateHhsrsForm(blankDetails, { id: "mtvh", name: "MTVH 2026" });
    assert.equal(mtvh.ok, true);
    if (mtvh.ok) {
      assert.equal(mtvh.data.projectName, "MTVH 2026");
      assert.equal(mtvh.data.clientCallReference, "");
      assert.equal(mtvh.data.otherDetails, "");
      assert.equal(mtvh.data.callUnreached, false);
    }

    const phase = validateHhsrsForm(
      { ...blankDetails, clientCallReference: "" },
      { id: "mtvh-p1", name: "MTVH Phase 1 2026" }
    );
    assert.equal(phase.ok, true);

    const onwardMissing = validateHhsrsForm(blankDetails, { id: "onward", name: "Onward 2026" });
    assert.equal(onwardMissing.ok, false);
    if (!onwardMissing.ok) {
      assert.equal(onwardMissing.errors.otherDetails, undefined);
      assert.match(String(onwardMissing.errors.clientCallReference), /why it is blank/);
    }

    const onwardWithRef = validateHhsrsForm(
      { ...blankDetails, clientCallReference: "CR-9" },
      { id: "onward", name: "Onward 2026" }
    );
    assert.equal(onwardWithRef.ok, true);
    if (onwardWithRef.ok) assert.equal(onwardWithRef.data.otherDetails, "");
  });

  it("requires a call reference, or a blank reason (free text only when Other)", () => {
    const onward = { id: "proj-1", name: "Onward 2026" };
    const missing = validateHhsrsForm(valid, onward);
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.match(String(missing.errors.clientCallReference), /why it is blank/);
    }

    const withRef = validateHhsrsForm({ ...valid, clientCallReference: "CR-9" }, onward);
    assert.equal(withRef.ok, true);
    if (withRef.ok) assert.equal(withRef.data.cat1Confirmed, false);

    const tickedBlank = validateHhsrsForm({ ...valid, callUnreached: true }, onward);
    assert.equal(tickedBlank.ok, false);
    if (!tickedBlank.ok) assert.equal(tickedBlank.errors.callRefBlankReason, "Select why the call reference is blank.");

    const otherBlank = validateHhsrsForm(
      { ...valid, callUnreached: true, callRefBlankReason: "Other", callUnreachedNote: "  " },
      onward
    );
    assert.equal(otherBlank.ok, false);
    if (!otherBlank.ok) assert.equal(otherBlank.errors.callUnreachedNote, "Say why the call reference is blank.");

    const noAnswer = validateHhsrsForm(
      { ...valid, callUnreached: true, callRefBlankReason: "No answer" },
      onward
    );
    assert.equal(noAnswer.ok, true);
    if (noAnswer.ok) {
      assert.deepEqual(siteSubmissionCallFields(noAnswer.data), {
        clientCallReference: "",
        callOutcome: "Attempted",
        callNotes: "No answer",
      });
    }

    const busyNote = validateHhsrsForm(
      { ...valid, callUnreached: true, callRefBlankReason: "Engaged/busy", callUnreachedNote: "Line stayed busy" },
      onward
    );
    assert.equal(busyNote.ok, true);
    if (busyNote.ok) {
      assert.equal(composeCallNotes("Engaged/busy", "Line stayed busy"), "Engaged/busy — Line stayed busy");
      assert.deepEqual(siteSubmissionCallFields(busyNote.data), {
        clientCallReference: "",
        callOutcome: "Attempted",
        callNotes: "Engaged/busy — Line stayed busy",
      });
    }

    const unreached = validateHhsrsForm(
      { ...valid, callUnreached: true, callRefBlankReason: "Other", callUnreachedNote: "Voicemail full." },
      onward
    );
    assert.equal(unreached.ok, true);
    if (unreached.ok) {
      assert.equal(unreached.data.clientCallReference, "");
      assert.equal(unreached.data.callUnreached, true);
      assert.equal(unreached.data.callRefBlankReason, "Other");
      assert.equal(unreached.data.callUnreachedNote, "Voicemail full.");
      assert.equal(unreached.data.otherDetails, "No access issues.");
      assert.deepEqual(siteSubmissionCallFields(unreached.data), {
        clientCallReference: "",
        callOutcome: "Attempted",
        callNotes: "Other — Voicemail full.",
      });
    }

    const refAndSkip = validateHhsrsForm(
      { ...valid, clientCallReference: "CR-9", callUnreached: true, callRefBlankReason: "No answer" },
      onward
    );
    assert.equal(refAndSkip.ok, true);
    if (refAndSkip.ok) {
      assert.deepEqual(siteSubmissionCallFields(refAndSkip.data), {
        clientCallReference: "",
        callOutcome: "Attempted",
        callNotes: "No answer",
      });
    }

    const gateway = validateHhsrsForm(valid, { id: "g", name: "Gateway 2026" });
    assert.equal(gateway.ok, true);
    if (gateway.ok) {
      assert.equal(gateway.data.callUnreached, false);
      assert.equal(gateway.data.otherDetails, "No access issues.");
      assert.deepEqual(siteSubmissionCallFields(gateway.data), {
        clientCallReference: "",
        callOutcome: "",
        callNotes: "",
      });
    }
  });
});

describe("validatePhotos", () => {
  it("caps at 4 images and checks type and size", () => {
    const ok = { originalname: "a.jpg", mimetype: "image/jpeg", size: 1000 };
    assert.equal(validatePhotos([ok, ok], 2), undefined);
    assert.match(String(validatePhotos([], 0)), /at least 1 photo/);
    assert.match(String(validatePhotos([ok], 4)), /1 to 4/);
    assert.equal(HHSRS_MIN_PHOTOS, 1);
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
    assert.match(hhsrsPhotoHint(), /3000px/);
    assert.match(hhsrsPhotoHint(), /25 MB/);
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

describe("stock UPRN address", () => {
  it("builds a confirmable line and prefers a dwelling", () => {
    assert.equal(normalizeUprn(" 1000 40123456 "), "100040123456");
    assert.equal(
      formatStockAddressLine({
        number: "12",
        block: "",
        street: "Moor Cross",
        area: "Bude",
        city: "Bude",
      }),
      "12, Moor Cross, Bude"
    );
    const match = stockMatchFromRows([
      {
        uprn: "100040123890",
        kind: "block",
        number: "3",
        block: "A",
        street: "New Road",
        area: "Bude",
        city: "Bude",
        postcode: "EX23 9AP",
      },
      {
        uprn: "100040123890",
        kind: "dwelling",
        number: "3",
        block: "A",
        street: "New Road",
        area: "Bude",
        city: "Bude",
        postcode: "EX23 9AP",
      },
    ]);
    assert.equal(match?.type, "Dwelling");
    assert.equal(match?.asset, "3");
    assert.equal(match?.line, "3, A, New Road, Bude");
    assert.equal(match?.postcode, "EX23 9AP");
    assert.equal(stockMatchFromRows([]), null);
  });

  it("opens the next section only when the current one is complete", () => {
    const empty = siteFormSectionState(emptyHhsrsValues(), "Gateway 2026");
    assert.deepEqual(empty, { visit: false, property: false, hazard: false, extras: false });
    const visit = siteFormSectionState(
      { ...emptyHhsrsValues(), projectId: "p", surveyDate: "2026-09-20", surveyorName: "Alex Surveyor" },
      "Gateway 2026"
    );
    assert.equal(visit.visit, true);
    assert.equal(visit.property, false);
    const ready = siteFormSectionState(
      {
        ...emptyHhsrsValues(),
        projectId: "p",
        surveyDate: "2026-09-20",
        surveyorName: "Alex Surveyor",
        uprn: "1001",
        fullAddress: "1 High Street",
        postcode: "EX1 1AA",
        addressConfirmed: true,
        category: "Damp & Mould Growth",
        rating: "Low",
        comment: "Damp patch.",
      },
      "Gateway 2026"
    );
    assert.equal(ready.extras, true);
    const mtvh = siteFormSectionState(
      {
        ...emptyHhsrsValues(),
        projectId: "p",
        surveyDate: "2026-09-20",
        surveyorName: "Alex Surveyor",
        uprn: "1001",
        fullAddress: "1 High Street",
        postcode: "EX1 1AA",
        addressConfirmed: true,
        category: "Damp & Mould Growth",
        rating: "Low",
        comment: "Damp patch.",
      },
      "MTVH 2026"
    );
    assert.equal(mtvh.extras, true);
    const onward = siteFormSectionState(
      {
        ...emptyHhsrsValues(),
        projectId: "p",
        surveyDate: "2026-09-20",
        surveyorName: "Alex Surveyor",
        uprn: "1001",
        fullAddress: "1 High Street",
        postcode: "EX1 1AA",
        addressConfirmed: true,
        category: "Damp & Mould Growth",
        rating: "Low",
        comment: "Damp patch.",
      },
      "Onward 2026"
    );
    assert.equal(onward.hazard, true);
    assert.equal(onward.extras, false);
    const onwardCalled = siteFormSectionState(
      {
        ...emptyHhsrsValues(),
        projectId: "p",
        surveyDate: "2026-09-20",
        surveyorName: "Alex Surveyor",
        uprn: "1001",
        fullAddress: "1 High Street",
        postcode: "EX1 1AA",
        addressConfirmed: true,
        category: "Damp & Mould Growth",
        rating: "Low",
        comment: "Damp patch.",
        clientCallReference: "CR-1",
      },
      "Onward 2026"
    );
    assert.equal(onwardCalled.extras, true);
  });
});

describe("HHSRS site form project option flags", () => {
  it("renders data-calls, data-saxon and data-online unescaped", () => {
    const template = readFileSync(join(process.cwd(), "views/hhsrs-site-form/form.ejs"), "utf8");
    const html = ejs.render(
      template,
      {
        title: "New issue",
        hhsrsUrl,
        minPhotos: HHSRS_MIN_PHOTOS,
        maxPhotos: HHSRS_MAX_PHOTOS,
        maxFileBytes: HHSRS_MAX_FILE_BYTES,
        maxFileMb: HHSRS_MAX_FILE_MB,
        photoHint: hhsrsPhotoHint(),
        formError: "",
        errors: {},
        values: { ...emptyHhsrsValues(), projectId: "a2" },
        draft: null,
        surveyors: [{ id: "s1", name: "Alex Surveyor" }],
        categories: HHSRS_CATEGORIES,
        ratings: HHSRS_SITE_FORM_RATINGS,
        callBlankReasons: CALL_REF_BLANK_REASONS,
        steps: siteFormSectionState(emptyHhsrsValues(), ""),
        jump: "",
        projects: [
          { id: "a2", name: "A2Dominion 2026 - Ph4", flags: { calls: true, onward: false, saxon: false, online: false } },
          { id: "sx", name: "Saxon Weald 2026", flags: { calls: true, onward: false, saxon: true, online: false } },
          { id: "cw", name: "Cornwall 2026", flags: { calls: false, onward: false, saxon: false, online: true } },
          { id: "gw", name: "Gateway 2026", flags: { calls: false, onward: false, saxon: false, online: false } },
        ],
      },
      { filename: join(process.cwd(), "views/hhsrs-site-form/form.ejs") }
    );

    const option = (id: string) => {
      const match = html.match(new RegExp(`<option[^>]*value="${id}"[^>]*>`));
      assert.ok(match, `option ${id} rendered`);
      return match[1] ? match[0] : match[0];
    };
    const a2 = option("a2");
    assert.match(a2, /data-calls="1"/);
    assert.match(a2, /\bselected\b/);
    assert.doesNotMatch(a2, /&#34;|data-calls=&/);
    const saxon = option("sx");
    assert.match(saxon, /data-calls="1"/);
    assert.match(saxon, /data-saxon="1"/);
    const cornwall = option("cw");
    assert.match(cornwall, /data-online="1"/);
    assert.doesNotMatch(cornwall, /data-calls=/);
    const gateway = option("gw");
    assert.doesNotMatch(gateway, /data-calls=|data-saxon=|data-online=/);
    assert.doesNotMatch(html, /data-calls=&#34;|data-saxon=&#34;|data-online=&#34;/);
    assert.match(html, /data-jump=""/);
    assert.match(html, /viewport-fit=cover/);
  });
});

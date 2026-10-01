import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clientDescription,
  DraftError,
  draftFromSubmission,
  formatAddress,
  prepareClientEmailBody,
  projectDraft,
  templateId,
} from "./hhsrs-reporter-draft.js";
import { draftEmailFromReviewFields, mergeReviewDraftFields, statusLabel, tryDraftFromRow } from "./hhsrs-reporter.js";

describe("HHSRS Reporter templateId", () => {
  it("maps project names to known template families", () => {
    assert.equal(templateId("Demo Housing"), "Standard");
    assert.equal(templateId("BPHA East 2026"), "BPHA");
    assert.equal(templateId("Cornwall Housing"), "Cornwall");
    assert.equal(templateId("Onward Homes"), "Onward");
    assert.equal(templateId("VICO Homes"), "Vico Homes");
    assert.equal(templateId("A2Dominion 2026"), "A2Dominion");
    assert.equal(templateId("Bristol 2025"), "Bristol");
    assert.equal(templateId("LFHA 2026"), "LFHA");
    assert.equal(templateId("Leeds Fed HA 2026"), "LFHA");
    assert.equal(templateId("Leeds Federation"), "LFHA");
    assert.equal(templateId("Leeds"), "Standard");
    assert.equal(templateId("Onward (Leeds)"), "Onward");
    assert.equal(templateId("  "), "");
  });
});

describe("HHSRS Reporter formatAddress", () => {
  it("formats flat numbers and postcodes like the desktop Reporter", () => {
    assert.equal(formatAddress("Flat 4 2 Beethoven Street sw1a1aa"), "Flat 4, 2 Beethoven Street SW1A 1AA");
    assert.equal(formatAddress("1 HIGH STREET, ex1 1aa"), "1 High Street, EX1 1AA");
  });
});

describe("HHSRS Reporter clientDescription", () => {
  it("rewrites common electrical and damp observations", () => {
    assert.equal(
      clientDescription("damaged light fitting in lounge", "Electrical Hazards"),
      "The light fitting in the lounge is damaged."
    );
    assert.equal(
      clientDescription("Exposed wire to hallway ceiling", "Electrical Hazards"),
      "There is an exposed wire on the hallway ceiling."
    );
    assert.equal(
      clientDescription("black mould in cupboard in hallway", "Damp & Mould Growth"),
      "There is mould in the cupboard in the hallway."
    );
    assert.equal(
      clientDescription("mould in all rooms apart from the bedroom", "Damp & Mould Growth"),
      "There is mould in all rooms except the bedroom."
    );
    assert.equal(
      clientDescription("Smell of gas in the cupboard", "Carbon Monoxide & Indoor Air Pollutants"),
      "A smell of gas has been reported in the cupboard."
    );
  });

  it("rejects email headers in the fault sentence", () => {
    assert.throws(
      () => clientDescription("From: a@b.com mould in kitchen", "Damp & Mould Growth"),
      (err: unknown) => err instanceof DraftError
    );
  });
});

describe("HHSRS Reporter projectDraft", () => {
  const base = {
    project: "Demo Housing",
    address: "1 high street, ex1 1aa",
    hazard: "Electrical Hazards",
    rating: "High",
    description: "damaged light fitting in lounge",
    uprn: "100123",
    surveyDate: "2026-09-20",
  };

  it("builds the Standard subject and body", () => {
    const draft = projectDraft(base, []);
    assert.equal(draft.subject, "Demo Housing - HHSRS – 1 high street, EX1 1AA");
    assert.equal(
      draft.body,
      [
        "HHSRS notification",
        "",
        "• UPRN: 100123",
        "• Address: 1 high street, EX1 1AA",
        "• Survey date: 20/09/2026",
        "• Hazard category: Electrical Hazards",
        "• Comments: Damaged light fitting in lounge.",
        "• Hazard rating: High",
      ].join("\n")
    );
    assert.doesNotMatch(draft.body, /One of our surveyors has visited/);
    assert.doesNotMatch(draft.body, /on the HHSRS/);
  });

  it("keeps BPHA subject and omits the surveyor-visit intro", () => {
    const draft = projectDraft({ ...base, project: "BPHA East 2026" }, ["a"]);
    assert.equal(draft.subject, "BPHA - HHSRS – 1 high street, EX1 1AA");
    assert.match(draft.body, /• Comments: Damaged light fitting in lounge\./);
    assert.doesNotMatch(draft.body, /The light fitting in the lounge is damaged/);
    assert.doesNotMatch(draft.body, /One of our surveyors has visited/);
    assert.doesNotMatch(draft.body, /Attached is a photo/);
    assert.doesNotMatch(draft.body, /on the HHSRS/);
  });

  it("builds an Onward CAT1 draft when required fields are present", () => {
    const draft = projectDraft(
      {
        ...base,
        project: "Onward Homes",
        cat1Confirmed: true,
        onwardTopic: "Electrical",
        callStatus: "Completed",
        callRef: "CR-99",
        description: "Exposed wire to hallway ceiling",
      },
      []
    );
    assert.equal(
      draft.subject,
      "Onward 2026 – HHSRS CAT1 (Electrical) – UPRN 100123 - 1 high street, EX1 1AA"
    );
    assert.match(draft.body, /• Call reference: CR-99/);
    assert.doesNotMatch(draft.body, /• Onward call:/);
    assert.match(draft.body, /• Survey date: 20\/09\/2026/);
    assert.doesNotMatch(draft.body, /2026-09-20/);
    assert.doesNotMatch(draft.body, /One of our surveyors has visited/);
    assert.doesNotMatch(draft.body, /on the HHSRS/);
  });

  it("keeps only the surveyor’s factual sentence from Campion House waffle", () => {
    const draft = projectDraft(
      {
        ...base,
        address: "Campion House",
        uprn: "",
        surveyDate: "",
        description: [
          "One of our surveyors has visited Campion House.",
          "Attached is a photo taken from the property.",
          "There is a loose socket to the communal area on the 6th floor, exposing the live parts within.",
          "We have recorded this as High for Electrical Hazards on the HHSRS.",
          "Please arrange for this to be actioned.",
        ].join(" "),
      },
      ["lounge.jpg"]
    );
    const notes = draft.body.split("\n").find((line) => line.startsWith("• Comments:"));
    assert.equal(
      notes,
      "• Comments: There is a loose socket to the communal area on the 6th floor, exposing the live parts within."
    );
    assert.match(draft.body, /• Address: Campion House/);
    assert.doesNotMatch(notes || "", /Campion House|photo|surveyor|HHSRS|arrange/i);
  });

  it("shows the survey date as DD/MM/YYYY without moving the calendar day", () => {
    const uk = projectDraft({ ...base, surveyDate: "2026-09-28" }, []);
    assert.match(uk.body, /• Survey date: 28\/09\/2026/);
    assert.doesNotMatch(uk.body, /2026-09-28/);

    const midnightUtc = projectDraft({ ...base, surveyDate: "2026-09-28T00:00:00.000Z" }, []);
    assert.match(midnightUtc.body, /• Survey date: 28\/09\/2026/);
    assert.doesNotMatch(midnightUtc.body, /27\/09\/2026/);

    const alreadyUk = projectDraft({ ...base, surveyDate: "28/09/2026" }, []);
    assert.match(alreadyUk.body, /• Survey date: 28\/09\/2026/);
    assert.equal((alreadyUk.body.match(/• Survey date:/g) || []).length, 1);
  });
});

describe("HHSRS Reporter draftFromSubmission", () => {
  it("maps site-form fields into a Standard draft", () => {
    const input = {
      projectName: "Demo Housing",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100123",
      surveyDate: "2026-09-20",
      category: "Electrical Hazards",
      rating: "High",
      comment: "damaged light fitting in lounge",
      photoCount: 0,
    };
    const draft = draftFromSubmission(input);
    assert.equal(draft.subject, "Demo Housing - HHSRS – 1 High Street, EX1 1AA");
    assert.match(draft.body, /• Comments: Damaged light fitting in lounge\./);
    assert.match(draft.body, /• Survey date: 20\/09\/2026/);
    assert.doesNotMatch(draft.body, /2026-09-20/);
    assert.doesNotMatch(draft.body, /The light fitting in the lounge is damaged/);
    assert.equal(input.surveyDate, "2026-09-20");
  });

  it("puts a couldn't-get-through note on the existing Attempted call bullet", () => {
    const onward = draftFromSubmission({
      projectName: "Onward 2026",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100123",
      surveyDate: "2026-09-20",
      category: "Electrical Hazards",
      rating: "High",
      comment: "ignored",
      clientDescription: "Exposed wire to hallway ceiling.",
      clientCallReference: "",
      callOutcome: "Attempted",
      callNotes: "Voicemail full",
      onwardTopic: "Electrical",
      cat1Confirmed: true,
      photoCount: 0,
    });
    assert.match(onward.body, /• Onward call: Voicemail full/);
    assert.doesNotMatch(onward.body, /Onward call reference/);
    assert.doesNotMatch(onward.body, /Call reference: couldn't get through/i);

    const saxon = draftFromSubmission({
      projectName: "Saxon Weald 2026 Phase 4",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100123",
      surveyDate: "2026-09-20",
      category: "Damp & Mould Growth",
      rating: "High",
      comment: "Visible mould in bathroom.",
      clientCallReference: "",
      callOutcome: "Attempted",
      callNotes: "Voicemail full",
      photoCount: 1,
    });
    assert.match(saxon.body, /• Call: Voicemail full/);
    assert.doesNotMatch(saxon.body, /Call reference/);
  });

  it("uses the site-form call labels for projects that need a call reference", () => {
    const shared = {
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100123",
      surveyDate: "2026-09-20",
      category: "Damp & Mould Growth",
      rating: "High",
      comment: "Visible mould in bathroom.",
      photoCount: 0,
    };
    const withRef = draftFromSubmission({
      ...shared,
      projectName: "Vico 2026",
      clientCallReference: "CR-9",
      callOutcome: "",
      callNotes: "",
    });
    assert.match(withRef.body, /• Call reference: CR-9/);
    assert.doesNotMatch(withRef.body, /Why the call reference is blank/);

    const noAnswer = draftFromSubmission({
      ...shared,
      projectName: "Vico 2026",
      clientCallReference: "",
      callOutcome: "Attempted",
      callNotes: "No answer",
    });
    assert.doesNotMatch(noAnswer.body, /Why the call reference is blank/);
    assert.doesNotMatch(noAnswer.body, /call reference/i);
    assert.doesNotMatch(noAnswer.body, /• Call:/);
    assert.match(noAnswer.body, /• Comments: Visible mould in bathroom\./);
    assert.match(noAnswer.body, /• Survey date: 20\/09\/2026/);

    const busy = draftFromSubmission({
      ...shared,
      projectName: "Vico 2026",
      clientCallReference: "",
      callOutcome: "Attempted",
      callNotes: "Engaged/busy — Line stayed busy",
    });
    assert.doesNotMatch(busy.body, /Why the call reference is blank/);
    assert.doesNotMatch(busy.body, /Engaged\/busy/);
    assert.doesNotMatch(busy.body, /call reference/i);

    const other = draftFromSubmission({
      ...shared,
      projectName: "Vico 2026",
      clientCallReference: "",
      callOutcome: "Attempted",
      callNotes: "Other — Voicemail full.",
    });
    assert.doesNotMatch(other.body, /Why the call reference is blank/);
    assert.doesNotMatch(other.body, /Voicemail full/);
    assert.doesNotMatch(other.body, /call reference/i);

    const mtvh = draftFromSubmission({
      ...shared,
      projectName: "MTVH Pilot 2026",
      clientCallReference: "CR-9",
      callOutcome: "Attempted",
      callNotes: "No answer",
    });
    assert.match(mtvh.body, /• Call reference: CR-9/);
    assert.doesNotMatch(mtvh.body, /Why the call reference is blank/);
    assert.doesNotMatch(mtvh.body, /• Call:/);
    assert.doesNotMatch(mtvh.body, /No answer/);
  });

  it("leaves a blank call reference out of Test Housing and any project that does not use one", () => {
    const shared = {
      fullAddress: "1 jenkins house",
      postcode: "B14 6ES",
      uprn: "98756",
      surveyDate: "2026-09-20",
      category: "Damp & Mould Growth",
      rating: "High",
      comment: "Visible mould in bathroom.",
      photoCount: 0,
    };
    const testHousing = draftFromSubmission({
      ...shared,
      projectName: "Test Housing",
      clientCallReference: "",
      callOutcome: "Attempted",
      callNotes: "No answer",
    });
    assert.equal(testHousing.subject, "Test Housing - HHSRS – 1 jenkins house, B14 6ES");
    assert.equal(
      testHousing.body,
      [
        "HHSRS notification",
        "",
        "• UPRN: 98756",
        "• Address: 1 jenkins house, B14 6ES",
        "• Survey date: 20/09/2026",
        "• Hazard category: Damp / Mould Growth",
        "• Comments: Visible mould in bathroom.",
        "• Hazard rating: High",
      ].join("\n")
    );
    assert.doesNotMatch(testHousing.body, /call reference/i);
    assert.doesNotMatch(testHousing.body, /No answer/);

    const strayRef = draftFromSubmission({
      ...shared,
      projectName: "Test Housing",
      clientCallReference: "CR-9",
      callOutcome: "Attempted",
      callNotes: "No answer",
    });
    assert.doesNotMatch(strayRef.body, /call reference/i);
    assert.doesNotMatch(strayRef.body, /CR-9/);
    assert.match(strayRef.body, /• Comments: Visible mould in bathroom\./);

    const pasted = prepareClientEmailBody(
      "Test Housing",
      [
        "HHSRS notification",
        "",
        "• UPRN: 98756",
        "• Address: 1 jenkins house, B14 6ES",
        "• Survey date: 20/09/2026",
        "• Hazard category: Damp / Mould Growth",
        "• Comments: Visible mould in bathroom.",
        "• Hazard rating: High",
        "• Why the call reference is blank: No answer",
        "• Client call reference: CR-9",
        "• Call reference: CR-9",
      ].join("\n")
    );
    assert.equal(pasted, testHousing.body);

    const vicoKept = prepareClientEmailBody(
      "Vico 2026",
      "Hi all,\n\n• Address: 1 High Street\n• Client call reference: CR-9\n• Why the call reference is blank: No answer"
    );
    assert.match(vicoKept, /• Client call reference: CR-9/);
    assert.doesNotMatch(vicoKept, /Why the call reference is blank/);
    assert.match(vicoKept, /• Address: 1 High Street/);

    const mtvhKept = prepareClientEmailBody(
      "MTVH Pilot 2026",
      "Hi all,\n\n• Address: 1 High Street\n• Client call reference: CR-9\n• Why the call reference is blank: No answer"
    );
    assert.match(mtvhKept, /• Client call reference: CR-9/);
    assert.doesNotMatch(mtvhKept, /Why the call reference is blank/);
    assert.match(mtvhKept, /• Address: 1 High Street/);
  });

  it("adds a suspected cause for MTVH and leaves a blank cause out of the email", () => {
    const shared = {
      projectName: "MTVH Pilot 2026",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100123",
      surveyDate: "2026-09-20",
      category: "Damp & Mould Growth",
      rating: "High - Emergency Risk",
      comment: "Damp to the bedroom ceiling.",
      photoCount: 0,
    };
    const filled = draftFromSubmission({
      ...shared,
      suspectedCause: "Leaking gutter above the bedroom",
      includeCause: true,
    });
    assert.equal(
      filled.body.split("\n").find((line) => line.startsWith("• Cause:")),
      "• Cause: leaking gutter above the bedroom"
    );
    const keptWording = prepareClientEmailBody(
      "MTVH Pilot 2026",
      filled.body + "\n• Cause:\n• Cause:   "
    );
    assert.equal(
      keptWording.split("\n").find((line) => line.startsWith("• Cause:")),
      "• Cause: leaking gutter above the bedroom"
    );
    assert.equal(keptWording.split("\n").filter((line) => /^• Cause:/.test(line)).length, 1);
    const blank = draftFromSubmission({ ...shared, suspectedCause: "   ", includeCause: true });
    assert.doesNotMatch(blank.body, /Cause:/);
    assert.doesNotMatch(blank.body, /Suspected cause/i);
    const omitted = draftFromSubmission({
      ...shared,
      suspectedCause: "Leaking gutter above the bedroom",
      includeCause: false,
    });
    assert.doesNotMatch(omitted.body, /Cause:/);
    assert.doesNotMatch(omitted.body, /gutter/);
  });

  it("adds stored case-detail answers to the client email only when that case has them", () => {
    const shared = {
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100123",
      surveyDate: "2026-09-20",
      rating: "High - Significant risk",
      comment: "Missing window restrictors in the hall.",
      photoCount: 0,
    };
    const mtvh = draftFromSubmission({
      ...shared,
      projectName: "MTVH Pilot 2026",
      category: "Falling Between Levels",
      clientCallReference: "CR-9",
      callOutcome: "",
      callNotes: "",
      otherDetails: "Tenant was home.",
      restrictorMissingCount: "2",
      restrictorLocations: "Hall, Bedroom 1",
      restrictorMaterial: "PVC",
    });
    assert.match(mtvh.body, /• Address: 1 High Street, EX1 1AA/);
    assert.match(mtvh.body, /• UPRN: 100123/);
    assert.match(mtvh.body, /• Hazard rating: High - Significant risk/);
    assert.match(mtvh.body, /• Survey date: 20\/09\/2026/);
    assert.match(mtvh.body, /• Call reference: CR-9/);
    assert.match(mtvh.body, /• Any other details: Tenant was home\./);
    assert.match(mtvh.body, /• Number of window restrictors missing: 2/);
    assert.match(mtvh.body, /• Window material: PVC/);
    assert.match(mtvh.body, /• Locations: Hall, Bedroom 1/);
    assert.ok(mtvh.body.indexOf("• Survey date:") < mtvh.body.indexOf("• Call reference:"));
    assert.ok(mtvh.body.indexOf("• Call reference:") < mtvh.body.indexOf("• Any other details:"));
    assert.ok(
      mtvh.body.indexOf("• Any other details:") < mtvh.body.indexOf("• Number of window restrictors missing:")
    );
    assert.ok(mtvh.body.indexOf("• Window material:") < mtvh.body.indexOf("• Locations:"));
    assert.doesNotMatch(mtvh.body, /Why the call reference is blank/);
    assert.doesNotMatch(mtvh.body, /Internal notes/);
    assert.doesNotMatch(mtvh.body, /• Surveyor:/);

    const without = draftFromSubmission({
      ...shared,
      projectName: "MTVH Pilot 2026",
      category: "Falling Between Levels",
      clientCallReference: "",
      otherDetails: "   ",
      restrictorMissingCount: "",
      restrictorLocations: "",
      restrictorMaterial: "",
    });
    assert.doesNotMatch(without.body, /Call reference/);
    assert.doesNotMatch(without.body, /Any other details/);
    assert.doesNotMatch(without.body, /restrictors missing/i);
    assert.doesNotMatch(without.body, /• Locations?:/);
    assert.doesNotMatch(without.body, /Window material/);

    const countOnly = draftFromSubmission({
      ...shared,
      projectName: "MTVH Pilot 2026",
      category: "Falling Between Levels",
      restrictorMissingCount: "1",
    });
    assert.match(countOnly.body, /• Number of window restrictors missing: 1/);
    assert.doesNotMatch(countOnly.body, /• Locations?:/);
    assert.doesNotMatch(countOnly.body, /Window material/);

    const gateway = draftFromSubmission({
      ...shared,
      projectName: "Gateway 2026",
      category: "Falling Between Levels",
      clientCallReference: "CR-9",
      restrictorMissingCount: "2",
      restrictorLocations: "Hall",
      restrictorMaterial: "Timber",
      otherDetails: "No access issues.",
    });
    assert.doesNotMatch(gateway.body, /call reference/i);
    assert.doesNotMatch(gateway.body, /CR-9/);
    assert.doesNotMatch(gateway.body, /restrictors missing/i);
    assert.doesNotMatch(gateway.body, /Window material/);
    assert.doesNotMatch(gateway.body, /• Locations?:/);
    assert.match(gateway.body, /• Any other details: No access issues\./);
    assert.match(gateway.body, /• Comments:/);

    const vico = draftFromSubmission({
      ...shared,
      projectName: "Vico 2026",
      category: "Damp & Mould Growth",
      rating: "High",
      comment: "Visible mould in bathroom.",
      clientCallReference: "CR-9",
      suspectedCause: "Leaking gutter above the bedroom",
      includeCause: true,
      vulnerabilities: "Elderly resident",
      otherDetails: "Key safe on the left.",
      restrictorMissingCount: "4",
      restrictorLocations: "Hall",
      restrictorMaterial: "Metal",
    });
    assert.match(vico.body, /• Call reference: CR-9/);
    assert.match(vico.body, /• Cause: leaking gutter above the bedroom/);
    assert.match(vico.body, /• Vulnerabilities: Elderly resident/);
    assert.match(vico.body, /• Any other details: Key safe on the left\./);
    assert.match(vico.body, /• Comments: Visible mould in bathroom\./);
    assert.ok(vico.body.indexOf("• Call reference:") < vico.body.indexOf("• Cause:"));
    assert.ok(vico.body.indexOf("• Cause:") < vico.body.indexOf("• Vulnerabilities:"));
    assert.doesNotMatch(vico.body, /restrictors missing/i);
    assert.doesNotMatch(vico.body, /Window material/);
    assert.doesNotMatch(vico.body, /Why the call reference is blank/);

    const vicoNoCause = draftFromSubmission({
      ...shared,
      projectName: "Vico 2026",
      category: "Electrical Hazards",
      rating: "High",
      comment: "Damaged socket in kitchen.",
      clientCallReference: "",
      callOutcome: "Attempted",
      callNotes: "No answer",
      suspectedCause: "",
      vulnerabilities: "",
    });
    assert.doesNotMatch(vicoNoCause.body, /Cause:/);
    assert.doesNotMatch(vicoNoCause.body, /Vulnerabilities/);
    assert.doesNotMatch(vicoNoCause.body, /Why the call reference is blank/);
    assert.doesNotMatch(vicoNoCause.body, /No answer/);
    assert.doesNotMatch(vicoNoCause.body, /Any other details/);
  });

  it("uses stored restrictor and other-detail answers when Generate email does not repost them", () => {
    const row = {
      projectName: "MTVH Pilot 2026",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100123",
      surveyDate: "2026-09-20",
      category: "Falling Between Levels",
      rating: "High - Significant risk",
      comment: "Missing window restrictors in the hall.",
      clientDescription: "",
      clientCallReference: "CR-9",
      callOutcome: "",
      callNotes: "",
      workOrder: "",
      suspectedCause: "",
      includeCause: true,
      vulnerabilities: "",
      escalation: "",
      onwardTopic: "",
      cat1Confirmed: false,
      otherDetails: "Tenant was home.",
      restrictorMissingCount: "2",
      restrictorLocations: "Hall",
      restrictorMaterial: "PVC",
      photoPaths: [],
    };
    const fromRow = draftEmailFromReviewFields(
      mergeReviewDraftFields(row, {
        projectName: "MTVH Pilot 2026",
        address: "1 High Street, EX1 1AA",
        notes: "Missing window restrictors in the hall.",
        hazard: "Falling Between Levels",
        rating: "High - Significant risk",
        includeCause: true,
      })
    );
    assert.match(fromRow.body, /• Number of window restrictors missing: 2/);
    assert.match(fromRow.body, /• Locations: Hall/);
    assert.match(fromRow.body, /• Window material: PVC/);
    assert.match(fromRow.body, /• Any other details: Tenant was home\./);
    assert.match(fromRow.body, /• Call reference: CR-9/);

    const posted = draftEmailFromReviewFields(
      mergeReviewDraftFields(row, {
        projectName: "MTVH Pilot 2026",
        address: "1 High Street, EX1 1AA",
        notes: "Missing window restrictors in the hall.",
        hazard: "Falling Between Levels",
        rating: "High - Significant risk",
        includeCause: true,
        clientCallReference: "",
        otherDetails: "",
        restrictorMissingCount: "3",
        restrictorLocations: "Kitchen",
        restrictorMaterial: "Timber",
      })
    );
    assert.match(posted.body, /• Number of window restrictors missing: 3/);
    assert.match(posted.body, /• Locations: Kitchen/);
    assert.match(posted.body, /• Window material: Timber/);
    assert.doesNotMatch(posted.body, /Tenant was home/);
    assert.doesNotMatch(posted.body, /Call reference/);
    assert.doesNotMatch(posted.body, /CR-9/);
  });

  it("uses an office-edited client description verbatim when supplied", () => {
    const draft = draftFromSubmission({
      projectName: "Demo Housing",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100123",
      surveyDate: "2026-09-20",
      category: "Electrical Hazards",
      rating: "Medium",
      comment: "ignored once client description is set",
      clientDescription: "There is an exposed wire on the hallway ceiling.",
      photoCount: 2,
    });
    assert.match(draft.body, /• Comments: There is an exposed wire on the hallway ceiling\./);
    assert.match(draft.body, /• Hazard rating: Medium/);
    assert.doesNotMatch(draft.body, /Attached are photos/);
    assert.doesNotMatch(draft.body, /on the HHSRS/);
  });
});

describe("HHSRS Reporter helpers", () => {
  it("labels statuses for the queue", () => {
    assert.equal(statusLabel("new"), "New");
    assert.equal(statusLabel("email_sent"), "Email sent");
  });

  it("surfaces draft errors without throwing", () => {
    const result = tryDraftFromRow({
      projectName: "",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "1",
      surveyDate: "2026-09-20",
      category: "Electrical Hazards",
      rating: "High",
      comment: "damaged socket in kitchen",
      clientDescription: "",
      clientCallReference: "",
      callOutcome: "",
      callNotes: "",
      workOrder: "",
      suspectedCause: "",
      includeCause: true,
      vulnerabilities: "",
      escalation: "",
      onwardTopic: "",
      cat1Confirmed: false,
      photoPaths: [],
    });
    assert.equal(result.subject, "");
    assert.match(result.error, /template/i);
  });
});

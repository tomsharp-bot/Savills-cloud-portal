import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clientDescription,
  DraftError,
  draftFromSubmission,
  formatAddress,
  projectDraft,
  templateId,
} from "./hhsrs-reporter-draft.js";
import { statusLabel, tryDraftFromRow } from "./hhsrs-reporter.js";

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
        "Hi all,",
        "",
        "One of our surveyors has visited 1 high street, EX1 1AA.",
        "The light fitting in the lounge is damaged. We have recorded this as High for Electrical Hazards on the HHSRS.",
      ].join("\n")
    );
  });

  it("keeps BPHA intro without photo wording even when photos are present", () => {
    const draft = projectDraft({ ...base, project: "BPHA East 2026" }, ["a"]);
    assert.equal(draft.subject, "BPHA - HHSRS – 1 high street, EX1 1AA");
    assert.match(draft.body, /One of our surveyors has visited 1 high street, EX1 1AA\./);
    assert.doesNotMatch(draft.body, /Attached is a photo/);
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
    assert.match(draft.body, /Onward Call Reference: CR-99/);
    assert.match(draft.body, /Survey date: 2026-09-20/);
  });
});

describe("HHSRS Reporter draftFromSubmission", () => {
  it("maps site-form fields into a Standard draft", () => {
    const draft = draftFromSubmission({
      projectName: "Demo Housing",
      fullAddress: "1 High Street",
      postcode: "EX1 1AA",
      uprn: "100123",
      surveyDate: "2026-09-20",
      category: "Electrical Hazards",
      rating: "High",
      comment: "damaged light fitting in lounge",
      photoCount: 0,
    });
    assert.equal(draft.subject, "Demo Housing - HHSRS – 1 High Street, EX1 1AA");
    assert.match(draft.body, /The light fitting in the lounge is damaged\./);
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
    assert.match(draft.body, /Attached are photos taken from 1 High Street, EX1 1AA\./);
    assert.match(draft.body, /There is an exposed wire on the hallway ceiling\. We have recorded this as Medium/);
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

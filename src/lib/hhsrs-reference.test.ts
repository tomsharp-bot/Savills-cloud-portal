import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma.js";
import { buildThanksSummary } from "./hhsrs-site-form.js";
import {
  CORRECTION_REASONS,
  MISSING_EMAIL_BODY,
  correctionOfNote,
  correctionSubject,
  findCaseWhere,
  findStatusLabel,
  formatLondonDateTime,
  londonDayBounds,
  mainLogCardRows,
  validateCorrection,
} from "./hhsrs-find.js";
import {
  createSubmissionWithReference,
  formatHhsrsReference,
  hhsrsCodeForSave,
  hhsrsCodeFromProjectName,
} from "./hhsrs-reference.js";
import { sendCaseEmail } from "./hhsrs-send-case.js";
import type { OutboundEmail } from "./hhsrs-send.js";
import { composeEmailText } from "./hhsrs-signature.js";

describe("HHSRS project codes", () => {
  it("uses the named client codes, then the first four letters", () => {
    assert.equal(hhsrsCodeFromProjectName("MTVH Pilot 2026"), "MTVH");
    assert.equal(hhsrsCodeFromProjectName("MTVH Phase 1 2026"), "MTVH");
    assert.equal(hhsrsCodeFromProjectName("Metropolitan Thames Valley"), "MTVH");
    assert.equal(hhsrsCodeFromProjectName("A2D 2026 Phase 4"), "A2D");
    assert.equal(hhsrsCodeFromProjectName("A2 Dominion"), "A2D");
    assert.equal(hhsrsCodeFromProjectName("Cornwall 2026 Ph2"), "CORN");
    assert.equal(hhsrsCodeFromProjectName("Cornwall CC Ph1"), "CORN");
    assert.equal(hhsrsCodeFromProjectName("Onward 2026"), "ONW");
    assert.equal(hhsrsCodeFromProjectName("Vico 2026 8k"), "VICO");
    assert.equal(hhsrsCodeFromProjectName("BPHA 2026 ACQ"), "BPHA");
    assert.equal(hhsrsCodeFromProjectName("Saxon Weald 2026 Phase 4"), "SAXW");
    assert.equal(hhsrsCodeFromProjectName("LFHA"), "LFHA");
    assert.equal(hhsrsCodeFromProjectName("LFHA 2026"), "LFHA");
    assert.equal(hhsrsCodeFromProjectName("lfha phase 1"), "LFHA");
    assert.equal(hhsrsCodeFromProjectName("LFHA (Leeds)"), "LFHA");
    assert.equal(hhsrsCodeFromProjectName("Leeds Federation (Leeds)"), "LFHA");
    assert.equal(hhsrsCodeFromProjectName("Leeds Fed HA 2026"), "LFHA");
    assert.equal(hhsrsCodeFromProjectName("Leeds Federation"), "LFHA");
    assert.equal(hhsrsCodeFromProjectName("Leeds"), "LEED");
    assert.equal(hhsrsCodeFromProjectName("Onward (Leeds)"), "ONW");
    assert.equal(hhsrsCodeFromProjectName("Vico 2026"), "VICO");
    assert.equal(hhsrsCodeFromProjectName("MTVH 2026"), "MTVH");
    assert.equal(hhsrsCodeFromProjectName("BPHA ACQ 2026"), "BPHA");
    assert.equal(hhsrsCodeFromProjectName("A2Dominion 2026 - Ph4"), "A2D");
    assert.equal(hhsrsCodeFromProjectName("Cornwall CC 2026"), "CORN");
    assert.equal(hhsrsCodeFromProjectName("North LHFA stock"), "NORT");
    assert.equal(hhsrsCodeFromProjectName("Test Housing"), "TEST");
    assert.equal(hhsrsCodeFromProjectName("Test 1"), "TEST");
    assert.equal(hhsrsCodeFromProjectName("Gateway 2026"), "GATE");
    assert.equal(hhsrsCodeFromProjectName("   "), "HHSR");
    assert.equal(formatHhsrsReference("MTVH", 14), "MTVH-014");
    assert.equal(formatHhsrsReference("bpha", 1), "BPHA-001");
    assert.equal(formatHhsrsReference("lfha", 1), "LFHA-001");
  });

  it("keeps a typed code, and follows the name when the box still has the old one", () => {
    assert.equal(hhsrsCodeForSave({ name: "LFHA 2026", submitted: "" }), "LFHA");
    assert.equal(hhsrsCodeForSave({ name: "Leeds Federation (Leeds)", submitted: "" }), "LFHA");
    assert.equal(hhsrsCodeForSave({ name: "Leeds Fed HA 2026", submitted: "" }), "LFHA");
    assert.equal(hhsrsCodeForSave({ name: "LFHA 2026", submitted: "custom" }), "CUSTOM");
    assert.equal(
      hhsrsCodeForSave({
        name: "LFHA 2026",
        submitted: "DEVO",
        previousName: "Devon HA",
        previousCode: "DEVO",
      }),
      "LFHA"
    );
    assert.equal(
      hhsrsCodeForSave({
        name: "LFHA 2026",
        submitted: "MINE",
        previousName: "Devon HA",
        previousCode: "MINE",
      }),
      "MINE"
    );
  });
});

describe("HHSRS correction checks", () => {
  it("requires a reason, a note for Other, and a To address", () => {
    assert.equal(validateCorrection({ reason: "", note: "", to: "a@b.co" }).ok, false);
    assert.equal(validateCorrection({ reason: "Not a reason", note: "", to: "a@b.co" }).ok, false);
    const other = validateCorrection({ reason: "Other", note: "  ", to: "a@b.co" });
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.error, "Add a short note.");
    const emptyTo = validateCorrection({ reason: "Wrong address", note: "", to: " " });
    assert.equal(emptyTo.ok, false);
    if (!emptyTo.ok) assert.equal(emptyTo.error, "Add a To address.");
    const ok = validateCorrection({ reason: "Missing photo", note: "", to: "repairs@example.com" });
    assert.equal(ok.ok, true);
    assert.deepEqual(CORRECTION_REASONS, [
      "Wrong address",
      "Wrong details",
      "Wrong recipient",
      "Missing photo",
      "Other",
    ]);
  });

  it("prefixes CORRECTION once", () => {
    assert.equal(correctionSubject("HHSRS hazard – Falls on Stairs"), "CORRECTION: HHSRS hazard – Falls on Stairs");
    assert.equal(
      correctionSubject("CORRECTION: HHSRS hazard – Falls on Stairs"),
      "CORRECTION: HHSRS hazard – Falls on Stairs"
    );
    assert.equal(correctionSubject("CORRECTION: CORRECTION: Hello"), "CORRECTION: Hello");
  });

  it("maps case statuses and keeps the original log line", () => {
    assert.equal(findStatusLabel("new"), "Waiting");
    assert.equal(findStatusLabel("in_review"), "In review");
    assert.equal(findStatusLabel("email_ready"), "In review");
    assert.equal(findStatusLabel("email_sent"), "Sent");
    assert.equal(findStatusLabel("closed"), "Sent");
    assert.equal(findStatusLabel("corrected"), "Corrected");
    assert.equal(findStatusLabel("not_needed"), "Not needed");

    const originalAt = new Date("2026-09-24T13:32:00.000Z");
    const rows = mainLogCardRows([
      {
        id: "orig",
        sentAt: originalAt,
        sentBy: "Carly Farrell",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "client@example.com",
        cc: "",
        bcc: "",
        subject: "HHSRS hazard",
        body: "Original body",
        photoNames: ["a.jpg"],
        kind: "original",
        correctionReason: "",
        correctionNote: "",
        correctsEmailId: null,
      },
      {
        id: "fix",
        sentAt: new Date("2026-09-28T09:02:00.000Z"),
        sentBy: "Tom Sharp",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "repairs@example.com",
        cc: "",
        bcc: "",
        subject: "CORRECTION: HHSRS hazard",
        body: "Corrected body",
        photoNames: ["a.jpg"],
        kind: "correction",
        correctionReason: "Wrong recipient",
        correctionNote: "Should go to the repairs team",
        correctsEmailId: "orig",
      },
    ]);
    assert.equal(rows[0].type, "Original");
    assert.equal(rows[0].reason, "");
    assert.equal(rows[0].note, "");
    assert.equal(rows[0].subject, "HHSRS hazard");
    assert.equal(rows[1].type, "Correction");
    assert.equal(rows[1].reason, "Wrong recipient – Should go to the repairs team");
    assert.equal(rows[1].note, correctionOfNote(originalAt));
    assert.equal(rows[1].originalId, "orig");
    assert.match(rows[1].note, /Correction of email sent \d{2}\/\d{2}\/\d{4}/);
  });
});

describe("HHSRS find search", () => {
  it("filters by reference, UPRN or address, and a London day", () => {
    const summer = londonDayBounds("2026-09-28");
    assert.ok(summer);
    assert.equal(summer.gte.toISOString(), "2026-09-27T23:00:00.000Z");
    assert.equal(summer.lt.toISOString(), "2026-09-28T23:00:00.000Z");
    const winter = londonDayBounds("2026-01-15");
    assert.ok(winter);
    assert.equal(winter.gte.toISOString(), "2026-01-15T00:00:00.000Z");
    assert.equal(londonDayBounds("not-a-date"), null);
    assert.equal(formatLondonDateTime(new Date("2026-09-24T13:32:00.000Z")), "24/09/2026 14:32");

    assert.deepEqual(findCaseWhere("", ""), {});
    const both = findCaseWhere("Moor", "2026-09-28");
    assert.ok(both.AND && Array.isArray(both.AND));
    const text = JSON.stringify(both);
    assert.match(text, /reference/);
    assert.match(text, /uprn/);
    assert.match(text, /fullAddress/);
    assert.match(text, /Moor/);
  });
});

describe("HHSRS thanks summary", () => {
  it("shows only the submitted issue, with the survey date in UK form", () => {
    const summary = buildThanksSummary(
      {
        reference: "MTVH-014",
        projectName: "MTVH Pilot 2026",
        fullAddress: "Flat 3, 12 Moor Cross, Bude",
        postcode: "EX23 8AB",
        uprn: "10010120",
        surveyorName: "Jane Example",
        surveyDate: "2026-09-28",
        category: "Damp & Mould Growth",
        rating: "Category 1",
        comment: "Black mould on the ceiling.",
        otherDetails: "",
        clientCallReference: "CALL-9",
        callOutcome: "Completed",
        callNotes: "",
        photoPaths: ["hhsrs-site-form/abc/photo-1.jpg"],
      },
      (name) => `/photo/${name}`
    );
    assert.equal(summary.reference, "MTVH-014");
    assert.equal(summary.rows.find((row) => row.label === "Survey date")?.value, "28/09/2026");
    assert.equal(summary.rows.find((row) => row.label === "Address")?.value, "Flat 3, 12 Moor Cross, Bude, EX23 8AB");
    assert.equal(summary.details, "Black mould on the ceiling.");
    assert.equal(summary.photos[0].label, "Photo 1");
    assert.equal(summary.photos[0].url, "/photo/photo-1.jpg");
    assert.equal(summary.notes.some((note) => note.label === "Call reference"), true);
    assert.equal(summary.notes.some((note) => note.label === "Suspected cause"), false);
    const withCause = buildThanksSummary(
      {
        reference: "MTVH-014",
        projectName: "MTVH Pilot 2026",
        fullAddress: "Flat 3, 12 Moor Cross, Bude",
        postcode: "EX23 8AB",
        uprn: "10010120",
        surveyorName: "Jane Example",
        surveyDate: "2026-09-28",
        category: "Damp & Mould Growth",
        rating: "Category 1",
        comment: "Black mould on the ceiling.",
        suspectedCause: "Leaking gutter above the bedroom",
        photoPaths: [],
      },
      (name) => `/photo/${name}`
    );
    assert.equal(withCause.notes.find((note) => note.label === "Suspected cause")?.value, "Leaking gutter above the bedroom");

    const thanks = readFileSync("views/hhsrs-site-form/thanks.ejs", "utf8");
    const find = readFileSync("views/hhsrs-reporter/find.ejs", "utf8");
    assert.match(thanks, /Your reference/);
    assert.match(thanks, /What you sent/);
    assert.match(thanks, /Report another issue/);
    assert.match(thanks, /Tip: take a screenshot to keep a copy/);
    assert.match(
      thanks,
      /For any amendments please email <a href="mailto:HHSRS@savillshousing\.co\.uk">HHSRS@savillshousing\.co\.uk<\/a>\./
    );
    assert.doesNotMatch(thanks, /Need to change something\?/);
    assert.doesNotMatch(thanks, /Send the office your reference/);
    assert.doesNotMatch(thanks, /MOCK|Mock only|example data only|Preview/i);
    assert.match(find, /id="find-project"/);
    assert.match(find, /The project list is the same one the site form uses/);
    assert.match(find, /Amend &amp; resend/);
    assert.match(find, /Check Before Sending/);
    assert.match(find, /Reason for correction/);
    assert.match(find, /id="rv-signature-preview"/);
    assert.doesNotMatch(find, /Goes through the same checks|Mock only|MOCK/);
    assert.equal(MISSING_EMAIL_BODY, "Full text not stored for this email");
  });
});

async function dbReady(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function submissionData(projectId: string, projectName: string, reference: string, marker: string) {
  return {
    projectId,
    projectName,
    reference,
    surveyDate: "2026-09-28",
    uprn: marker,
    fullAddress: `12 ${marker} Moor Cross`,
    postcode: "EX23 8AB",
    surveyorName: "Jane Example",
    category: "Falls on Stairs",
    rating: "Category 1",
    comment: marker,
    photoPaths: [],
    status: "email_sent",
  };
}

describe("HHSRS reference allocation", () => {
  it("gives each project its own sequence and stays unique under concurrency", async (t) => {
    if (!(await dbReady())) {
      t.skip("Postgres is not available");
      return;
    }
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const mtvh = await prisma.project.create({
      data: { name: `MTVH alloc ${stamp}`, projectManager: "Test", hhsrsCode: "MTVH" },
    });
    const bpha = await prisma.project.create({
      data: { name: `BPHA alloc ${stamp}`, projectManager: "Test", hhsrsCode: "BPHA" },
    });
    const createdIds: string[] = [];
    t.after(async () => {
      await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: createdIds } } });
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: { in: [mtvh.id, bpha.id] } } });
      await prisma.project.deleteMany({ where: { id: { in: [mtvh.id, bpha.id] } } });
    });

    const make = (projectId: string, projectName: string, n: number) =>
      createSubmissionWithReference({ projectId, projectName }, (tx, reference) =>
        tx.hhsrsSiteSubmission.create({
          data: submissionData(projectId, projectName, reference, `${stamp}-${projectName}-${n}`),
        })
      );

    const [firstWave, bphaOne] = await Promise.all([
      Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((n) => make(mtvh.id, mtvh.name, n))),
      make(bpha.id, bpha.name, 0),
    ]);
    const secondWave = await Promise.all([8, 9].map((n) => make(mtvh.id, mtvh.name, n)));
    const rows = [...firstWave, ...secondWave, bphaOne];
    createdIds.push(...rows.map((row) => row.id));

    const mtvhRefs = rows
      .filter((row) => row.projectId === mtvh.id)
      .map((row) => row.reference || "")
      .sort();
    assert.deepEqual(
      mtvhRefs,
      ["MTVH-001", "MTVH-002", "MTVH-003", "MTVH-004", "MTVH-005", "MTVH-006", "MTVH-007", "MTVH-008", "MTVH-009", "MTVH-010"]
    );
    assert.equal(bphaOne.reference, "BPHA-001");
    assert.equal(new Set(rows.map((row) => row.reference)).size, rows.length);

    const counter = await prisma.hhsrsReferenceCounter.findUnique({ where: { key: mtvh.id } });
    assert.equal(counter?.nextNumber, 11);
  });
});

describe("HHSRS find search and resend", () => {
  it("searches live rows and resends without touching the original", async (t) => {
    if (!(await dbReady())) {
      t.skip("Postgres is not available");
      return;
    }
    const stampN = Date.now();
    const stamp = `find-${stampN}`;
    const refHit = `Q${String(stampN).slice(-5)}-001`;
    const refOther = `Q${String(stampN).slice(-5)}-002`;
    const project = await prisma.project.create({
      data: { name: `Find ${stamp}`, projectManager: "Test", hhsrsCode: "FIND" },
    });
    const hit = await prisma.hhsrsSiteSubmission.create({
      data: {
        ...submissionData(project.id, project.name, refHit, `${stamp}-hit`),
        fullAddress: "Flat 3, 12 Moor Cross, Bude",
        uprn: "10010120",
        emailSentAt: new Date("2026-09-24T13:32:00.000Z"),
        emailSentBy: "Carly Farrell",
        emailSubject: "HHSRS hazard – Falls on Stairs",
        emailBody: "Original body stays",
        createdAt: new Date("2026-09-24T09:00:00.000Z"),
      },
    });
    const other = await prisma.hhsrsSiteSubmission.create({
      data: {
        ...submissionData(project.id, project.name, refOther, `${stamp}-other`),
        fullAddress: "4 Castle Lane, Bedford",
        uprn: "10027506",
        status: "new",
        createdAt: new Date("2026-09-28T09:00:00.000Z"),
      },
    });
    const original = await prisma.hhsrsSentEmail.create({
      data: {
        submissionId: hit.id,
        sentAt: new Date("2026-09-24T13:32:00.000Z"),
        sentBy: "Carly Farrell",
        from: "Savills HHSRS <hhsrs@savillshousing.co.uk>",
        to: "client@savillshousing.co.uk",
        cc: "housing@savillshousing.co.uk",
        subject: "HHSRS hazard – Falls on Stairs",
        body: "Original body stays",
        photoNames: [],
        kind: "original",
      },
    });
    t.after(async () => {
      await prisma.hhsrsSentEmail.deleteMany({ where: { submissionId: { in: [hit.id, other.id] } } });
      await prisma.hhsrsSiteSubmission.deleteMany({ where: { id: { in: [hit.id, other.id] } } });
      await prisma.hhsrsReferenceCounter.deleteMany({ where: { key: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    });

    const byAddress = await prisma.hhsrsSiteSubmission.findMany({
      where: { AND: [findCaseWhere("Moor", ""), { id: { in: [hit.id, other.id] } }] },
    });
    assert.deepEqual(byAddress.map((row) => row.id), [hit.id]);

    const byRef = await prisma.hhsrsSiteSubmission.findMany({
      where: { AND: [findCaseWhere(refOther, ""), { id: { in: [hit.id, other.id] } }] },
    });
    assert.deepEqual(byRef.map((row) => row.reference), [refOther]);

    const byDate = await prisma.hhsrsSiteSubmission.findMany({
      where: { AND: [findCaseWhere("", "2026-09-28"), { id: { in: [hit.id, other.id] } }] },
    });
    assert.deepEqual(byDate.map((row) => row.id), [other.id]);

    const previousPassword = process.env.HHSRS_SMTP_PASSWORD;
    const previousAllow = process.env.HHSRS_SEND_ALLOW_DOMAINS;
    process.env.HHSRS_SMTP_PASSWORD = "test-only-not-a-real-password";
    process.env.HHSRS_SEND_ALLOW_DOMAINS = "*";
    const sent: OutboundEmail[] = [];
    const transport = {
      sendMail: async (mail: OutboundEmail) => {
        sent.push(mail);
        return { messageId: "<correction-test@savillshousing.co.uk>", raw: Buffer.from("raw-correction") };
      },
      appendToSent: async () => undefined,
    };
    try {
      const blocked = await sendCaseEmail({
        row: hit,
        sentBy: "Tom Sharp",
        hasReporterAccess: true,
        body: { to: "repairs@savillshousing.co.uk", subject: "HHSRS hazard", body: "Changed", checked: "1" },
        correction: { reason: "", note: "" },
        transport,
      });
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.error, "Pick a reason.");
      assert.equal(sent.length, 0);

      const otherNote = await sendCaseEmail({
        row: hit,
        sentBy: "Tom Sharp",
        hasReporterAccess: true,
        body: { to: "repairs@savillshousing.co.uk", subject: "HHSRS hazard", body: "Changed", checked: "1" },
        correction: { reason: "Other", note: "" },
        transport,
      });
      assert.equal(otherNote.ok, false);
      assert.equal(sent.length, 0);

      const sentOk = await sendCaseEmail({
        row: hit,
        sentBy: "Tom Sharp",
        senderFirstName: "Tom",
        senderFullName: "Tom Sharp",
        hasReporterAccess: true,
        body: {
          to: "repairs@savillshousing.co.uk",
          cc: "",
          subject: "CORRECTION: HHSRS hazard – Falls on Stairs",
          body: "Please use the repairs team.",
          checked: "1",
        },
        correction: { reason: "Wrong recipient", note: "Should go to the repairs team" },
        transport,
      });
      assert.equal(sentOk.ok, true);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].fromAddress, "hhsrs@savillshousing.co.uk");
      assert.deepEqual(sent[0].to, ["repairs@savillshousing.co.uk"]);
      assert.equal(sent[0].subject, "CORRECTION: HHSRS hazard – Falls on Stairs");
      const correctionBody = [
        "Please disregard our previous email. This corrects the recipient, which is now repairs@savillshousing.co.uk.",
        "",
        "Please use the repairs team.",
      ].join("\n");
      assert.equal(
        sent[0].text,
        composeEmailText(correctionBody, { firstName: "Tom", fullName: "Tom Sharp" })
      );
      assert.match(sent[0].html, /<b>repairs@savillshousing\.co\.uk<\/b>/);
      assert.doesNotMatch(sent[0].text, /Wrong recipient|was wrong/i);
      assert.doesNotMatch(sent[0].text, /Should go to the repairs team/);
      assert.match(sent[0].html, /HHSRS Reporting Team/);
      assert.doesNotMatch(sent[0].html, />Tom Sharp</);

      const again = await prisma.hhsrsSentEmail.findMany({
        where: { submissionId: hit.id },
        orderBy: { sentAt: "asc" },
      });
      assert.equal(again.length, 2);
      assert.equal(again[0].id, original.id);
      assert.equal(again[0].body, "Original body stays");
      assert.equal(again[0].to, "client@savillshousing.co.uk");
      assert.equal(again[0].subject, "HHSRS hazard – Falls on Stairs");
      assert.equal(again[0].kind, "original");
      assert.equal(again[1].kind, "correction");
      assert.equal(again[1].correctsEmailId, original.id);
      assert.equal(again[1].correctionReason, "Wrong recipient");
      assert.equal(again[1].correctionNote, "Should go to the repairs team");
      assert.equal(again[1].body, correctionBody);

      const fresh = await prisma.hhsrsSiteSubmission.findUniqueOrThrow({ where: { id: hit.id } });
      assert.equal(fresh.status, "corrected");
      assert.equal(fresh.emailSubject, "HHSRS hazard – Falls on Stairs");
      assert.equal(fresh.emailBody, "Original body stays");
      assert.equal(fresh.emailSentBy, "Carly Farrell");
      assert.equal(fresh.emailSentAt?.toISOString(), "2026-09-24T13:32:00.000Z");
    } finally {
      if (previousPassword === undefined) delete process.env.HHSRS_SMTP_PASSWORD;
      else process.env.HHSRS_SMTP_PASSWORD = previousPassword;
      if (previousAllow === undefined) delete process.env.HHSRS_SEND_ALLOW_DOMAINS;
      else process.env.HHSRS_SEND_ALLOW_DOMAINS = previousAllow;
    }
  });
});

import type { HhsrsSiteSubmission } from "@prisma/client";
import { draftFromSubmission, type SubmissionDraftInput } from "./hhsrs-reporter-draft.js";

export const HHSRS_REPORTER_PATH = "/HHSRSreporter";
export const HHSRS_REPORTER_ALIAS = "/HHSRSreporting";

export const HHSRS_CASE_STATUSES = [
  "new",
  "in_review",
  "email_ready",
  "email_sent",
  "closed",
] as const;

export type HhsrsCaseStatus = (typeof HHSRS_CASE_STATUSES)[number];

export const HHSRS_CALL_OUTCOMES = [
  "",
  "Completed",
  "Attempted",
  "Not yet called",
  "Not required",
] as const;

export function isHhsrsCaseStatus(value: string): value is HhsrsCaseStatus {
  return (HHSRS_CASE_STATUSES as readonly string[]).includes(value);
}

export function statusLabel(status: string): string {
  switch (status) {
    case "new":
      return "New";
    case "in_review":
      return "In review";
    case "email_ready":
      return "Email ready";
    case "email_sent":
      return "Email sent";
    case "closed":
      return "Closed";
    default:
      return status || "New";
  }
}

export function photoNames(row: Pick<HhsrsSiteSubmission, "photoPaths">): string[] {
  return Array.isArray(row.photoPaths) ? row.photoPaths.map(String) : [];
}

export function submissionDraftInput(
  row: Pick<
    HhsrsSiteSubmission,
    | "projectName"
    | "fullAddress"
    | "postcode"
    | "uprn"
    | "surveyDate"
    | "category"
    | "rating"
    | "comment"
    | "clientDescription"
    | "clientCallReference"
    | "callOutcome"
    | "workOrder"
    | "suspectedCause"
    | "includeCause"
    | "vulnerabilities"
    | "escalation"
    | "onwardTopic"
    | "cat1Confirmed"
    | "photoPaths"
  >
): SubmissionDraftInput {
  return {
    projectName: row.projectName,
    fullAddress: row.fullAddress,
    postcode: row.postcode,
    uprn: row.uprn,
    surveyDate: row.surveyDate,
    category: row.category,
    rating: row.rating,
    comment: row.comment,
    clientDescription: row.clientDescription,
    clientCallReference: row.clientCallReference,
    callOutcome: row.callOutcome,
    workOrder: row.workOrder,
    suspectedCause: row.suspectedCause,
    includeCause: row.includeCause,
    vulnerabilities: row.vulnerabilities,
    escalation: row.escalation,
    onwardTopic: row.onwardTopic,
    cat1Confirmed: row.cat1Confirmed,
    photoCount: photoNames(row).length,
  };
}

export function tryDraftFromRow(row: Parameters<typeof submissionDraftInput>[0]): {
  subject: string;
  body: string;
  error: string;
} {
  try {
    const draft = draftFromSubmission(submissionDraftInput(row));
    return { ...draft, error: "" };
  } catch (err) {
    return {
      subject: "",
      body: "",
      error: err instanceof Error ? err.message : "Could not prepare the client email.",
    };
  }
}

export function readReporterUpdate(body: Record<string, unknown>): {
  rating: string;
  clientDescription: string;
  clientCallReference: string;
  callOutcome: string;
  workOrder: string;
  suspectedCause: string;
  includeCause: boolean;
  vulnerabilities: string;
  escalation: string;
  onwardTopic: string;
  cat1Confirmed: boolean;
  internalNotes: string;
  status: string;
  expectedUpdatedAt: string;
} {
  const field = (name: string) => String(body[name] ?? "").trim();
  return {
    rating: field("rating"),
    clientDescription: field("clientDescription"),
    clientCallReference: field("clientCallReference"),
    callOutcome: field("callOutcome"),
    workOrder: field("workOrder"),
    suspectedCause: field("suspectedCause"),
    includeCause: (() => {
      const raw = body.includeCause;
      if (Array.isArray(raw)) return raw.map(String).includes("true");
      return raw === "true" || raw === "1" || raw === "on";
    })(),
    vulnerabilities: field("vulnerabilities"),
    escalation: field("escalation"),
    onwardTopic: field("onwardTopic"),
    cat1Confirmed: body.cat1Confirmed === "1" || body.cat1Confirmed === "true" || body.cat1Confirmed === "on",
    internalNotes: field("internalNotes"),
    status: field("status") || "new",
    expectedUpdatedAt: field("expectedUpdatedAt"),
  };
}

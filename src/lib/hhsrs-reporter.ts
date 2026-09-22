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

/** Waiting queue = not yet actioned into the Main Log. */
export const HHSRS_WAITING_STATUSES = ["new", "in_review", "email_ready"] as const;

export const HHSRS_ACTIONED_STATUSES = ["email_sent", "closed"] as const;

export function isWaitingStatus(status: string): boolean {
  return (HHSRS_WAITING_STATUSES as readonly string[]).includes(status);
}

export function isActionedStatus(status: string): boolean {
  return (HHSRS_ACTIONED_STATUSES as readonly string[]).includes(status);
}

/** Relative time for Pending Issues (en-GB). Under ~48h stays visually urgent. */
export function formatTimeAgo(iso: Date | string, now: Date = new Date()): {
  relative: string;
  absolute: string;
  urgent: boolean;
} {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) {
    return { relative: "", absolute: String(iso || ""), urgent: false };
  }
  const diffMs = Math.max(0, now.getTime() - d.getTime());
  const mins = Math.floor(diffMs / 60000);
  let relative: string;
  if (mins < 1) relative = "just now";
  else if (mins < 60) relative = mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  else {
    const hours = Math.floor(mins / 60);
    if (hours < 48) relative = hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    else {
      const days = Math.floor(hours / 24);
      relative = days === 1 ? "1 day ago" : `${days} days ago`;
    }
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d.getDate();
  const mon = months[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const absolute = `${day} ${mon} ${year} · ${hh}:${mm}`;
  return { relative, absolute, urgent: diffMs < 48 * 60 * 60 * 1000 };
}

export function formatWorkspaceDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ratingDisplayClass(rating: string): string {
  const r = (rating || "").trim().toLowerCase();
  if (r === "cat 1" || r === "high" || r.startsWith("severe") || r.includes("emergency")) {
    return "rating-cat1";
  }
  if (r === "cat 2" || r === "medium" || r === "moderate") {
    return "rating-cat2";
  }
  return "";
}

export function actionedStatusLabel(status: string): string {
  if (status === "email_sent") return "Pack sent";
  if (status === "closed") return "Notice filed";
  if (status === "email_ready") return "Email ready";
  return statusLabel(status);
}

export type ReporterSummary = {
  waiting: number;
  inReview: number;
  actionedMonth: number;
  mainLog: number;
};

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

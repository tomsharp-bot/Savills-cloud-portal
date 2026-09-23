import type { HhsrsSiteSubmission } from "@prisma/client";
import { draftFromSubmission, type SubmissionDraftInput } from "./hhsrs-reporter-draft.js";
import { matchDemoProject } from "./hhsrs-reporter-projects.js";

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

/** How many surveyor photos are stored on a site-form row. Derived from photoPaths — no extra column. */
export function photoAttachmentCount(photoPaths: unknown): number {
  if (!Array.isArray(photoPaths)) return 0;
  return photoPaths.filter((item) => String(item || "").trim()).length;
}

export type ReporterCasePhoto = {
  id: string;
  name: string;
  caption: string;
  url: string;
};

/** Up to four surveyor photos for the Review Case strip. URLs hit the existing photo route. */
export function reporterCasePhotos(
  row: { id: string; photoPaths: unknown },
  reporterBase: string
): ReporterCasePhoto[] {
  const paths = Array.isArray(row.photoPaths) ? row.photoPaths.map((item) => String(item)) : [];
  return paths.slice(0, 4).map((stored, index) => {
    const name = stored.split("/").filter(Boolean).pop() || `photo-${index + 1}`;
    const caption = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") || `Photo ${index + 1}`;
    return {
      id: `surveyor-${index + 1}`,
      name,
      caption,
      url: `${reporterBase}/${encodeURIComponent(row.id)}/photos/${encodeURIComponent(name)}`,
    };
  });
}

export type ReviewDraftSource = {
  projectName: string;
  fullAddress: string;
  postcode: string;
  uprn: string;
  surveyDate: string;
  category: string;
  rating: string;
  comment: string;
  clientDescription: string;
  clientCallReference: string;
  callOutcome: string;
  callNotes?: string;
  workOrder: string;
  suspectedCause: string;
  includeCause: boolean;
  vulnerabilities: string;
  escalation: string;
  onwardTopic: string;
  cat1Confirmed: boolean;
  photoPaths: unknown;
};

export type ReviewDraftFields = SubmissionDraftInput;

function postedString(body: Record<string, unknown>, key: string): string {
  return String(body[key] ?? "").trim();
}

function postedFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === false || value === "false" || value === "0" || value === "off") return false;
  return value === true || value === "true" || value === "1" || value === "on";
}

function postedPhotoCount(body: Record<string, unknown>, fallback: number): number {
  if (body.photoCount === undefined || body.photoCount === null || body.photoCount === "") return fallback;
  const n = Number(body.photoCount);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(4, Math.floor(n));
}

/**
 * Turn the Review form into the existing submission draft input.
 * Unedited surveyor notes stay as the comment so the template rewrite still runs.
 * Edited notes are treated as the office client description.
 */
export function mergeReviewDraftFields(
  row: ReviewDraftSource | null,
  body: Record<string, unknown>
): ReviewDraftFields {
  const postedProject = postedString(body, "projectName");
  const postedAddress = postedString(body, "address");
  const postedNotes = postedString(body, "notes");
  const postedRating = postedString(body, "rating");

  if (!row) {
    return {
      projectName: postedProject,
      fullAddress: postedAddress,
      postcode: "",
      uprn: postedString(body, "uprn"),
      surveyDate: postedString(body, "surveyDate"),
      category: postedString(body, "hazard"),
      rating: postedRating,
      comment: postedNotes,
      clientDescription: "",
      clientCallReference: postedString(body, "clientCallReference"),
      callOutcome: postedString(body, "callOutcome"),
      callNotes: postedString(body, "callNotes"),
      workOrder: postedString(body, "workOrder"),
      suspectedCause: postedString(body, "suspectedCause"),
      includeCause: postedFlag(body.includeCause, true),
      vulnerabilities: postedString(body, "vulnerabilities"),
      escalation: postedString(body, "escalation"),
      onwardTopic: postedString(body, "onwardTopic"),
      cat1Confirmed: postedFlag(body.cat1Confirmed, false),
      photoCount: postedPhotoCount(body, 0),
    };
  }

  const matched = matchDemoProject(row.projectName);
  const projectUnchanged =
    !postedProject ||
    postedProject === row.projectName ||
    Boolean(matched && postedProject === matched.name);
  const shownAddress = row.postcode ? `${row.fullAddress}, ${row.postcode}` : row.fullAddress;
  const addressUnchanged = !postedAddress || postedAddress === shownAddress;
  const shownNotes = (row.clientDescription || row.comment).trim();
  const notesUnchanged = postedNotes === shownNotes;

  return {
    projectName: projectUnchanged ? row.projectName : postedProject,
    fullAddress: addressUnchanged ? row.fullAddress : postedAddress,
    postcode: addressUnchanged ? row.postcode : "",
    uprn: postedString(body, "uprn") || row.uprn,
    surveyDate: postedString(body, "surveyDate") || row.surveyDate,
    category: postedString(body, "hazard") || row.category,
    rating: postedRating || row.rating,
    comment: row.comment,
    clientDescription: notesUnchanged ? row.clientDescription : postedNotes,
    clientCallReference:
      body.clientCallReference === undefined ? row.clientCallReference : postedString(body, "clientCallReference"),
    callOutcome: body.callOutcome === undefined ? row.callOutcome : postedString(body, "callOutcome"),
    callNotes: body.callNotes === undefined ? row.callNotes || "" : postedString(body, "callNotes"),
    workOrder: body.workOrder === undefined ? row.workOrder : postedString(body, "workOrder"),
    suspectedCause: body.suspectedCause === undefined ? row.suspectedCause : postedString(body, "suspectedCause"),
    includeCause: postedFlag(body.includeCause, row.includeCause),
    vulnerabilities: body.vulnerabilities === undefined ? row.vulnerabilities : postedString(body, "vulnerabilities"),
    escalation: body.escalation === undefined ? row.escalation : postedString(body, "escalation"),
    onwardTopic: body.onwardTopic === undefined ? row.onwardTopic : postedString(body, "onwardTopic"),
    cat1Confirmed: postedFlag(body.cat1Confirmed, row.cat1Confirmed),
    photoCount: postedPhotoCount(body, photoAttachmentCount(row.photoPaths)),
  };
}

export function draftEmailFromReviewFields(fields: ReviewDraftFields): {
  to: string;
  cc: string;
  subject: string;
  body: string;
} {
  const matched = matchDemoProject(fields.projectName);
  const draft = draftFromSubmission(fields);
  return {
    to: matched ? matched.to.join("; ") : "",
    cc: matched ? matched.cc.join("; ") : "",
    subject: draft.subject,
    body: draft.body,
  };
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
    | "callNotes"
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
    callNotes: row.callNotes,
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
  callNotes: string;
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
    callNotes: field("callNotes"),
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

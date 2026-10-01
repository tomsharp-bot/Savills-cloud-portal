/**
 * The office's first check of a surveyor's case.
 * Dropping High (Emergency or Significant) to Medium or Low clears the
 * High-only extra details so they are not kept or emailed.
 * Raising Low or Medium to High asks for those details, and for a call
 * reference only when that project collects one.
 */
import { projectRequiresCallReference } from "./hhsrs-reporter-draft.js";
import { canonicalRestrictorLocations, siteFormShowsCallReference } from "./hhsrs-site-form.js";

export type SurveyorCheck = {
  rating: string;
  clientCallReference: string;
  callOutcome: string;
  callNotes: string;
  restrictorMissingCount: string;
  restrictorLocations: string;
  restrictorMaterial: string;
};

export type RestrictorFields = {
  restrictorMissingCount: string;
  restrictorLocations: string;
  restrictorMaterial: string;
};

export type OfficeFieldNeed = {
  key: "restrictorMissingCount" | "restrictorLocations" | "restrictorMaterial" | "clientCallReference";
  label: string;
  /** Red star. The surveyor had not already completed this, and this decision requires it. */
  star: boolean;
  filled: boolean;
};

const OFFICE_HIGH = new Set(["high - emergency risk", "high - significant risk"]);

export function isOfficeHighRating(rating: string): boolean {
  return OFFICE_HIGH.has(String(rating || "").trim().toLowerCase());
}

export function isOfficeMediumOrLow(rating: string): boolean {
  const text = String(rating || "").trim().toLowerCase();
  return text === "low" || text === "medium";
}

export function officeDroppedHighRating(fromRating: string, toRating: string): boolean {
  return isOfficeHighRating(fromRating) && isOfficeMediumOrLow(toRating);
}

export function officeRaisedToHigh(fromRating: string, toRating: string): boolean {
  return isOfficeMediumOrLow(fromRating) && isOfficeHighRating(toRating);
}

/** A project with a call-reference field. MTVH only when the rating is High - Emergency risk. */
export function projectCollectsCallReference(projectName: string, rating: string): boolean {
  if (projectRequiresCallReference(projectName)) return true;
  return siteFormShowsCallReference(projectName, rating);
}

export function readSurveyorCheck(stored: unknown): SurveyorCheck | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const row = stored as Record<string, unknown>;
  const rating = String(row.rating || "").trim();
  if (!rating) return null;
  return {
    rating,
    clientCallReference: String(row.clientCallReference || ""),
    callOutcome: String(row.callOutcome || ""),
    callNotes: String(row.callNotes || ""),
    restrictorMissingCount: String(row.restrictorMissingCount || ""),
    restrictorLocations: String(row.restrictorLocations || ""),
    restrictorMaterial: String(row.restrictorMaterial || ""),
  };
}

export function surveyorCheckFromRow(row: SurveyorCheck): SurveyorCheck {
  return {
    rating: String(row.rating || ""),
    clientCallReference: String(row.clientCallReference || ""),
    callOutcome: String(row.callOutcome || ""),
    callNotes: String(row.callNotes || ""),
    restrictorMissingCount: String(row.restrictorMissingCount || ""),
    restrictorLocations: String(row.restrictorLocations || ""),
    restrictorMaterial: String(row.restrictorMaterial || ""),
  };
}

/** The surveyor's answers. A stored snapshot wins; otherwise the case as it stands. */
export function baselineSurveyorCheck(stored: unknown, row: SurveyorCheck): SurveyorCheck {
  return readSurveyorCheck(stored) || surveyorCheckFromRow(row);
}

/** First office save, send, or dismiss keeps the surveyor's answers. Later edits do not replace them. */
export function surveyorCheckToStore(stored: unknown, row: SurveyorCheck): SurveyorCheck | null {
  if (readSurveyorCheck(stored)) return null;
  const snap = surveyorCheckFromRow(row);
  if (!snap.rating.trim()) return null;
  return snap;
}

export function emptyRestrictors(): RestrictorFields {
  return { restrictorMissingCount: "", restrictorLocations: "", restrictorMaterial: "" };
}

export function restrictorsAfterOfficeDecision(input: {
  baselineRating: string;
  nextRating: string;
  current: RestrictorFields;
  posted: Partial<RestrictorFields> | null;
}): RestrictorFields {
  if (officeDroppedHighRating(input.baselineRating, input.nextRating)) return emptyRestrictors();
  const posted = input.posted;
  return {
    restrictorMissingCount:
      posted && posted.restrictorMissingCount !== undefined
        ? String(posted.restrictorMissingCount).trim()
        : input.current.restrictorMissingCount,
    restrictorLocations:
      posted && posted.restrictorLocations !== undefined
        ? canonicalRestrictorLocations(posted.restrictorLocations)
        : input.current.restrictorLocations,
    restrictorMaterial:
      posted && posted.restrictorMaterial !== undefined
        ? String(posted.restrictorMaterial).trim()
        : input.current.restrictorMaterial,
  };
}

function surveyorCompletedCall(check: SurveyorCheck): boolean {
  return Boolean(
    check.clientCallReference.trim() || check.callOutcome.trim() || check.callNotes.trim()
  );
}

/**
 * Fields this rating decision makes the office complete.
 * A star is only for one the surveyor had not already completed.
 * A surveyor-completed field counts as filled even if the office has not retyped it.
 */
export function officeDecisionFields(input: {
  projectName: string;
  baseline: SurveyorCheck;
  nextRating: string;
  current: RestrictorFields & { clientCallReference: string };
}): OfficeFieldNeed[] {
  if (!officeRaisedToHigh(input.baseline.rating, input.nextRating)) return [];
  const needs: OfficeFieldNeed[] = [];
  const push = (
    key: OfficeFieldNeed["key"],
    label: string,
    surveyorValue: string,
    currentValue: string
  ) => {
    const star = !String(surveyorValue || "").trim();
    const filled = Boolean(String(currentValue || "").trim()) || !star;
    needs.push({ key, label, star, filled });
  };
  push(
    "restrictorMissingCount",
    "Number of window restrictors missing",
    input.baseline.restrictorMissingCount,
    input.current.restrictorMissingCount
  );
  push("restrictorMaterial", "Window material", input.baseline.restrictorMaterial, input.current.restrictorMaterial);
  push("restrictorLocations", "Locations", input.baseline.restrictorLocations, input.current.restrictorLocations);
  if (projectCollectsCallReference(input.projectName, input.nextRating)) {
    const star = !surveyorCompletedCall(input.baseline);
    const filled = Boolean(input.current.clientCallReference.trim()) || !star;
    needs.push({ key: "clientCallReference", label: "Call reference", star, filled });
  }
  return needs;
}

export function officeSendBlocked(needs: readonly OfficeFieldNeed[]): boolean {
  return needs.some((item) => item.star && !item.filled);
}

const HIGH_ONLY_LINE =
  /^•\s*(?:how many window restrictors are missing|number of window restrictors missing|window restrictors missing|window material|locations?)\s*:/i;

/** Drop those bullets and leave every other line in place. */
export function omitClearedHighExtras(body: string): string {
  return String(body || "")
    .split("\n")
    .filter((line) => !HIGH_ONLY_LINE.test(line.trim()))
    .join("\n");
}

export function dismissLogLine(viewedBy: string, decision: string): string {
  const who = String(viewedBy || "").trim() || "someone";
  const why = String(decision || "").trim();
  return `Viewed by ${who}. Decision: ${why} Dismissed. No email sent.`;
}

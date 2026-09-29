/**
 * Duplicates & errors compare. The case in the list is shown beside the case
 * it matches. When that match was already emailed, it stays described as in
 * the Main Log, and Amend and resend opens the existing find flow for that
 * sent email.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { formatLondonDate } from "./hhsrs-find.js";
import { isNotNeededReason, notNeededReasonLabel } from "./hhsrs-not-needed.js";
import { storedNamesForPortalProject } from "./hhsrs-portal-projects.js";
import { uprnMatchKey } from "./hhsrs-uprn-duplicates.js";

export type DuplicateCompareSide = {
  heading: string;
  address: string;
  uprn: string;
  hazard: string;
  rating: string;
  siteNotes: string;
  surveyDate: string;
};

export type DuplicateCompareDiff = {
  address: boolean;
  uprn: boolean;
  hazard: boolean;
  rating: boolean;
  siteNotes: boolean;
  surveyDate: boolean;
};

export type DuplicateCompareRow = {
  id: string;
  address: string;
  uprn: string;
  matches: string;
  whereFirst: string;
  canCompare: boolean;
  open: boolean;
  amendUrl: string;
  left: DuplicateCompareSide | null;
  right: DuplicateCompareSide | null;
  diff: DuplicateCompareDiff;
};

export type CompareCase = {
  id: string;
  reference: string | null;
  uprn: string;
  fullAddress: string;
  postcode: string;
  category: string;
  rating: string;
  comment: string;
  surveyDate: string;
  status: string;
  emailSentAt: Date | string | null;
  createdAt: Date | string;
  notNeededReason: string;
  notNeededDuplicateOf: string;
};

const EMPTY_DIFF: DuplicateCompareDiff = {
  address: false,
  uprn: false,
  hazard: false,
  rating: false,
  siteNotes: false,
  surveyDate: false,
};

function squash(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shown(value: string): string {
  return squash(value) || "—";
}

function addressFull(fullAddress: string, postcode: string): string {
  const line = squash(fullAddress);
  const code = squash(postcode);
  if (!code) return line;
  if (line.toUpperCase().includes(code.toUpperCase())) return line;
  return line ? `${line}, ${code}` : code;
}

function displaySurveyDate(value: string): string {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return squash(value);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

type FieldName = keyof DuplicateCompareDiff;

function fieldValue(row: CompareCase, field: FieldName): string {
  if (field === "address") return addressFull(row.fullAddress, row.postcode);
  if (field === "uprn") return squash(row.uprn);
  if (field === "hazard") return squash(row.category);
  if (field === "rating") return squash(row.rating);
  if (field === "siteNotes") return squash(row.comment);
  return displaySurveyDate(row.surveyDate);
}

function sameField(field: FieldName, left: string, right: string): boolean {
  if (field === "uprn") return uprnMatchKey(left) === uprnMatchKey(right);
  const a = squash(left);
  const b = squash(right);
  if (field === "hazard" || field === "rating") return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function caseLabel(reference: string | null | undefined): string {
  const ref = squash(reference || "");
  return ref ? `Case ${ref}` : "Case";
}

function sideOf(row: CompareCase, heading: string): DuplicateCompareSide {
  return {
    heading,
    address: shown(addressFull(row.fullAddress, row.postcode)),
    uprn: shown(row.uprn),
    hazard: shown(row.category),
    rating: shown(row.rating),
    siteNotes: shown(row.comment),
    surveyDate: shown(displaySurveyDate(row.surveyDate)),
  };
}

function whereFirst(match: CompareCase): string {
  const sentAt = asDate(match.emailSentAt);
  if (sentAt) return `Main Log, emailed ${formatLondonDate(sentAt)}`;
  if (match.status === "not_needed") return "Duplicates & errors";
  return "Pending";
}

/** One list row plus the two cards opened by View duplicate. */
export function toDuplicateCompareRow(
  row: CompareCase,
  match: CompareCase | null,
  opts: { open: boolean; reporterBase: string }
): DuplicateCompareRow {
  const address = shown(addressFull(row.fullAddress, row.postcode));
  const uprn = shown(row.uprn);
  const linkedRef = squash(match?.reference || row.notNeededDuplicateOf || "");
  const matches = linkedRef ? `Case ${linkedRef}` : notNeededReasonLabel(row.notNeededReason) || "—";
  if (!match) {
    return {
      id: row.id,
      address,
      uprn,
      matches,
      whereFirst: "—",
      canCompare: false,
      open: false,
      amendUrl: "",
      left: null,
      right: null,
      diff: { ...EMPTY_DIFF },
    };
  }

  const sentAt = asDate(match.emailSentAt);
  const fields: FieldName[] = ["address", "uprn", "hazard", "rating", "siteNotes", "surveyDate"];
  const diff = { ...EMPTY_DIFF };
  for (const field of fields) {
    diff[field] = !sameField(field, fieldValue(match, field), fieldValue(row, field));
  }
  const differs = fields.some((field) => diff[field]);
  const amendUrl =
    sentAt && differs ? `${opts.reporterBase}/find?case=${encodeURIComponent(match.id)}&view=amend` : "";

  return {
    id: row.id,
    address,
    uprn,
    matches,
    whereFirst: whereFirst(match),
    canCompare: true,
    open: opts.open,
    amendUrl,
    left: sideOf(match, sentAt ? `${caseLabel(match.reference)} · already sent` : caseLabel(match.reference)),
    right: sideOf(row, "Later case · not emailed"),
    diff,
  };
}

export async function loadDuplicateComparisons(
  filters: { q?: string; project?: string; reason?: string },
  reporterBase: string,
  openId = ""
): Promise<DuplicateCompareRow[]> {
  const and: Prisma.HhsrsSiteSubmissionWhereInput[] = [{ status: "not_needed" }];
  const q = String(filters.q || "").trim();
  if (q) {
    and.push({
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { uprn: { contains: q, mode: "insensitive" } },
        { fullAddress: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const project = String(filters.project || "").trim();
  if (project) {
    const names = await storedNamesForPortalProject(project);
    and.push({ projectName: { in: names.length ? names : [project] } });
  }
  const reason = String(filters.reason || "").trim();
  if (reason && isNotNeededReason(reason)) and.push({ notNeededReason: reason });

  const rows = await prisma.hhsrsSiteSubmission.findMany({
    where: { AND: and },
    orderBy: [{ notNeededAt: "desc" }, { createdAt: "desc" }],
  });
  const refs = [...new Set(rows.map((row) => squash(row.notNeededDuplicateOf)).filter(Boolean))];
  const linked = refs.length
    ? await prisma.hhsrsSiteSubmission.findMany({
        where: { reference: { in: refs, mode: "insensitive" } },
      })
    : [];
  const byRef = new Map<string, CompareCase>();
  for (const item of linked) {
    if (!item.reference) continue;
    byRef.set(item.reference.toUpperCase(), item);
  }

  return rows.map((row) => {
    const key = squash(row.notNeededDuplicateOf).toUpperCase();
    const match = key ? byRef.get(key) || null : null;
    return toDuplicateCompareRow(row, match, { open: openId === row.id, reporterBase });
  });
}

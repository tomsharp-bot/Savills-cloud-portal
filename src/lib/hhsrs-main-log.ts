/**
 * Main Log: one row per case, plus cases marked actioned without a send.
 * A correction does not add a second line, even when correctsEmailId is missing.
 * Sends for the same case are one row. That row carries an Amended note.
 * Filters are applied in the database; the page only renders one slice.
 */
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { loadPortalProjectNames, storedNamesForPortalProject } from "./hhsrs-portal-projects.js";
import { HHSRS_ACTIONED_STATUSES, ratingDisplayClass } from "./hhsrs-reporter.js";
import { formatLondonDateTime, londonDayBounds, MISSING_EMAIL_BODY } from "./hhsrs-find.js";
import { dismissLogLine } from "./hhsrs-office-check.js";

export const MAIN_LOG_PAGE_SIZE = 50;
export const NOT_SENT_LABEL = "Not sent from portal";

const EXCEL_HEADERS = [
  "Sent date",
  "Sent time",
  "Ref",
  "Type",
  "Correction of",
  "Reason",
  "Note",
  "Project",
  "UPRN",
  "Address",
  "Postcode",
  "Hazard",
  "Rating",
  "Sent by",
  "From",
  "To",
  "Cc",
  "Bcc",
  "Subject",
  "Photos",
  "Photo names",
  "Email text",
] as const;

const EXCEL_WIDTHS = [14, 12, 14, 22, 22, 18, 28, 18, 16, 36, 12, 28, 22, 18, 32, 32, 28, 22, 46, 10, 36, 60];

export type MainLogType = "" | "original" | "correction" | "not_sent";

/** Columns shown on the Main Log table, in display order. */
export const MAIN_LOG_SORT_KEYS = [
  "sent",
  "ref",
  "project",
  "uprn",
  "address",
  "hazard",
  "rating",
  "by",
  "to",
  "photos",
  "type",
  "surveyor",
  "received",
] as const;

export type MainLogSortKey = (typeof MAIN_LOG_SORT_KEYS)[number];
export type MainLogSortDir = "asc" | "desc";

export type MainLogSort = {
  key: MainLogSortKey;
  dir: MainLogSortDir;
};

/** Headings on the shared case list. Sent, recipient, and type stay sortable by URL. */
export const MAIN_LOG_COLUMNS: ReadonlyArray<{ key: MainLogSortKey; label: string; className: string }> = [
  { key: "ref", label: "Reference", className: "" },
  { key: "project", label: "Project", className: "" },
  { key: "address", label: "Address", className: "" },
  { key: "photos", label: "Photos", className: "photo-att-col" },
  { key: "uprn", label: "UPRN", className: "" },
  { key: "surveyor", label: "Surveyor", className: "" },
  { key: "hazard", label: "Category", className: "" },
  { key: "rating", label: "Rating", className: "" },
  { key: "received", label: "Received", className: "" },
];

export type MainLogFilters = {
  q: string;
  project: string;
  by: string;
  type: MainLogType;
  from: string;
  to: string;
  /** Empty until the office clicks a column. */
  sort: MainLogSortKey | "";
  dir: MainLogSortDir;
  page: number;
  open: string;
  pageGiven: boolean;
  /** Submission projectName values that resolve to filters.project. */
  projectMatchNames?: string[];
};

export type MainLogKind = "original" | "correction" | "not_sent" | "dismissed";

export type MainLogEntry = {
  key: string;
  kind: MainLogKind;
  at: Date;
  reference: string;
  projectName: string;
  uprn: string;
  lineAddress: string;
  fullAddress: string;
  postcode: string;
  hazard: string;
  rating: string;
  surveyorName: string;
  createdAt: Date;
  sentBy: string;
  to: string;
  cc: string;
  bcc: string;
  from: string;
  subject: string;
  body: string;
  photoNames: string[];
  photoCount: number;
  submissionId: string;
  photoPaths: unknown;
  correctionReason: string;
  correctionNote: string;
  correctsKey: string | null;
  originalSentAt: Date | null;
  corrections: Array<{ key: string; at: Date; reason: string }>;
  /** The row stands for a case that has a correction, including when the link is missing. */
  amended?: boolean;
  /** Dismissed rows: who viewed the case, the decision, and that it was dismissed. */
  logLine?: string;
};

type SortItem = {
  key: string;
  kind: MainLogKind;
  at: number;
  correctsKey: string | null;
  /** Submission id. Emails for one case share it. Not-sent rows omit it. */
  caseKey?: string | null;
  ref?: string;
  project?: string;
  uprn?: string;
  address?: string;
  hazard?: string;
  rating?: string;
  by?: string;
  to?: string;
  photos?: number;
  typeLabel?: string;
  surveyor?: string;
  receivedAt?: number;
};

export type ArrangedLog = {
  pageKeys: string[];
  pages: string[][];
  page: number;
  pageCount: number;
  total: number;
  flags: Map<string, { showCorrectedNote: boolean; hasCorrBelow: boolean }>;
};

export function parseMainLogFilters(query: Record<string, unknown>): MainLogFilters {
  const typeRaw = String(query.type || "").trim();
  const type: MainLogType =
    typeRaw === "original" || typeRaw === "correction" || typeRaw === "not_sent" ? typeRaw : "";
  const pageRaw = String(query.page ?? "").trim();
  const pageNum = Number(pageRaw);
  const sortRaw = String(query.sort || "").trim();
  const sort = (MAIN_LOG_SORT_KEYS as readonly string[]).includes(sortRaw) ? (sortRaw as MainLogSortKey) : "";
  const dir: MainLogSortDir = String(query.dir || "").trim().toLowerCase() === "desc" ? "desc" : "asc";
  return {
    q: String(query.q || "").trim(),
    project: String(query.project || "").trim(),
    by: String(query.by || "").trim(),
    type,
    from: validDay(String(query.from || "").trim()),
    to: validDay(String(query.to || "").trim()),
    sort,
    dir,
    page: Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1,
    open: String(query.open || "").trim(),
    pageGiven: pageRaw !== "",
  };
}

function validDay(value: string): string {
  return londonDayBounds(value) ? value : "";
}

export function filtersActive(filters: MainLogFilters): boolean {
  return Boolean(filters.q || filters.project || filters.by || filters.type || filters.from || filters.to);
}

/** Address for the table (no postcode) and the panel (postcode included once). */
export function splitAddress(fullAddress: string, postcode: string): { line: string; postcode: string; full: string } {
  const pc = String(postcode || "").trim();
  let line = String(fullAddress || "").trim();
  if (pc) {
    const escaped = pc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    line = line.replace(new RegExp(`,?\\s*${escaped}\\s*$`, "i"), "").trim();
  }
  const full = pc ? (line ? `${line}, ${pc}` : pc) : line;
  return { line, postcode: pc, full };
}

export function emailAddressOnly(from: string): string {
  const raw = String(from || "").trim();
  const wrapped = raw.match(/<([^>]+)>/);
  return (wrapped ? wrapped[1] : raw).trim();
}

export function mainLogTypeLabel(kind: MainLogKind): string {
  if (kind === "correction") return "Correction";
  if (kind === "not_sent") return NOT_SENT_LABEL;
  if (kind === "dismissed") return "Dismissed";
  return "Original";
}

export function describeMainLogFilters(filters: MainLogFilters, total: number): string {
  const project = filters.project || "All projects";
  const by = filters.by || "Anyone";
  const type =
    filters.type === "original"
      ? "Original"
      : filters.type === "correction"
        ? "Correction"
        : filters.type === "not_sent"
          ? NOT_SENT_LABEL
          : "All types";
  let dates = "any date";
  if (filters.from && filters.to) dates = `${dmy(filters.from)}–${dmy(filters.to)}`;
  else if (filters.from) dates = `from ${dmy(filters.from)}`;
  else if (filters.to) dates = `to ${dmy(filters.to)}`;
  const search = filters.q ? `, “${filters.q}”` : "";
  const noun = total === 1 ? "email" : "emails";
  return `Filters: ${project}, ${by}, ${type}, ${dates}${search} · ${total} ${noun}`;
}

function dmy(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function showingLabel(total: number, from: number, to: number, unfiltered: number, filtered: boolean): string {
  const noun = total === 1 ? "email" : "emails";
  if (total === 0) return "Showing 0 emails";
  if (from === 1 && to === total) {
    if (filtered && unfiltered > total) return `Showing ${total} ${noun}`;
    return `Showing ${total} ${noun}`;
  }
  return `Showing ${from}–${to} of ${total}`;
}

function sentRange(filters: MainLogFilters): { gte?: Date; lt?: Date } {
  const start = filters.from ? londonDayBounds(filters.from) : null;
  const end = filters.to ? londonDayBounds(filters.to) : null;
  const range: { gte?: Date; lt?: Date } = {};
  if (start) range.gte = start.gte;
  if (end) range.lt = end.lt;
  return range;
}

function submissionSearch(filters: MainLogFilters): Prisma.HhsrsSiteSubmissionWhereInput | null {
  const and: Prisma.HhsrsSiteSubmissionWhereInput[] = [];
  if (filters.project) {
    const names = filters.projectMatchNames?.length ? filters.projectMatchNames : [filters.project];
    and.push({ projectName: { in: names } });
  }
  const q = filters.q;
  if (q) {
    const compact = q.replace(/\s+/g, "");
    const or: Prisma.HhsrsSiteSubmissionWhereInput[] = [
      { reference: { contains: q, mode: "insensitive" } },
      { uprn: { contains: q, mode: "insensitive" } },
      { fullAddress: { contains: q, mode: "insensitive" } },
      { postcode: { contains: q, mode: "insensitive" } },
    ];
    if (compact && compact !== q) or.push({ uprn: { contains: compact, mode: "insensitive" } });
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : null;
}

export function mainLogEmailWhere(filters: MainLogFilters): Prisma.HhsrsSentEmailWhereInput | null {
  if (filters.type === "not_sent") return null;
  const where: Prisma.HhsrsSentEmailWhereInput = {};
  if (filters.type === "original") where.kind = { not: "correction" };
  if (filters.type === "correction") where.kind = "correction";
  if (filters.by) where.sentBy = filters.by;
  const range = sentRange(filters);
  if (range.gte || range.lt) where.sentAt = range;
  const submission = submissionSearch(filters);
  if (submission) where.submission = submission;
  return where;
}

export function mainLogDismissedWhere(filters: MainLogFilters): Prisma.HhsrsSiteSubmissionWhereInput | null {
  if (filters.type === "original" || filters.type === "correction" || filters.type === "not_sent") return null;
  const and: Prisma.HhsrsSiteSubmissionWhereInput[] = [{ status: "dismissed" }];
  const submission = submissionSearch(filters);
  if (submission?.AND) and.push(...(submission.AND as Prisma.HhsrsSiteSubmissionWhereInput[]));
  if (filters.by) and.push({ dismissedBy: filters.by });
  const range = sentRange(filters);
  if (range.gte || range.lt) and.push({ dismissedAt: range });
  return { AND: and };
}

export function mainLogNotSentWhere(filters: MainLogFilters): Prisma.HhsrsSiteSubmissionWhereInput | null {
  if (filters.type === "original" || filters.type === "correction") return null;
  const and: Prisma.HhsrsSiteSubmissionWhereInput[] = [
    { status: { in: [...HHSRS_ACTIONED_STATUSES] } },
    { sentEmails: { none: {} } },
  ];
  const submission = submissionSearch(filters);
  if (submission?.AND) and.push(...(submission.AND as Prisma.HhsrsSiteSubmissionWhereInput[]));
  if (filters.by) {
    and.push({
      OR: [
        { emailSentBy: filters.by },
        { AND: [{ emailSentBy: "" }, { lastEditedBy: filters.by }] },
      ],
    });
  }
  const range = sentRange(filters);
  if (range.gte || range.lt) {
    and.push({
      OR: [
        { emailSentAt: range },
        { AND: [{ emailSentAt: null }, { updatedAt: range }] },
      ],
    });
  }
  return { AND: and };
}

function sortText(item: SortItem, key: MainLogSortKey): string {
  switch (key) {
    case "ref":
      return item.ref || "";
    case "project":
      return item.project || "";
    case "uprn":
      return item.uprn || "";
    case "address":
      return item.address || "";
    case "hazard":
      return item.hazard || "";
    case "rating":
      return item.rating || "";
    case "by":
      return item.by || "";
    case "to":
      return item.to || "";
    case "type":
      return item.typeLabel || "";
    case "surveyor":
      return item.surveyor || "";
    default:
      return "";
  }
}

/** Blank text sorts after real values. The other direction is a full reverse, so blanks come first. */
function compareSortItems(a: SortItem, b: SortItem, sort: MainLogSort): number {
  let cmp = 0;
  if (sort.key === "sent") {
    cmp = a.at - b.at;
  } else if (sort.key === "received") {
    cmp = (a.receivedAt ?? 0) - (b.receivedAt ?? 0);
  } else if (sort.key === "photos") {
    cmp = (a.photos ?? 0) - (b.photos ?? 0);
  } else {
    const left = sortText(a, sort.key).trim();
    const right = sortText(b, sort.key).trim();
    if (!left && !right) cmp = 0;
    else if (!left) cmp = 1;
    else if (!right) cmp = -1;
    else cmp = left.localeCompare(right, "en-GB", { numeric: true, sensitivity: "base" });
  }
  if (cmp) return sort.dir === "asc" ? cmp : -cmp;
  return b.at - a.at || a.key.localeCompare(b.key);
}

const CORRECTION_SUBJECT = /^correction\b/i;

/**
 * A send is a correction when it is stored as one, when it points at another send,
 * or when the subject is the correction subject. The case columns still come from
 * the original submission, so an unlinked correction looks like a second copy of the case.
 */
export function mainLogEmailKind(row: {
  kind?: string | null;
  correctsEmailId?: string | null;
  subject?: string | null;
}): MainLogKind {
  if (String(row.kind || "") === "correction" || row.correctsEmailId) return "correction";
  if (CORRECTION_SUBJECT.test(String(row.subject || "").trim())) return "correction";
  return "original";
}

function findGroup(parent: Map<string, string>, key: string): string {
  let cur = key;
  const seen = new Set<string>();
  while (parent.get(cur) && parent.get(cur) !== cur && !seen.has(cur)) {
    seen.add(cur);
    cur = parent.get(cur) as string;
  }
  return cur;
}

function unionGroup(parent: Map<string, string>, a: string, b: string): void {
  const left = findGroup(parent, a);
  const right = findGroup(parent, b);
  if (left !== right) parent.set(right, left);
}

/**
 * One row per case. Emails that share a submission are one row, even when
 * correctsEmailId is missing or points at a send that is not an original in this result.
 * A correction with no case id still joins the original it names.
 * Several corrections with no original in this result become the latest one.
 * Amended keys are that case row. Activity keeps a recent amendment near the top
 * of the default order without changing the row's own sent time.
 */
export function collapseCaseRows(items: SortItem[]): {
  rows: SortItem[];
  amended: Set<string>;
  activity: Map<string, number>;
} {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const parent = new Map<string, string>();
  for (const item of items) parent.set(item.key, item.key);

  const caseAnchor = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "not_sent" || item.kind === "dismissed" || !item.caseKey) continue;
    const anchor = caseAnchor.get(item.caseKey);
    if (anchor) unionGroup(parent, anchor, item.key);
    else caseAnchor.set(item.caseKey, item.key);
  }
  for (const item of items) {
    if (item.kind !== "correction" || !item.correctsKey) continue;
    const linked = byKey.get(item.correctsKey);
    if (linked) {
      if (item.caseKey && linked.caseKey && item.caseKey !== linked.caseKey) continue;
      unionGroup(parent, linked.key, item.key);
    } else if (!item.caseKey) {
      unionGroup(parent, item.correctsKey, item.key);
    }
  }

  const groups = new Map<string, SortItem[]>();
  for (const item of items) {
    const root = findGroup(parent, item.key);
    const list = groups.get(root) || [];
    list.push(item);
    groups.set(root, list);
  }

  const hidden = new Set<string>();
  const amended = new Set<string>();
  const activity = new Map<string, number>();
  for (const list of groups.values()) {
    if (list.length === 1) {
      const only = list[0];
      if (only.kind === "correction") {
        amended.add(only.key);
        activity.set(only.key, only.at);
      }
      continue;
    }
    const corrections = list.filter((row) => row.kind === "correction");
    const heads = list.filter((row) => row.kind !== "correction");
    const pointed = new Set(corrections.map((row) => row.correctsKey).filter((key): key is string => Boolean(key)));
    const linkedHeads = heads.filter((row) => pointed.has(row.key));
    const pool = linkedHeads.length ? linkedHeads : heads;
    const kept = pool.length
      ? pool.slice().sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))[0]
      : corrections.slice().sort((a, b) => b.at - a.at || a.key.localeCompare(b.key))[0];
    for (const row of list) if (row.key !== kept.key) hidden.add(row.key);
    amended.add(kept.key);
    activity.set(kept.key, Math.max(...list.map((row) => row.at)));
  }

  return { rows: items.filter((item) => !hidden.has(item.key)), amended, activity };
}

/**
 * Default: one row per case, newest activity first. A correction does not take its own line.
 * A column sort orders those same rows and still leaves the correction off the list.
 */
export function arrangeMainLog(
  items: SortItem[],
  correctedKeys: ReadonlySet<string>,
  page: number,
  pageSize: number,
  sort?: MainLogSort | null
): ArrangedLog {
  const collapsed = collapseCaseRows(items);
  const visible = collapsed.rows;
  const byKey = new Map(visible.map((item) => [item.key, item]));
  let ordered: Array<{ seq: SortItem[] }>;
  if (sort) {
    ordered = visible
      .slice()
      .sort((a, b) => compareSortItems(a, b, sort))
      .map((item) => ({ seq: [item] }));
  } else {
    const groups = new Map<string, SortItem[]>();
    const bucket = (root: string) => {
      let rows = groups.get(root);
      if (!rows) {
        rows = [];
        groups.set(root, rows);
      }
      return rows;
    };
    for (const item of visible) {
      if (item.kind === "correction" && item.correctsKey && byKey.has(item.correctsKey)) bucket(item.correctsKey).push(item);
      else bucket(item.key).push(item);
    }
    ordered = [...groups.values()]
      .map((rows) => {
        const head = rows.filter((row) => row.kind !== "correction").sort((a, b) => a.at - b.at);
        const tail = rows.filter((row) => row.kind === "correction").sort((a, b) => a.at - b.at);
        const seq = head.length ? head : tail.slice(-1);
        const times = seq.map((row) => Math.max(row.at, collapsed.activity.get(row.key) || 0));
        return { seq, latest: Math.max(...times) };
      })
      .sort((a, b) => b.latest - a.latest || a.seq[0].key.localeCompare(b.seq[0].key));
  }

  const pages: string[][] = [];
  let current: string[] = [];
  for (const group of ordered) {
    const keys = group.seq.map((row) => row.key);
    if (current.length && current.length + keys.length > pageSize) {
      pages.push(current);
      current = [];
    }
    current.push(...keys);
  }
  if (current.length) pages.push(current);
  if (!pages.length) pages.push([]);
  const pageCount = pages.length;
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageKeys = pages[safePage - 1] || [];
  const flags = new Map<string, { showCorrectedNote: boolean; hasCorrBelow: boolean }>();
  pageKeys.forEach((key) => {
    const item = byKey.get(key);
    flags.set(key, {
      showCorrectedNote:
        collapsed.amended.has(key) || Boolean(item && item.kind === "original" && correctedKeys.has(key)),
      hasCorrBelow: false,
    });
  });
  return { pageKeys, pages, page: safePage, pageCount, total: visible.length, flags };
}

export function pageForKey(pages: string[][], key: string): number {
  const index = pages.findIndex((page) => page.includes(key));
  return index === -1 ? 1 : index + 1;
}

type EmailRow = {
  id: string;
  sentAt: Date;
  sentBy: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  photoNames: unknown;
  kind: string;
  correctionReason: string;
  correctionNote: string;
  correctsEmailId: string | null;
  correctsEmail?: { sentAt: Date } | null;
  corrections?: Array<{ id: string; sentAt: Date; correctionReason: string }>;
  submission: {
    id: string;
    reference: string | null;
    projectName: string;
    uprn: string;
    fullAddress: string;
    postcode: string;
    category: string;
    rating: string;
    photoPaths: unknown;
    surveyorName: string;
    createdAt: Date;
  };
};

type CaseRow = {
  id: string;
  reference: string | null;
  projectName: string;
  uprn: string;
  fullAddress: string;
  postcode: string;
  category: string;
  rating: string;
  photoPaths: unknown;
  surveyorName: string;
  createdAt: Date;
  emailSentAt: Date | null;
  emailSentBy: string;
  lastEditedBy: string;
  updatedAt: Date;
  emailSubject: string;
  emailBody: string;
  status?: string;
  dismissedDecision?: string;
  dismissedBy?: string;
  dismissedAt?: Date | null;
};

function namesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function emailEntry(row: EmailRow): MainLogEntry {
  const address = splitAddress(row.submission.fullAddress, row.submission.postcode);
  const photos = namesOf(row.photoNames);
  const correction = row.kind === "correction";
  return {
    key: `email:${row.id}`,
    kind: correction ? "correction" : "original",
    at: row.sentAt,
    reference: row.submission.reference || "",
    projectName: row.submission.projectName,
    uprn: row.submission.uprn,
    lineAddress: address.line,
    fullAddress: address.full,
    postcode: address.postcode,
    hazard: row.submission.category,
    rating: row.submission.rating,
    surveyorName: row.submission.surveyorName,
    createdAt: row.submission.createdAt,
    sentBy: row.sentBy,
    to: row.to,
    cc: row.cc,
    bcc: row.bcc,
    from: row.from,
    subject: row.subject,
    body: row.body,
    photoNames: photos,
    photoCount: photos.length,
    submissionId: row.submission.id,
    photoPaths: row.submission.photoPaths,
    correctionReason: correction ? row.correctionReason : "",
    correctionNote: correction ? row.correctionNote : "",
    correctsKey: correction && row.correctsEmailId ? `email:${row.correctsEmailId}` : null,
    originalSentAt: correction && row.correctsEmail ? row.correctsEmail.sentAt : null,
    corrections: (row.corrections || [])
      .slice()
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
      .map((item) => ({
        key: `email:${item.id}`,
        at: item.sentAt,
        reason: item.correctionReason,
      })),
  };
}

function caseEntry(row: CaseRow): MainLogEntry {
  const address = splitAddress(row.fullAddress, row.postcode);
  const photos = namesOf(row.photoPaths).map((path) => path.split("/").filter(Boolean).pop() || path);
  const dismissed = row.status === "dismissed";
  const viewedBy = row.dismissedBy || row.emailSentBy || row.lastEditedBy || "";
  return {
    key: `case:${row.id}`,
    kind: dismissed ? "dismissed" : "not_sent",
    at: dismissed ? row.dismissedAt || row.updatedAt : row.emailSentAt || row.updatedAt,
    logLine: dismissed ? dismissLogLine(viewedBy, row.dismissedDecision || "") : "",
    reference: row.reference || "",
    projectName: row.projectName,
    uprn: row.uprn,
    lineAddress: address.line,
    fullAddress: address.full,
    postcode: address.postcode,
    hazard: row.category,
    rating: row.rating,
    surveyorName: row.surveyorName,
    createdAt: row.createdAt,
    sentBy: dismissed ? viewedBy : row.emailSentBy || row.lastEditedBy || "",
    to: "",
    cc: "",
    bcc: "",
    from: "",
    subject: row.emailSubject || "",
    body: row.emailBody || "",
    photoNames: photos,
    photoCount: photos.length,
    submissionId: row.id,
    photoPaths: row.photoPaths,
    correctionReason: "",
    correctionNote: "",
    correctsKey: null,
    originalSentAt: null,
    corrections: [],
  };
}

const emailInclude = {
  submission: true,
  correctsEmail: { select: { sentAt: true } },
  corrections: { select: { id: true, sentAt: true, correctionReason: true } },
} as const;

/** Original rows whose case has a correction, including one that does not point back at them. */
async function correctedKeySet(items: SortItem[]): Promise<Set<string>> {
  const originals = items.filter((item) => item.kind === "original");
  if (!originals.length) return new Set();
  const originalIds = originals.map((item) => item.key.slice(6));
  const submissionIds = [...new Set(originals.map((item) => item.caseKey).filter((id): id is string => Boolean(id)))];
  const [linked, siblings] = await Promise.all([
    prisma.hhsrsSentEmail.findMany({
      where: { kind: "correction", correctsEmailId: { in: originalIds } },
      select: { correctsEmailId: true },
      distinct: ["correctsEmailId"],
    }),
    submissionIds.length
      ? prisma.hhsrsSentEmail.findMany({
          where: {
            submissionId: { in: submissionIds },
            NOT: { id: { in: originalIds } },
            OR: [
              { kind: "correction" },
              { correctsEmailId: { not: null } },
              { subject: { startsWith: "CORRECTION:", mode: "insensitive" } },
            ],
          },
          select: { submissionId: true },
          distinct: ["submissionId"],
        })
      : Promise.resolve([]),
  ]);
  const keys = new Set<string>();
  for (const row of linked) if (row.correctsEmailId) keys.add(`email:${row.correctsEmailId}`);
  const amendedCases = new Set(siblings.map((row) => row.submissionId));
  for (const item of originals) {
    if (item.caseKey && amendedCases.has(item.caseKey)) keys.add(item.key);
  }
  return keys;
}

function emailSortBase(row: {
  id: string;
  sentAt: Date;
  kind: string;
  correctsEmailId: string | null;
  subject?: string | null;
  submissionId: string;
}): Pick<SortItem, "key" | "kind" | "at" | "correctsKey" | "caseKey"> {
  const kind = mainLogEmailKind(row);
  return {
    key: `email:${row.id}`,
    kind,
    at: row.sentAt.getTime(),
    correctsKey: kind === "correction" && row.correctsEmailId ? `email:${row.correctsEmailId}` : null,
    caseKey: row.submissionId,
  };
}

function columnValues(input: {
  reference: string | null;
  projectName: string;
  uprn: string;
  fullAddress: string;
  postcode: string;
  category: string;
  rating: string;
  sentBy: string;
  to: string;
  photos: unknown;
  kind: MainLogKind;
  surveyorName: string;
  createdAt: Date | null;
}): Pick<SortItem, "ref" | "project" | "uprn" | "address" | "hazard" | "rating" | "by" | "to" | "photos" | "typeLabel" | "surveyor" | "receivedAt"> {
  return {
    ref: input.reference || "",
    project: input.projectName || "",
    uprn: input.uprn || "",
    address: splitAddress(input.fullAddress, input.postcode).line,
    hazard: input.category || "",
    rating: input.rating || "",
    by: input.sentBy || "",
    to: input.to || "",
    photos: namesOf(input.photos).length,
    typeLabel: mainLogTypeLabel(input.kind),
    surveyor: input.surveyorName || "",
    receivedAt: input.createdAt ? input.createdAt.getTime() : 0,
  };
}

function dismissedSortItem(row: { id: string; dismissedAt: Date | null; updatedAt: Date }): SortItem {
  return {
    key: `case:${row.id}`,
    kind: "dismissed",
    at: (row.dismissedAt || row.updatedAt).getTime(),
    correctsKey: null,
  };
}

async function listSortItems(filters: MainLogFilters): Promise<SortItem[]> {
  const emailWhere = mainLogEmailWhere(filters);
  const caseWhere = mainLogNotSentWhere(filters);
  const dismissedWhere = mainLogDismissedWhere(filters);
  if (!filters.sort) {
    const [emails, cases, dismissed] = await Promise.all([
      emailWhere
        ? prisma.hhsrsSentEmail.findMany({
            where: emailWhere,
            select: { id: true, sentAt: true, kind: true, correctsEmailId: true, submissionId: true, subject: true },
          })
        : Promise.resolve([]),
      caseWhere
        ? prisma.hhsrsSiteSubmission.findMany({
            where: caseWhere,
            select: { id: true, emailSentAt: true, updatedAt: true },
          })
        : Promise.resolve([]),
      dismissedWhere
        ? prisma.hhsrsSiteSubmission.findMany({
            where: dismissedWhere,
            select: { id: true, dismissedAt: true, updatedAt: true },
          })
        : Promise.resolve([]),
    ]);
    return [
      ...emails.map((row) => emailSortBase(row)),
      ...cases.map((row) => ({
        key: `case:${row.id}`,
        kind: "not_sent" as const,
        at: (row.emailSentAt || row.updatedAt).getTime(),
        correctsKey: null,
      })),
      ...dismissed.map((row) => dismissedSortItem(row)),
    ];
  }
  const [emails, cases, dismissed] = await Promise.all([
    emailWhere
      ? prisma.hhsrsSentEmail.findMany({
          where: emailWhere,
          select: {
            id: true,
            sentAt: true,
            kind: true,
            correctsEmailId: true,
            subject: true,
            sentBy: true,
            to: true,
            photoNames: true,
            submission: {
              select: {
                id: true,
                reference: true,
                projectName: true,
                uprn: true,
                fullAddress: true,
                postcode: true,
                category: true,
                rating: true,
                surveyorName: true,
                createdAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    caseWhere
      ? prisma.hhsrsSiteSubmission.findMany({
          where: caseWhere,
          select: {
            id: true,
            emailSentAt: true,
            updatedAt: true,
            reference: true,
            projectName: true,
            uprn: true,
            fullAddress: true,
            postcode: true,
            category: true,
            rating: true,
            surveyorName: true,
            createdAt: true,
            emailSentBy: true,
            lastEditedBy: true,
            photoPaths: true,
          },
        })
      : Promise.resolve([]),
    dismissedWhere
      ? prisma.hhsrsSiteSubmission.findMany({
          where: dismissedWhere,
          select: {
            id: true,
            dismissedAt: true,
            updatedAt: true,
            reference: true,
            projectName: true,
            uprn: true,
            fullAddress: true,
            postcode: true,
            category: true,
            rating: true,
            surveyorName: true,
            createdAt: true,
            dismissedBy: true,
            photoPaths: true,
          },
        })
      : Promise.resolve([]),
  ]);
  return [
    ...emails.map((row) => {
      const base = emailSortBase({ ...row, submissionId: row.submission.id });
      return {
        ...base,
        ...columnValues({
          reference: row.submission.reference,
          projectName: row.submission.projectName,
          uprn: row.submission.uprn,
          fullAddress: row.submission.fullAddress,
          postcode: row.submission.postcode,
          category: row.submission.category,
          rating: row.submission.rating,
          sentBy: row.sentBy,
          to: row.to,
          photos: row.photoNames,
          kind: base.kind,
          surveyorName: row.submission.surveyorName,
          createdAt: row.submission.createdAt,
        }),
      };
    }),
    ...cases.map((row) => ({
      key: `case:${row.id}`,
      kind: "not_sent" as const,
      at: (row.emailSentAt || row.updatedAt).getTime(),
      correctsKey: null,
      ...columnValues({
        reference: row.reference,
        projectName: row.projectName,
        uprn: row.uprn,
        fullAddress: row.fullAddress,
        postcode: row.postcode,
        category: row.category,
        rating: row.rating,
        sentBy: row.emailSentBy || row.lastEditedBy || "",
        to: "",
        photos: row.photoPaths,
        kind: "not_sent",
        surveyorName: row.surveyorName,
        createdAt: row.createdAt,
      }),
    })),
    ...dismissed.map((row) => ({
      ...dismissedSortItem(row),
      ...columnValues({
        reference: row.reference,
        projectName: row.projectName,
        uprn: row.uprn,
        fullAddress: row.fullAddress,
        postcode: row.postcode,
        category: row.category,
        rating: row.rating,
        sentBy: row.dismissedBy || "",
        to: "",
        photos: row.photoPaths,
        kind: "dismissed",
        surveyorName: row.surveyorName,
        createdAt: row.createdAt,
      }),
    })),
  ];
}

async function hydrate(keys: string[]): Promise<Map<string, MainLogEntry>> {
  const emailIds = keys.filter((key) => key.startsWith("email:")).map((key) => key.slice(6));
  const caseIds = keys.filter((key) => key.startsWith("case:")).map((key) => key.slice(5));
  const [emails, cases] = await Promise.all([
    emailIds.length
      ? prisma.hhsrsSentEmail.findMany({ where: { id: { in: emailIds } }, include: emailInclude })
      : Promise.resolve([]),
    caseIds.length
      ? prisma.hhsrsSiteSubmission.findMany({ where: { id: { in: caseIds } } })
      : Promise.resolve([]),
  ]);
  const map = new Map<string, MainLogEntry>();
  for (const row of emails) map.set(`email:${row.id}`, emailEntry(row));
  for (const row of cases) map.set(`case:${row.id}`, caseEntry(row));
  return map;
}

export type LoadedMainLog = {
  filters: MainLogFilters;
  entries: MainLogEntry[];
  flags: Map<string, { showCorrectedNote: boolean; hasCorrBelow: boolean }>;
  panel: MainLogEntry | null;
  total: number;
  unfiltered: number;
  page: number;
  pageCount: number;
  from: number;
  to: number;
  projectNames: string[];
  senders: string[];
};

async function withPortalProjectMatch(filters: MainLogFilters): Promise<MainLogFilters> {
  if (!filters.project) return filters;
  return { ...filters, projectMatchNames: await storedNamesForPortalProject(filters.project) };
}

export async function loadMainLog(query: Record<string, unknown>): Promise<LoadedMainLog> {
  const filters = await withPortalProjectMatch(parseMainLogFilters(query));
  const items = await listSortItems(filters);
  const corrected = await correctedKeySet(items);
  const sort = filters.sort ? { key: filters.sort, dir: filters.dir } : null;
  let arranged = arrangeMainLog(items, corrected, filters.page, MAIN_LOG_PAGE_SIZE, sort);
  if (filters.open && !filters.pageGiven) {
    const jump = pageForKey(arranged.pages, filters.open);
    if (jump !== arranged.page) arranged = arrangeMainLog(items, corrected, jump, MAIN_LOG_PAGE_SIZE, sort);
  }
  const hydrated = await hydrate(arranged.pageKeys);
  const entries = arranged.pageKeys.map((key) => hydrated.get(key)).filter((row): row is MainLogEntry => Boolean(row));
  let panel = filters.open ? entries.find((row) => row.key === filters.open) || null : null;
  if (filters.open && !panel) panel = await loadOpenEntry(filters.open);
  const [projects, senders, unfiltered] = await Promise.all([
    projectNames(filters.project),
    senderNames(),
    unfilteredCount(),
  ]);
  const from = entries.length ? (arranged.pages.slice(0, arranged.page - 1).reduce((sum, page) => sum + page.length, 0) + 1) : 0;
  const to = from ? from + entries.length - 1 : 0;
  return {
    filters: { ...filters, page: arranged.page },
    entries,
    flags: arranged.flags,
    panel,
    total: arranged.total,
    unfiltered,
    page: arranged.page,
    pageCount: arranged.pageCount,
    from,
    to,
    projectNames: projects,
    senders,
  };
}

async function loadOpenEntry(open: string): Promise<MainLogEntry | null> {
  if (open.startsWith("email:")) {
    const row = await prisma.hhsrsSentEmail.findUnique({ where: { id: open.slice(6) }, include: emailInclude });
    return row ? emailEntry(row) : null;
  }
  if (open.startsWith("case:")) {
    const id = open.slice(5);
    const row = await prisma.hhsrsSiteSubmission.findFirst({
      where: { id, status: { in: [...HHSRS_ACTIONED_STATUSES] }, sentEmails: { none: {} } },
    });
    if (row) return caseEntry(row);
    const dismissed = await prisma.hhsrsSiteSubmission.findFirst({
      where: { id, status: "dismissed" },
    });
    return dismissed ? caseEntry(dismissed) : null;
  }
  return null;
}

async function projectNames(selected = ""): Promise<string[]> {
  const names = await loadPortalProjectNames();
  if (selected && !names.some((name) => name === selected)) names.push(selected);
  return names;
}

async function senderNames(): Promise<string[]> {
  const [sent, cases, dismissed] = await Promise.all([
    prisma.hhsrsSentEmail.findMany({ distinct: ["sentBy"], select: { sentBy: true } }),
    prisma.hhsrsSiteSubmission.findMany({
      where: { status: { in: [...HHSRS_ACTIONED_STATUSES] }, sentEmails: { none: {} } },
      select: { emailSentBy: true, lastEditedBy: true },
    }),
    prisma.hhsrsSiteSubmission.findMany({
      where: { status: "dismissed" },
      distinct: ["dismissedBy"],
      select: { dismissedBy: true },
    }),
  ]);
  const names = new Set<string>();
  for (const row of sent) if (row.sentBy) names.add(row.sentBy);
  for (const row of cases) {
    const name = row.emailSentBy || row.lastEditedBy;
    if (name) names.add(name);
  }
  for (const row of dismissed) if (row.dismissedBy) names.add(row.dismissedBy);
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function unfilteredCount(): Promise<number> {
  const [emails, cases, dismissed] = await Promise.all([
    prisma.hhsrsSentEmail.count(),
    prisma.hhsrsSiteSubmission.count({
      where: { status: { in: [...HHSRS_ACTIONED_STATUSES] }, sentEmails: { none: {} } },
    }),
    prisma.hhsrsSiteSubmission.count({ where: { status: "dismissed" } }),
  ]);
  return emails + cases + dismissed;
}

export async function loadMainLogExport(query: Record<string, unknown>): Promise<{ filters: MainLogFilters; entries: MainLogEntry[] }> {
  const filters = await withPortalProjectMatch(parseMainLogFilters(query));
  const items = await listSortItems(filters);
  const corrected = await correctedKeySet(items);
  const sort = filters.sort ? { key: filters.sort, dir: filters.dir } : null;
  const arranged = arrangeMainLog(items, corrected, 1, Math.max(items.length, 1), sort);
  const hydrated = await hydrate(arranged.pages.flat());
  const entries = arranged.pages
    .flat()
    .map((key) => hydrated.get(key))
    .filter((row): row is MainLogEntry => Boolean(row))
    .map((entry) => ({ ...entry, amended: Boolean(arranged.flags.get(entry.key)?.showCorrectedNote) }));
  return { filters, entries };
}

export function correctionLinkLine(entry: MainLogEntry): string {
  if (entry.kind !== "correction" || !entry.originalSentAt) return "";
  const when = formatLondonDateTime(entry.originalSentAt);
  const reason = entry.correctionReason.trim();
  return reason ? `Correction of email sent ${when} · Reason: ${reason}` : `Correction of email sent ${when}`;
}

export function casePhotoViews(
  entry: Pick<MainLogEntry, "submissionId" | "photoPaths" | "photoNames" | "kind">,
  reporterBase: string
): Array<{ name: string; url: string }> {
  const paths = namesOf(entry.photoPaths);
  const wanted = entry.kind === "not_sent" || entry.kind === "dismissed"
    ? paths.map((path) => path.split("/").filter(Boolean).pop() || path).filter(Boolean)
    : entry.photoNames;
  return wanted.map((name) => {
    const stored = paths.find((path) => path.split("/").filter(Boolean).pop() === name);
    return {
      name,
      url: stored ? `${reporterBase}/${encodeURIComponent(entry.submissionId)}/photos/${encodeURIComponent(name)}` : "",
    };
  });
}

export type MainLogExcelInput = {
  entries: MainLogEntry[];
  filters: MainLogFilters;
  exportedBy: string;
  exportedAt: Date;
};

export async function buildMainLogWorkbook(input: MainLogExcelInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.exportedBy || "HHSRS Reporter";
  const sheet = workbook.addWorksheet("Main Log");
  sheet.addRow(["HHSRS Main Log export"]);
  sheet.addRow([
    `Exported ${formatLondonDateTime(input.exportedAt)} by ${input.exportedBy || "—"} · ${describeMainLogFilters(input.filters, input.entries.length)}`,
  ]);
  sheet.addRow([]);
  const header = sheet.addRow([...EXCEL_HEADERS]);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.getRow(1).font = { bold: true, size: 14, color: { argb: "FF0B1F3A" }, name: "Calibri" };
  sheet.getRow(2).font = { size: 11, name: "Calibri", color: { argb: "FF1C2430" } };

  input.entries.forEach((entry, index) => {
    const when = formatLondonDateTime(entry.at).split(" ");
    const correction = entry.kind === "correction";
    const sent = entry.kind === "original" || entry.kind === "correction";
    const values: Array<string | number | null> = [
      when[0] || null,
      when[1] || null,
      entry.reference || null,
      mainLogTypeLabel(entry.kind),
      correction && entry.originalSentAt ? formatLondonDateTime(entry.originalSentAt) : null,
      correction ? entry.correctionReason || null : null,
      correction
        ? entry.correctionNote || null
        : entry.kind === "dismissed"
          ? entry.logLine || null
          : entry.amended || entry.corrections.length
            ? "Amended"
            : null,
      entry.projectName || null,
      entry.uprn || null,
      entry.lineAddress || null,
      entry.postcode || null,
      entry.hazard || null,
      entry.rating || null,
      entry.sentBy || null,
      sent ? emailAddressOnly(entry.from) || null : null,
      entry.to || null,
      entry.cc || null,
      entry.bcc || null,
      entry.subject || null,
      entry.photoCount,
      entry.photoNames.length ? entry.photoNames.join("; ") : null,
      entry.body.trim() ? entry.body : sent ? MISSING_EMAIL_BODY : null,
    ];
    const row = sheet.addRow(values);
    row.font = { name: "Calibri", size: 11 };
    if (correction) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      });
    } else if (index % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
      });
    }
  });

  sheet.columns = EXCEL_WIDTHS.map((width) => ({ width }));
  const lastRow = Math.max(4, 4 + input.entries.length);
  sheet.views = [{ state: "frozen", ySplit: 4, xSplit: 3, activeCell: "A1", showGridLines: true }];
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: lastRow, column: EXCEL_HEADERS.length } };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function ratingClassFor(rating: string): string {
  return ratingDisplayClass(rating);
}

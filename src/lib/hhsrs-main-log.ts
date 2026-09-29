/**
 * Main Log: one row per portal send, plus cases marked actioned without a send.
 * Corrections sit under the original they correct. Filters are applied in the
 * database; the page only renders one slice.
 */
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { loadPortalProjectNames, storedNamesForPortalProject } from "./hhsrs-portal-projects.js";
import { HHSRS_ACTIONED_STATUSES, ratingDisplayClass } from "./hhsrs-reporter.js";
import { formatLondonDateTime, londonDayBounds, MISSING_EMAIL_BODY } from "./hhsrs-find.js";

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
] as const;

export type MainLogSortKey = (typeof MAIN_LOG_SORT_KEYS)[number];
export type MainLogSortDir = "asc" | "desc";

export type MainLogSort = {
  key: MainLogSortKey;
  dir: MainLogSortDir;
};

export const MAIN_LOG_COLUMNS: ReadonlyArray<{ key: MainLogSortKey; label: string; className: string }> = [
  { key: "sent", label: "Sent", className: "" },
  { key: "ref", label: "Ref", className: "" },
  { key: "project", label: "Project", className: "" },
  { key: "uprn", label: "UPRN", className: "" },
  { key: "address", label: "Address", className: "" },
  { key: "hazard", label: "Hazard", className: "" },
  { key: "rating", label: "Rating", className: "" },
  { key: "by", label: "Sent by", className: "" },
  { key: "to", label: "To", className: "" },
  { key: "photos", label: "Photos", className: "ml-ph" },
  { key: "type", label: "Type", className: "" },
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

export type MainLogKind = "original" | "correction" | "not_sent";

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
};

type SortItem = {
  key: string;
  kind: MainLogKind;
  at: number;
  correctsKey: string | null;
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
    default:
      return "";
  }
}

/** Blank text sorts after real values. The other direction is a full reverse, so blanks come first. */
function compareSortItems(a: SortItem, b: SortItem, sort: MainLogSort): number {
  let cmp = 0;
  if (sort.key === "sent") {
    cmp = a.at - b.at;
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

/**
 * Default: groups, newest activity first. A correction stays under its original when both match.
 * A column sort orders each visible row by that column and does not keep the group glued together.
 */
export function arrangeMainLog(
  items: SortItem[],
  correctedKeys: ReadonlySet<string>,
  page: number,
  pageSize: number,
  sort?: MainLogSort | null
): ArrangedLog {
  const byKey = new Map(items.map((item) => [item.key, item]));
  let ordered: Array<{ seq: SortItem[] }>;
  if (sort) {
    ordered = items
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
    for (const item of items) {
      if (item.kind === "correction" && item.correctsKey && byKey.has(item.correctsKey)) bucket(item.correctsKey).push(item);
      else bucket(item.key).push(item);
    }
    ordered = [...groups.values()]
      .map((rows) => {
        const head = rows.filter((row) => row.kind !== "correction").sort((a, b) => a.at - b.at);
        const tail = rows.filter((row) => row.kind === "correction").sort((a, b) => a.at - b.at);
        const seq = [...head, ...tail];
        return { seq, latest: Math.max(...seq.map((row) => row.at)) };
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
  pageKeys.forEach((key, index) => {
    const item = byKey.get(key);
    const next = byKey.get(pageKeys[index + 1] || "");
    const hasCorrBelow = Boolean(next && next.kind === "correction" && next.correctsKey === key);
    flags.set(key, {
      showCorrectedNote: sort
        ? hasCorrBelow
        : Boolean(item && item.kind === "original" && correctedKeys.has(key)),
      hasCorrBelow,
    });
  });
  return { pageKeys, pages, page: safePage, pageCount, total: items.length, flags };
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
  emailSentAt: Date | null;
  emailSentBy: string;
  lastEditedBy: string;
  updatedAt: Date;
  emailSubject: string;
  emailBody: string;
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
  return {
    key: `case:${row.id}`,
    kind: "not_sent",
    at: row.emailSentAt || row.updatedAt,
    reference: row.reference || "",
    projectName: row.projectName,
    uprn: row.uprn,
    lineAddress: address.line,
    fullAddress: address.full,
    postcode: address.postcode,
    hazard: row.category,
    rating: row.rating,
    sentBy: row.emailSentBy || row.lastEditedBy || "",
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

async function correctedKeySet(originalIds: string[]): Promise<Set<string>> {
  if (!originalIds.length) return new Set();
  const rows = await prisma.hhsrsSentEmail.findMany({
    where: { kind: "correction", correctsEmailId: { in: originalIds } },
    select: { correctsEmailId: true },
    distinct: ["correctsEmailId"],
  });
  return new Set(rows.map((row) => `email:${row.correctsEmailId}`));
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
}): Pick<SortItem, "ref" | "project" | "uprn" | "address" | "hazard" | "rating" | "by" | "to" | "photos" | "typeLabel"> {
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
  };
}

async function listSortItems(filters: MainLogFilters): Promise<SortItem[]> {
  const emailWhere = mainLogEmailWhere(filters);
  const caseWhere = mainLogNotSentWhere(filters);
  if (!filters.sort) {
    const [emails, cases] = await Promise.all([
      emailWhere
        ? prisma.hhsrsSentEmail.findMany({
            where: emailWhere,
            select: { id: true, sentAt: true, kind: true, correctsEmailId: true },
          })
        : Promise.resolve([]),
      caseWhere
        ? prisma.hhsrsSiteSubmission.findMany({
            where: caseWhere,
            select: { id: true, emailSentAt: true, updatedAt: true },
          })
        : Promise.resolve([]),
    ]);
    return [
      ...emails.map((row) => ({
        key: `email:${row.id}`,
        kind: (row.kind === "correction" ? "correction" : "original") as MainLogKind,
        at: row.sentAt.getTime(),
        correctsKey: row.kind === "correction" && row.correctsEmailId ? `email:${row.correctsEmailId}` : null,
      })),
      ...cases.map((row) => ({
        key: `case:${row.id}`,
        kind: "not_sent" as const,
        at: (row.emailSentAt || row.updatedAt).getTime(),
        correctsKey: null,
      })),
    ];
  }
  const [emails, cases] = await Promise.all([
    emailWhere
      ? prisma.hhsrsSentEmail.findMany({
          where: emailWhere,
          select: {
            id: true,
            sentAt: true,
            kind: true,
            correctsEmailId: true,
            sentBy: true,
            to: true,
            photoNames: true,
            submission: {
              select: {
                reference: true,
                projectName: true,
                uprn: true,
                fullAddress: true,
                postcode: true,
                category: true,
                rating: true,
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
            emailSentBy: true,
            lastEditedBy: true,
            photoPaths: true,
          },
        })
      : Promise.resolve([]),
  ]);
  return [
    ...emails.map((row) => {
      const kind = (row.kind === "correction" ? "correction" : "original") as MainLogKind;
      return {
        key: `email:${row.id}`,
        kind,
        at: row.sentAt.getTime(),
        correctsKey: row.kind === "correction" && row.correctsEmailId ? `email:${row.correctsEmailId}` : null,
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
          kind,
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
  const originalIds = items.filter((item) => item.kind === "original").map((item) => item.key.slice(6));
  const corrected = await correctedKeySet(originalIds);
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
    const row = await prisma.hhsrsSiteSubmission.findFirst({
      where: { id: open.slice(5), status: { in: [...HHSRS_ACTIONED_STATUSES] }, sentEmails: { none: {} } },
    });
    return row ? caseEntry(row) : null;
  }
  return null;
}

async function projectNames(selected = ""): Promise<string[]> {
  const names = await loadPortalProjectNames();
  if (selected && !names.some((name) => name === selected)) names.push(selected);
  return names;
}

async function senderNames(): Promise<string[]> {
  const [sent, cases] = await Promise.all([
    prisma.hhsrsSentEmail.findMany({ distinct: ["sentBy"], select: { sentBy: true } }),
    prisma.hhsrsSiteSubmission.findMany({
      where: { status: { in: [...HHSRS_ACTIONED_STATUSES] }, sentEmails: { none: {} } },
      select: { emailSentBy: true, lastEditedBy: true },
    }),
  ]);
  const names = new Set<string>();
  for (const row of sent) if (row.sentBy) names.add(row.sentBy);
  for (const row of cases) {
    const name = row.emailSentBy || row.lastEditedBy;
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function unfilteredCount(): Promise<number> {
  const [emails, cases] = await Promise.all([
    prisma.hhsrsSentEmail.count(),
    prisma.hhsrsSiteSubmission.count({
      where: { status: { in: [...HHSRS_ACTIONED_STATUSES] }, sentEmails: { none: {} } },
    }),
  ]);
  return emails + cases;
}

export async function loadMainLogExport(query: Record<string, unknown>): Promise<{ filters: MainLogFilters; entries: MainLogEntry[] }> {
  const filters = await withPortalProjectMatch(parseMainLogFilters(query));
  const items = await listSortItems(filters);
  const sort = filters.sort ? { key: filters.sort, dir: filters.dir } : null;
  const arranged = arrangeMainLog(items, new Set(), 1, Math.max(items.length, 1), sort);
  const hydrated = await hydrate(arranged.pages.flat());
  const entries = arranged.pages.flat().map((key) => hydrated.get(key)).filter((row): row is MainLogEntry => Boolean(row));
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
  const wanted = entry.kind === "not_sent"
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
    const sent = entry.kind !== "not_sent";
    const values: Array<string | number | null> = [
      when[0] || null,
      when[1] || null,
      entry.reference || null,
      mainLogTypeLabel(entry.kind),
      correction && entry.originalSentAt ? formatLondonDateTime(entry.originalSentAt) : null,
      correction ? entry.correctionReason || null : null,
      correction ? entry.correctionNote || null : null,
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

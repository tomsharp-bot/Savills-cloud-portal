/**
 * Find & resend: search, status labels, and correction checks.
 * Sending itself goes through the existing portal send path.
 */
import type { Prisma } from "@prisma/client";

export const CORRECTION_REASONS = [
  "Wrong address",
  "Wrong details",
  "Wrong recipient",
  "Missing photo",
  "Other",
] as const;

export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

export const FIND_STATUS_LABELS = ["Waiting", "In review", "Sent", "Corrected", "Not needed"] as const;
export type FindStatusLabel = (typeof FIND_STATUS_LABELS)[number];

export const MISSING_EMAIL_BODY = "Full text not stored for this email";

export function isCorrectionReason(value: string): value is CorrectionReason {
  return (CORRECTION_REASONS as readonly string[]).includes(value);
}

/** Waiting / In review / Sent / Corrected, from the case's stored status. */
export function findStatusLabel(status: string): FindStatusLabel {
  switch (status) {
    case "new":
      return "Waiting";
    case "in_review":
    case "email_ready":
      return "In review";
    case "corrected":
      return "Corrected";
    case "email_sent":
    case "closed":
      return "Sent";
    case "not_needed":
      return "Not needed";
    default:
      return "Waiting";
  }
}

export function caseWasSent(status: string, sentCount: number): boolean {
  if (sentCount > 0) return true;
  return status === "email_sent" || status === "closed" || status === "corrected";
}

/** Prefix once. "CORRECTION: CORRECTION: …" collapses back to a single prefix. */
export function correctionSubject(subject: string): string {
  const trimmed = String(subject || "")
    .trim()
    .replace(/^(?:correction:\s*)+/i, "")
    .trim();
  return trimmed ? `CORRECTION: ${trimmed}` : "CORRECTION:";
}

export function validateCorrection(input: { reason: string; note: string; to: string }):
  | { ok: true; reason: CorrectionReason; note: string }
  | { ok: false; error: string } {
  const reason = String(input.reason || "").trim();
  const note = String(input.note || "").trim();
  const to = String(input.to || "").trim();
  if (!reason) return { ok: false, error: "Pick a reason." };
  if (!isCorrectionReason(reason)) return { ok: false, error: "Pick a reason." };
  if (reason === "Other" && !note) return { ok: false, error: "Add a short note." };
  if (!to) return { ok: false, error: "Add a To address." };
  return { ok: true, reason, note };
}

export function correctionReasonLine(reason: string, note: string): string {
  const picked = String(reason || "").trim();
  const extra = String(note || "").trim();
  if (!picked && !extra) return "";
  if (picked && extra) return `${picked} – ${extra}`;
  return picked || extra;
}

const LONDON = "Europe/London";

function londonParts(date: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  return map;
}

/** dd/mm/yyyy HH:mm in Europe/London. */
export function formatLondonDateTime(date: Date): string {
  const p = londonParts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** dd/mm/yyyy in Europe/London. */
export function formatLondonDate(date: Date): string {
  return formatLondonDateTime(date).split(" ")[0];
}

export function correctionOfNote(originalSentAt: Date): string {
  return `Correction of email sent ${formatLondonDate(originalSentAt)}`;
}

/** Midnight-to-midnight bounds for a YYYY-MM-DD calendar day in Europe/London. */
export function londonDayBounds(isoDate: string): { gte: Date; lt: Date } | null {
  const match = String(isoDate || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = londonMidnightUtc(year, month, day);
  const next = nextCalendarDay(year, month, day);
  const end = londonMidnightUtc(next.year, next.month, next.day);
  if (!(end.getTime() > start.getTime())) return null;
  const check = londonParts(start);
  if (Number(check.year) !== year || Number(check.month) !== month || Number(check.day) !== day) return null;
  if (check.hour !== "00" || check.minute !== "00") return null;
  return { gte: start, lt: end };
}

function nextCalendarDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + 1);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function londonMidnightUtc(year: number, month: number, day: number): Date {
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = target;
  for (let i = 0; i < 3; i++) {
    const seen = londonParts(new Date(utc));
    const seenUtc = Date.UTC(
      Number(seen.year),
      Number(seen.month) - 1,
      Number(seen.day),
      Number(seen.hour),
      Number(seen.minute),
      Number(seen.second)
    );
    const delta = target - seenUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

/** Search matches reference, UPRN, or part of the address, optionally on the London submitted date. */
export function findCaseWhere(query: string, dateSubmitted: string): Prisma.HhsrsSiteSubmissionWhereInput {
  const and: Prisma.HhsrsSiteSubmissionWhereInput[] = [];
  const q = String(query || "").trim();
  if (q) {
    and.push({
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { uprn: { contains: q, mode: "insensitive" } },
        { fullAddress: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const bounds = londonDayBounds(dateSubmitted);
  if (bounds) and.push({ createdAt: { gte: bounds.gte, lt: bounds.lt } });
  return and.length ? { AND: and } : {};
}

export type SentLogEmail = {
  id: string;
  sentAt: Date;
  sentBy: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  photoNames: string[];
  kind: string;
  correctionReason: string;
  correctionNote: string;
  correctsEmailId: string | null;
  from: string;
};

export type MainLogCardRow = {
  id: string;
  when: string;
  type: "Original" | "Correction";
  sentBy: string;
  to: string;
  subject: string;
  reason: string;
  note: string;
  originalId: string;
};

export function mainLogCardRows(emails: readonly SentLogEmail[]): MainLogCardRow[] {
  const ordered = [...emails].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const original = ordered.find((email) => email.kind !== "correction") || ordered[0];
  return ordered.map((email) => {
    const correction = email.kind === "correction";
    return {
      id: email.id,
      when: formatLondonDateTime(email.sentAt),
      type: correction ? "Correction" : "Original",
      sentBy: email.sentBy,
      to: email.to,
      subject: email.subject,
      reason: correction ? correctionReasonLine(email.correctionReason, email.correctionNote) : "",
      note: correction && original ? correctionOfNote(original.sentAt) : "",
      originalId: original?.id || email.id,
    };
  });
}

export function latestSentLog(emails: readonly SentLogEmail[]): SentLogEmail | null {
  if (!emails.length) return null;
  return [...emails].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())[emails.length - 1];
}

export function originalSentLog(emails: readonly SentLogEmail[]): SentLogEmail | null {
  if (!emails.length) return null;
  const ordered = [...emails].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  return ordered.find((email) => email.kind !== "correction") || ordered[0];
}

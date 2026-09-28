/**
 * Duplicates & errors. A case leaves Pending with a reason. Nothing is deleted.
 * Move back to Pending restores status "new" and clears the current fields.
 * notNeededLog keeps both the move and the restore.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { formatLondonDateTime } from "./hhsrs-find.js";
import { storedNamesForPortalProject } from "./hhsrs-portal-projects.js";
import { isWaitingStatus, reporterCasePhotos, type ReporterCasePhoto } from "./hhsrs-reporter.js";

export const NOT_NEEDED_REASONS = [
  { id: "duplicate", label: "Duplicate", hint: "Already reported" },
  { id: "surveyor_error", label: "Surveyor error", hint: "Wrong details sent" },
  { id: "test", label: "Test", hint: "Test submission" },
  { id: "other", label: "Other", hint: "Say why below" },
] as const;

export type NotNeededReason = (typeof NOT_NEEDED_REASONS)[number]["id"];

export type NotNeededLogEntry = {
  action: "moved" | "restored";
  reason: string;
  duplicateOf: string;
  note: string;
  by: string;
  at: string;
};

const ALREADY_SENT = "This case was already sent. It stays in the Main Log.";

export function isNotNeededReason(value: string): value is NotNeededReason {
  return NOT_NEEDED_REASONS.some((item) => item.id === value);
}

export function notNeededReasonLabel(reason: string): string {
  return NOT_NEEDED_REASONS.find((item) => item.id === reason)?.label || reason || "";
}

export function readNotNeededLog(value: unknown): NotNeededLogEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: NotNeededLogEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const action = row.action === "restored" ? "restored" : row.action === "moved" ? "moved" : "";
    if (!action) continue;
    entries.push({
      action,
      reason: String(row.reason || ""),
      duplicateOf: String(row.duplicateOf || ""),
      note: String(row.note || ""),
      by: String(row.by || ""),
      at: String(row.at || ""),
    });
  }
  return entries;
}

export async function validateNotNeededMove(input: {
  reason: string;
  duplicateOf: string;
  note: string;
  selfReference: string | null;
  findReference: (reference: string) => Promise<{ id: string; reference: string } | null>;
}): Promise<
  | { ok: true; reason: NotNeededReason; duplicateOf: string; note: string }
  | { ok: false; error: string }
> {
  const reason = String(input.reason || "").trim();
  const note = String(input.note || "").trim().slice(0, 2000);
  const wanted = String(input.duplicateOf || "")
    .trim()
    .toUpperCase();
  if (!reason || !isNotNeededReason(reason)) return { ok: false, error: "Pick a reason." };
  if (reason === "other" && !note) return { ok: false, error: "Add a short note." };
  if (reason !== "duplicate") return { ok: true, reason, duplicateOf: "", note };
  if (!wanted) return { ok: false, error: "Enter the reference this duplicates." };
  const self = String(input.selfReference || "")
    .trim()
    .toUpperCase();
  if (self && wanted === self) return { ok: false, error: "A case cannot be a duplicate of itself." };
  const match = await input.findReference(wanted);
  if (!match?.reference) return { ok: false, error: "That reference does not exist." };
  if (self && match.reference.toUpperCase() === self) {
    return { ok: false, error: "A case cannot be a duplicate of itself." };
  }
  return { ok: true, reason, duplicateOf: match.reference, note };
}

type LockedMoveRow = {
  id: string;
  status: string;
  reference: string | null;
  emailSentAt: Date | null;
  notNeededReason: string;
  notNeededDuplicateOf: string;
  notNeededNote: string;
  notNeededBy: string;
  notNeededLog: unknown;
};

async function lockCase(tx: Prisma.TransactionClient, id: string): Promise<LockedMoveRow | null> {
  const rows = await tx.$queryRaw<LockedMoveRow[]>`
    SELECT "id", "status", "reference", "emailSentAt",
           "notNeededReason", "notNeededDuplicateOf", "notNeededNote", "notNeededBy", "notNeededLog"
    FROM "HhsrsSiteSubmission"
    WHERE "id" = ${id}
    FOR UPDATE
  `;
  return rows[0] || null;
}

export async function moveCaseToNotNeeded(args: {
  id: string;
  reason: string;
  duplicateOf: string;
  note: string;
  by: string;
}): Promise<{ ok: true; reference: string } | { ok: false; error: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await lockCase(tx, args.id);
      if (!row) return { ok: false, error: "Case not found." };
      if (row.status === "not_needed") return { ok: false, error: "Already in Duplicates & errors." };
      if (row.emailSentAt || !isWaitingStatus(row.status)) return { ok: false, error: ALREADY_SENT };
      const checked = await validateNotNeededMove({
        reason: args.reason,
        duplicateOf: args.duplicateOf,
        note: args.note,
        selfReference: row.reference,
        findReference: async (reference) => {
          const found = await tx.hhsrsSiteSubmission.findFirst({
            where: { reference: { equals: reference, mode: "insensitive" } },
            select: { id: true, reference: true },
          });
          if (!found?.reference) return null;
          return { id: found.id, reference: found.reference };
        },
      });
      if (!checked.ok) return checked;
      const at = new Date();
      const log = readNotNeededLog(row.notNeededLog);
      log.push({
        action: "moved",
        reason: checked.reason,
        duplicateOf: checked.duplicateOf,
        note: checked.note,
        by: args.by,
        at: at.toISOString(),
      });
      await tx.hhsrsSiteSubmission.update({
        where: { id: row.id },
        data: {
          status: "not_needed",
          notNeededReason: checked.reason,
          notNeededDuplicateOf: checked.duplicateOf,
          notNeededNote: checked.note,
          notNeededBy: args.by,
          notNeededAt: at,
          notNeededLog: log,
          claimedBy: "",
          claimedAt: null,
          lastEditedBy: args.by,
        },
      });
      return { ok: true, reference: row.reference || "" };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not move the case.";
    return { ok: false, error: message };
  }
}

export async function restoreCaseToPending(args: {
  id: string;
  by: string;
}): Promise<{ ok: true; reference: string } | { ok: false; error: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await lockCase(tx, args.id);
      if (!row) return { ok: false, error: "Case not found." };
      if (row.status !== "not_needed") return { ok: false, error: "This case is not in Duplicates & errors." };
      const at = new Date();
      const log = readNotNeededLog(row.notNeededLog);
      log.push({
        action: "restored",
        reason: row.notNeededReason,
        duplicateOf: row.notNeededDuplicateOf,
        note: row.notNeededNote,
        by: args.by,
        at: at.toISOString(),
      });
      await tx.hhsrsSiteSubmission.update({
        where: { id: row.id },
        data: {
          status: "new",
          notNeededReason: "",
          notNeededDuplicateOf: "",
          notNeededNote: "",
          notNeededBy: "",
          notNeededAt: null,
          notNeededLog: log,
          claimedBy: "",
          claimedAt: null,
          lastEditedBy: args.by,
        },
      });
      return { ok: true, reference: row.reference || "" };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not move the case back.";
    return { ok: false, error: message };
  }
}

export type DuplicateCaseView = {
  id: string;
  reference: string;
  projectName: string;
  uprn: string;
  fullAddress: string;
  postcode: string;
  addressLine: string;
  addressFull: string;
  hazard: string;
  rating: string;
  reason: string;
  reasonLabel: string;
  duplicateOf: string;
  duplicateOfId: string;
  note: string;
  movedBy: string;
  movedDate: string;
  movedTime: string;
  surveyDate: string;
  surveyorName: string;
  otherDetails: string;
  comment: string;
  received: string;
  photos: ReporterCasePhoto[];
};

function addressFull(fullAddress: string, postcode: string): string {
  const line = String(fullAddress || "").trim();
  const code = String(postcode || "").trim();
  if (!code) return line;
  if (line.toUpperCase().includes(code.toUpperCase())) return line;
  return line ? `${line}, ${code}` : code;
}

function displaySurveyDate(value: string): string {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value || "").trim();
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export async function loadDuplicates(
  filters: { q?: string; project?: string; reason?: string },
  reporterBase: string
): Promise<DuplicateCaseView[]> {
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
  const refs = [...new Set(rows.map((row) => row.notNeededDuplicateOf).filter(Boolean))];
  const linked = refs.length
    ? await prisma.hhsrsSiteSubmission.findMany({
        where: { reference: { in: refs } },
        select: { id: true, reference: true },
      })
    : [];
  const byRef = new Map(linked.map((row) => [row.reference || "", row.id]));

  return rows.map((row) => {
    const when = row.notNeededAt ? formatLondonDateTime(row.notNeededAt) : "";
    const [movedDate, movedTime] = when.split(" ");
    return {
      id: row.id,
      reference: row.reference || "",
      projectName: row.projectName,
      uprn: row.uprn,
      fullAddress: row.fullAddress,
      postcode: row.postcode,
      addressLine: row.fullAddress,
      addressFull: addressFull(row.fullAddress, row.postcode),
      hazard: row.category,
      rating: row.rating,
      reason: row.notNeededReason,
      reasonLabel: notNeededReasonLabel(row.notNeededReason),
      duplicateOf: row.notNeededDuplicateOf,
      duplicateOfId: byRef.get(row.notNeededDuplicateOf) || "",
      note: row.notNeededNote,
      movedBy: row.notNeededBy,
      movedDate: movedDate || "",
      movedTime: movedTime || "",
      surveyDate: displaySurveyDate(row.surveyDate),
      surveyorName: row.surveyorName,
      otherDetails: row.otherDetails,
      comment: row.comment,
      received: formatLondonDateTime(row.createdAt),
      photos: reporterCasePhotos(row, reporterBase),
    };
  });
}

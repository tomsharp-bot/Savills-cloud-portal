/**
 * Duplicates & errors. A case leaves Pending with a reason. Nothing is deleted.
 * Move back to Pending restores status "new" and clears the current fields.
 * notNeededLog keeps the move, the restore, a "not a duplicate" choice, and an "it's a duplicate" choice.
 * "Not a duplicate" also sets notADuplicate so a later UPRN sweep cannot file the same case again.
 * "It's a duplicate" sets duplicateConfirmed. The pair leaves this list. The newer case stays
 * a pending Dupe until that case is completed or cleared. Nothing is deleted and no email is sent.
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
  action: "moved" | "restored" | "not_duplicate" | "is_duplicate";
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
    const action =
      row.action === "restored"
        ? "restored"
        : row.action === "moved"
          ? "moved"
          : row.action === "not_duplicate"
            ? "not_duplicate"
            : row.action === "is_duplicate"
              ? "is_duplicate"
              : "";
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
      if (row.status === "not_needed") return { ok: false, error: "Already in Duplicates & Errors." };
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
      if (row.status !== "not_needed") return { ok: false, error: "This case is not in Duplicates & Errors." };
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

type NotDuplicateStatus = "new" | "corrected" | "email_sent";

/** Same outcome the Not a duplicate button already applies to its own case. */
function statusAfterNotADuplicate(row: LockedMoveRow, emailKinds: string[]): {
  status: NotDuplicateStatus;
  emailed: boolean;
} {
  const emailed = Boolean(row.emailSentAt) || emailKinds.length > 0;
  if (!emailed) return { status: "new", emailed: false };
  if (emailKinds.some((kind) => kind === "correction")) return { status: "corrected", emailed: true };
  return { status: "email_sent", emailed: true };
}

/** The other card leaves the list only when this comparison filed it as a duplicate. */
function listedDuplicate(row: LockedMoveRow): boolean {
  return row.status === "not_needed" && row.notNeededReason === "duplicate";
}

async function sentEmailKinds(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const byId = new Map<string, string[]>();
  if (!unique.length) return byId;
  const rows = await tx.hhsrsSentEmail.findMany({
    where: { submissionId: { in: unique } },
    select: { submissionId: true, kind: true },
  });
  for (const item of rows) {
    const list = byId.get(item.submissionId) || [];
    list.push(item.kind);
    byId.set(item.submissionId, list);
  }
  return byId;
}

/** Case shown beside this one. A case is never its own comparison partner. */
async function comparisonPartnerId(
  tx: Prisma.TransactionClient,
  duplicateOf: string,
  selfId: string
): Promise<string | null> {
  const wanted = String(duplicateOf || "").trim();
  if (!wanted) return null;
  const found = await tx.hhsrsSiteSubmission.findFirst({
    where: {
      reference: { equals: wanted, mode: "insensitive" },
      NOT: { id: selfId },
    },
    select: { id: true },
  });
  return found?.id || null;
}

async function writeNotADuplicate(
  tx: Prisma.TransactionClient,
  row: LockedMoveRow,
  by: string,
  status: NotDuplicateStatus,
  at: Date
): Promise<void> {
  const log = readNotNeededLog(row.notNeededLog);
  log.push({
    action: "not_duplicate",
    reason: row.notNeededReason,
    duplicateOf: row.notNeededDuplicateOf,
    note: row.notNeededNote,
    by,
    at: at.toISOString(),
  });
  await tx.hhsrsSiteSubmission.update({
    where: { id: row.id },
    data: {
      status,
      notADuplicate: true,
      notNeededReason: "",
      notNeededDuplicateOf: "",
      notNeededNote: "",
      notNeededBy: "",
      notNeededAt: null,
      notNeededLog: log,
      claimedBy: "",
      claimedAt: null,
      lastEditedBy: by,
    },
  });
}

/**
 * The case on the Not a duplicate button is not a duplicate.
 * An unsent case goes back to Pending. A case that was already emailed
 * only leaves Duplicates & errors: the row and its Main Log email stay.
 * notADuplicate stops the UPRN sweep from filing this case again.
 *
 * The other case in that same comparison leaves too, with the same status
 * rules, when it is on the list as a duplicate. A third case, another UPRN,
 * and a case filed for another reason are left alone. A sent email row is
 * not deleted or rewritten.
 */
export async function markCaseNotADuplicate(args: {
  id: string;
  by: string;
}): Promise<
  | {
      ok: true;
      reference: string;
      emailed: boolean;
      partnerReference: string;
      partnerEmailed: boolean;
    }
  | { ok: false; error: string }
> {
  try {
    return await prisma.$transaction(async (tx) => {
      const peek = await tx.hhsrsSiteSubmission.findUnique({
        where: { id: args.id },
        select: { id: true, notNeededDuplicateOf: true },
      });
      if (!peek) return { ok: false, error: "Case not found." };

      const hintedPartnerId = await comparisonPartnerId(tx, peek.notNeededDuplicateOf, peek.id);
      const locked = new Map<string, LockedMoveRow>();
      for (const id of [...new Set([peek.id, ...(hintedPartnerId ? [hintedPartnerId] : [])])].sort()) {
        const row = await lockCase(tx, id);
        if (row) locked.set(row.id, row);
      }

      const row = locked.get(peek.id) || null;
      if (!row) return { ok: false, error: "Case not found." };
      if (row.status !== "not_needed") return { ok: false, error: "This case is not in Duplicates & Errors." };

      const partnerId = await comparisonPartnerId(tx, row.notNeededDuplicateOf, row.id);
      let partner = partnerId ? locked.get(partnerId) || null : null;
      if (partnerId && !partner) partner = await lockCase(tx, partnerId);

      const kinds = await sentEmailKinds(tx, [row.id, ...(partner ? [partner.id] : [])]);
      const decision = statusAfterNotADuplicate(row, kinds.get(row.id) || []);
      const at = new Date();
      await writeNotADuplicate(tx, row, args.by, decision.status, at);

      let partnerReference = "";
      let partnerEmailed = false;
      if (partner && listedDuplicate(partner)) {
        const partnerDecision = statusAfterNotADuplicate(partner, kinds.get(partner.id) || []);
        await writeNotADuplicate(tx, partner, args.by, partnerDecision.status, at);
        partnerReference = partner.reference || "";
        partnerEmailed = partnerDecision.emailed;
      }

      return {
        ok: true,
        reference: row.reference || "",
        emailed: decision.emailed,
        partnerReference,
        partnerEmailed,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update the case.";
    return { ok: false, error: message };
  }
}

async function writeDuplicateConfirmed(
  tx: Prisma.TransactionClient,
  row: LockedMoveRow,
  by: string,
  at: Date
): Promise<void> {
  const log = readNotNeededLog(row.notNeededLog);
  log.push({
    action: "is_duplicate",
    reason: row.notNeededReason,
    duplicateOf: row.notNeededDuplicateOf,
    note: row.notNeededNote,
    by,
    at: at.toISOString(),
  });
  await tx.hhsrsSiteSubmission.update({
    where: { id: row.id },
    data: {
      duplicateConfirmed: true,
      notNeededLog: log,
      lastEditedBy: by,
    },
  });
}

/**
 * The office confirmed this comparison is a duplicate.
 * The newer case stays filed as a duplicate, so Pending still marks it Dupe
 * until that case is completed or cleared. duplicateConfirmed takes the pair
 * off Duplicates & errors. The original already-sent case is not rewritten
 * when it is already in the Main Log. If that original is itself on the list,
 * it leaves too. Neither case is deleted, and no email is sent.
 */
export async function confirmCaseIsADuplicate(args: {
  id: string;
  by: string;
}): Promise<{ ok: true; reference: string; originalId: string } | { ok: false; error: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const peek = await tx.hhsrsSiteSubmission.findUnique({
        where: { id: args.id },
        select: { id: true, notNeededDuplicateOf: true },
      });
      if (!peek) return { ok: false, error: "Case not found." };

      const hintedPartnerId = await comparisonPartnerId(tx, peek.notNeededDuplicateOf, peek.id);
      if (!hintedPartnerId) return { ok: false, error: "The original case was not found." };

      const locked = new Map<string, LockedMoveRow>();
      for (const id of [peek.id, hintedPartnerId].sort()) {
        const row = await lockCase(tx, id);
        if (row) locked.set(row.id, row);
      }

      const row = locked.get(peek.id) || null;
      if (!row) return { ok: false, error: "Case not found." };
      if (row.status !== "not_needed") return { ok: false, error: "This case is not in Duplicates & Errors." };

      const partnerId = await comparisonPartnerId(tx, row.notNeededDuplicateOf, row.id);
      let partner = partnerId ? locked.get(partnerId) || null : null;
      if (partnerId && !partner) partner = await lockCase(tx, partnerId);
      if (!partner) return { ok: false, error: "The original case was not found." };

      const at = new Date();
      await writeDuplicateConfirmed(tx, row, args.by, at);
      if (listedDuplicate(partner)) await writeDuplicateConfirmed(tx, partner, args.by, at);

      return { ok: true, reference: row.reference || "", originalId: partner.id };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update the case.";
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

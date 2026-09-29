/**
 * Same UPRN means the later case is a duplicate, even when the addresses differ.
 * The earliest case stays where it is. Each later waiting case is moved with the
 * existing Duplicates & errors action (reason duplicate, duplicateOf = the earliest
 * reference). Nothing is deleted. A case that was already emailed stays in the
 * Main Log. A case is never a duplicate of itself.
 */
import { prisma } from "./prisma.js";
import { isWaitingStatus } from "./hhsrs-reporter.js";
import { normalizeUprn } from "./hhsrs-site-form.js";
import { moveCaseToNotNeeded } from "./hhsrs-not-needed.js";

export const UPRN_DUPLICATE_MOVED_BY = "HHSRS Reporter";
export const UPRN_DUPLICATE_NOTE = "Same UPRN.";

export type UprnDuplicateCandidate = {
  id: string;
  reference: string | null;
  uprn: string;
  status: string;
  emailSentAt: Date | null;
  createdAt: Date;
};

export type UprnDuplicateMove = {
  id: string;
  reference: string;
  duplicateOf: string;
};

/** Whitespace and letter case are ignored. An empty UPRN matches nothing. */
export function uprnMatchKey(value: string): string {
  return normalizeUprn(value).toUpperCase();
}

function referenceOf(row: UprnDuplicateCandidate): string {
  return String(row.reference || "").trim();
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function byAge(a: UprnDuplicateCandidate, b: UprnDuplicateCandidate): number {
  const delta = a.createdAt.getTime() - b.createdAt.getTime();
  if (delta !== 0) return delta;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Later waiting cases that share a UPRN with an earlier case.
 * The earliest case is the keeper, including when it was already emailed or
 * already sits in Duplicates & errors. Address is not read.
 */
export function planUprnDuplicateMoves(
  cases: UprnDuplicateCandidate[]
): { id: string; duplicateOf: string }[] {
  const groups = new Map<string, UprnDuplicateCandidate[]>();
  for (const row of cases) {
    const key = uprnMatchKey(row.uprn);
    if (!key) continue;
    const createdAt = asDate(row.createdAt);
    if (!createdAt) continue;
    const list = groups.get(key) || [];
    list.push({ ...row, createdAt });
    groups.set(key, list);
  }

  const moves: { id: string; duplicateOf: string }[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(byAge);
    const earliest = ordered[0];
    const keeper = referenceOf(earliest);
    if (!keeper) continue;
    for (const later of ordered.slice(1)) {
      if (later.id === earliest.id) continue;
      const self = referenceOf(later).toUpperCase();
      if (self && self === keeper.toUpperCase()) continue;
      if (later.emailSentAt) continue;
      if (!isWaitingStatus(later.status)) continue;
      moves.push({ id: later.id, duplicateOf: keeper });
    }
  }
  moves.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return moves;
}

type CandidateRow = {
  id: string;
  reference: string | null;
  uprn: string;
  status: string;
  emailSentAt: Date | null;
  createdAt: Date;
};

const QUIET_MOVE_ERRORS = new Set([
  "Already in Duplicates & errors.",
  "This case was already sent. It stays in the Main Log.",
  "Case not found.",
]);

/** Cases that share a UPRN with at least one other case. Address is not compared. */
async function loadUprnDuplicateCandidates(): Promise<UprnDuplicateCandidate[]> {
  const rows = await prisma.$queryRaw<CandidateRow[]>`
    SELECT "id", "reference", "uprn", "status", "emailSentAt", "createdAt"
    FROM "HhsrsSiteSubmission"
    WHERE btrim("uprn") <> ''
      AND regexp_replace(upper(btrim("uprn")), '\\s+', '', 'g') IN (
        SELECT regexp_replace(upper(btrim("uprn")), '\\s+', '', 'g')
        FROM "HhsrsSiteSubmission"
        WHERE btrim("uprn") <> ''
        GROUP BY 1
        HAVING COUNT(*) > 1
      )
  `;
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    uprn: row.uprn,
    status: row.status,
    emailSentAt: asDate(row.emailSentAt),
    createdAt: asDate(row.createdAt) || new Date(0),
  }));
}

/**
 * Move every later waiting case that shares a UPRN. Safe to call on submit and
 * again when a reporter page opens: a case already moved, already emailed, or
 * matching only itself is left alone.
 */
export async function sweepWaitingUprnDuplicates(): Promise<UprnDuplicateMove[]> {
  try {
    const plan = planUprnDuplicateMoves(await loadUprnDuplicateCandidates());
    const moved: UprnDuplicateMove[] = [];
    for (const item of plan) {
      const result = await moveCaseToNotNeeded({
        id: item.id,
        reason: "duplicate",
        duplicateOf: item.duplicateOf,
        note: UPRN_DUPLICATE_NOTE,
        by: UPRN_DUPLICATE_MOVED_BY,
      });
      if (result.ok) {
        moved.push({ id: item.id, reference: result.reference, duplicateOf: item.duplicateOf });
        continue;
      }
      if (!QUIET_MOVE_ERRORS.has(result.error)) {
        console.error(`HHSRS UPRN duplicate move failed for ${item.id}: ${result.error}`);
      }
    }
    return moved;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`HHSRS UPRN duplicate sweep failed: ${detail}`);
    return [];
  }
}

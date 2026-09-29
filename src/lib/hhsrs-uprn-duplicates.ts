/**
 * Same UPRN means every waiting case in the group is a duplicate, even when the
 * addresses differ. All of them move to Duplicates & errors so the office can
 * compare them. Each one notes the other case references. Nothing is deleted.
 * A case that was already emailed stays in the Main Log. A case is never a
 * duplicate of itself.
 */
import { prisma } from "./prisma.js";
import { isWaitingStatus } from "./hhsrs-reporter.js";
import { normalizeUprn } from "./hhsrs-site-form.js";
import { moveCaseToNotNeeded } from "./hhsrs-not-needed.js";

export const UPRN_DUPLICATE_MOVED_BY = "HHSRS Reporter";

/** Note that names every other case with this UPRN. */
export function uprnDuplicateNote(otherReferences: string[]): string {
  const refs = otherReferences.map((ref) => String(ref || "").trim()).filter(Boolean);
  if (!refs.length) return "";
  if (refs.length === 1) return `Same UPRN as ${refs[0]}.`;
  if (refs.length === 2) return `Same UPRN as ${refs[0]} and ${refs[1]}.`;
  return `Same UPRN as ${refs.slice(0, -1).join(", ")} and ${refs[refs.length - 1]}.`;
}

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

function canMove(row: UprnDuplicateCandidate): boolean {
  if (row.emailSentAt) return false;
  return isWaitingStatus(row.status);
}

/** Other references in this UPRN group, earliest first. Skips this case. */
function otherReferences(group: UprnDuplicateCandidate[], self: UprnDuplicateCandidate): string[] {
  const selfRef = referenceOf(self).toUpperCase();
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const row of [...group].sort(byAge)) {
    if (row.id === self.id) continue;
    const ref = referenceOf(row);
    if (!ref) continue;
    const key = ref.toUpperCase();
    if (selfRef && key === selfRef) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

/**
 * Every waiting case that shares a UPRN with another case.
 * duplicateOf is one other reference (the existing link). The note names every
 * other reference, including a case that stays in the Main Log because it was
 * already emailed. Address is not read.
 */
export function planUprnDuplicateMoves(
  cases: UprnDuplicateCandidate[]
): { id: string; duplicateOf: string; note: string }[] {
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

  const moves: { id: string; duplicateOf: string; note: string }[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      if (!canMove(row)) continue;
      const others = otherReferences(group, row);
      if (!others.length) continue;
      moves.push({ id: row.id, duplicateOf: others[0], note: uprnDuplicateNote(others) });
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
 * Move every waiting case that shares a UPRN. Safe to call on submit and
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
        note: item.note,
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

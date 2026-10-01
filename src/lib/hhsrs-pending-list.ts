/**
 * One waiting-case list for Pending Issues and Review and create.
 * Review drops only the case that is already open. A smaller cap on Review
 * (take: 12) left the older waiting cases off that table while Pending,
 * which uses this same cap, still showed them.
 */
import { HHSRS_WAITING_STATUSES } from "./hhsrs-reporter.js";

/** Newest waiting cases. Pending already used 200; Review must not use less. */
export const PENDING_ISSUE_LIST_LIMIT = 200;

export function pendingIssueListArgs() {
  return {
    where: { status: { in: [...HHSRS_WAITING_STATUSES] } },
    orderBy: { createdAt: "desc" as const },
    take: PENDING_ISSUE_LIST_LIMIT,
  };
}

export function withoutOpenCase<T extends { id: string }>(rows: T[], openId?: string | null): T[] {
  if (!openId) return rows;
  return rows.filter((row) => row.id !== openId);
}

/**
 * Cases filed as duplicates. The Dupes tab already lists these. Pending shows
 * the same rows as well; nothing here removes them from either list.
 */
export function pendingDuplicateListArgs() {
  return {
    where: { status: "not_needed" as const, notNeededReason: "duplicate" },
    orderBy: { createdAt: "desc" as const },
  };
}

/** Waiting cases stay as they are. Duplicate filings are added and marked. Newest first. */
export function mergePendingDuplicates<T extends { id: string; createdAt: Date }>(
  waiting: T[],
  duplicates: T[]
): Array<T & { pendingDupe: boolean }> {
  const seen = new Set(waiting.map((row) => row.id));
  const merged: Array<T & { pendingDupe: boolean }> = waiting.map((row) => ({ ...row, pendingDupe: false }));
  for (const row of duplicates) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push({ ...row, pendingDupe: true });
  }
  merged.sort((a, b) => {
    const delta = b.createdAt.getTime() - a.createdAt.getTime();
    if (delta !== 0) return delta;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return merged;
}

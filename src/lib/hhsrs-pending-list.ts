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

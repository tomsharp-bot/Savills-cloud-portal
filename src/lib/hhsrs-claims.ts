/** Office claim on a waiting HHSRS case. Opening Review claims an open case. Stale is a flag only — nobody is auto-assigned. */

export const CLAIM_STALE_MS = 6 * 60 * 60 * 1000;

export type ClaimStatus = "open" | "claimed" | "stale";

export type ClaimView = {
  status: ClaimStatus;
  claimedBy: string;
  claimedAt: string | null;
};

export function claimerLabel(user: { name?: string | null; username?: string | null } | null | undefined): string {
  const name = (user?.name || user?.username || "").trim();
  return name || "someone";
}

export function claimView(
  row: { claimedBy?: string | null; claimedAt?: Date | string | null },
  now: Date = new Date()
): ClaimView {
  const claimedBy = (row.claimedBy || "").trim();
  const claimedAtRaw = row.claimedAt;
  const claimedAt =
    claimedAtRaw instanceof Date
      ? claimedAtRaw
      : claimedAtRaw
        ? new Date(claimedAtRaw)
        : null;
  const claimedAtIso = claimedAt && !Number.isNaN(claimedAt.getTime()) ? claimedAt.toISOString() : null;
  if (!claimedBy) {
    return { status: "open", claimedBy: "", claimedAt: null };
  }
  const age = claimedAtIso ? now.getTime() - new Date(claimedAtIso).getTime() : 0;
  const status: ClaimStatus = claimedAtIso && age >= CLAIM_STALE_MS ? "stale" : "claimed";
  return { status, claimedBy, claimedAt: claimedAtIso };
}

/** Claimed and stale cases stay on the list but do not raise another hazard alert. */
export function isQuietClaim(status: string | null | undefined): boolean {
  return status === "claimed" || status === "stale";
}

export function claimRowClass(status: ClaimStatus): string {
  if (status === "stale") return "row-claim-stale";
  if (status === "claimed") return "row-claimed";
  return "";
}

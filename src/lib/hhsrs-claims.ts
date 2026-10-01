/** Office claim on a waiting HHSRS case. Opening Review claims an open case. Stale is a flag only — the claim stays with that person until they abandon it. */

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

/** The claim owner when `actor` is not that person. Empty when the case is unclaimed or this person holds it. */
export function otherClaimer(claimedBy: string | null | undefined, actor: string | null | undefined): string {
  const owner = String(claimedBy || "").trim();
  if (!owner) return "";
  const who = String(actor || "").trim();
  if (who && owner.toLowerCase() === who.toLowerCase()) return "";
  return owner;
}

export function claimHeldMessage(owner: string): string {
  const name = String(owner || "").trim() || "someone else";
  return `This case is claimed by ${name}. Only they can open or send it until they abandon the claim.`;
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

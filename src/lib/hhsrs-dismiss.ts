/**
 * Dismiss hazard from Review & Create.
 * A waiting case leaves Pending with one of two reasons. No email is sent.
 * Restore puts it back on Review & Create and keeps the reason, so abandon
 * can write the same Main Log line again. A later send clears that line.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { claimHeldMessage, otherClaimer } from "./hhsrs-claims.js";
import { dismissLogLine } from "./hhsrs-office-check.js";
import { isWaitingStatus } from "./hhsrs-reporter.js";

export const DISMISS_HAZARD_REASONS = [
  { id: "test", label: "Test case", hint: "", logLine: "Test case" },
  {
    id: "hazard",
    label: "Dismiss hazard",
    hint: "Reviewed, hazard rating not required.",
    logLine: "Reviewed, hazard rating not required.",
  },
] as const;

export type DismissHazardReason = (typeof DISMISS_HAZARD_REASONS)[number]["id"];

const NOT_PENDING = "This case is not pending.";
const ALREADY_DISMISSED = "Already dismissed.";
const NOT_DISMISSED = "This case is not dismissed.";

export function isDismissHazardReason(value: string): value is DismissHazardReason {
  return DISMISS_HAZARD_REASONS.some((item) => item.id === value);
}

/** Main Log line. The two finish-bar reasons use a fixed line. Older free text keeps its sentence. */
export function dismissHazardLogLine(decision: string, viewedBy = ""): string {
  const match = DISMISS_HAZARD_REASONS.find((item) => item.id === decision);
  if (match) return match.logLine;
  if (!String(decision || "").trim()) return "";
  return dismissLogLine(viewedBy, decision);
}

/** A restored case still carries the reason, so abandon can put the same line back. */
export function parkedDismissDecision(decision: string | null | undefined): boolean {
  return Boolean(String(decision || "").trim());
}

type LockedDismissRow = {
  id: string;
  status: string;
  reference: string | null;
  emailSentAt: Date | null;
  dismissedDecision: string;
  dismissedBy: string;
  dismissedAt: Date | null;
  claimedBy: string;
};

async function lockCase(tx: Prisma.TransactionClient, id: string): Promise<LockedDismissRow | null> {
  const rows = await tx.$queryRaw<LockedDismissRow[]>`
    SELECT "id", "status", "reference", "emailSentAt",
           "dismissedDecision", "dismissedBy", "dismissedAt", "claimedBy"
    FROM "HhsrsSiteSubmission"
    WHERE "id" = ${id}
    FOR UPDATE
  `;
  return rows[0] || null;
}

export async function dismissWaitingCase(args: {
  id: string;
  reason: string;
  by: string;
  actor: string;
  surveyorCheck?: Prisma.InputJsonValue | null;
}): Promise<{ ok: true; reference: string } | { ok: false; error: string }> {
  const reason = String(args.reason || "").trim();
  if (!isDismissHazardReason(reason)) return { ok: false, error: "Pick a reason." };
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await lockCase(tx, args.id);
      if (!row) return { ok: false, error: "Case not found." };
      if (row.status === "dismissed") return { ok: false, error: ALREADY_DISMISSED };
      if (row.emailSentAt || !isWaitingStatus(row.status)) return { ok: false, error: NOT_PENDING };
      const owner = otherClaimer(row.claimedBy, args.actor);
      if (owner) return { ok: false, error: claimHeldMessage(owner) };
      const at = new Date();
      await tx.hhsrsSiteSubmission.update({
        where: { id: row.id },
        data: {
          status: "dismissed",
          dismissedDecision: reason,
          dismissedBy: args.by,
          dismissedAt: at,
          claimedBy: "",
          claimedAt: null,
          lastEditedBy: args.by,
          ...(args.surveyorCheck ? { surveyorCheck: args.surveyorCheck } : {}),
        },
      });
      return { ok: true, reference: row.reference || "" };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not dismiss the hazard.";
    return { ok: false, error: message };
  }
}

/** Back onto Review & Create, claimed by the person who restored it. The reason stays. */
export async function restoreDismissedCase(args: {
  id: string;
  actor: string;
}): Promise<{ ok: true; reference: string } | { ok: false; error: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await lockCase(tx, args.id);
      if (!row) return { ok: false, error: "Case not found." };
      if (row.emailSentAt) return { ok: false, error: NOT_PENDING };
      if (row.status !== "dismissed") return { ok: false, error: NOT_DISMISSED };
      const actor = String(args.actor || "").trim() || "someone";
      await tx.hhsrsSiteSubmission.update({
        where: { id: row.id },
        data: {
          status: "in_review",
          claimedBy: actor,
          claimedAt: new Date(),
          lastEditedBy: actor,
        },
      });
      return { ok: true, reference: row.reference || "" };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not restore the case.";
    return { ok: false, error: message };
  }
}

/**
 * Abandon of a restored dismiss. Status goes back to dismissed.
 * The stored reason, viewer, and time stay, so the Main Log line is unchanged.
 */
export async function returnAbandonedDismiss(args: {
  id: string;
}): Promise<{ ok: true; reference: string } | { ok: false }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await lockCase(tx, args.id);
      if (!row) return { ok: false };
      if (!isWaitingStatus(row.status) || row.emailSentAt || !parkedDismissDecision(row.dismissedDecision)) {
        return { ok: false };
      }
      await tx.hhsrsSiteSubmission.update({
        where: { id: row.id },
        data: {
          status: "dismissed",
          claimedBy: "",
          claimedAt: null,
        },
      });
      return { ok: true, reference: row.reference || "" };
    });
  } catch {
    return { ok: false };
  }
}

/**
 * HHSRS issue references: a project code plus a running number (MTVH-014).
 * Numbers are per project, starting at 001. The counter row is locked so two
 * submits at once cannot take the same number. A unique constraint on the
 * reference is the backstop when two projects share a code.
 *
 * After the go-live wipe of submissions, restart the counters
 * (scripts/reset-hhsrs-reference-counters.ts). Until then the counter stays
 * one past the highest number already used, including backfilled rows.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

const NAMED_CODES: Array<{ test: RegExp; code: string }> = [
  { test: /saxon/, code: "SAXW" },
  { test: /test\s*housing/, code: "TEST" },
  { test: /cornwall/, code: "CORN" },
  { test: /onward/, code: "ONW" },
  { test: /vico/, code: "VICO" },
  { test: /bpha/, code: "BPHA" },
  { test: /metropolitan|\bmtvh\b/, code: "MTVH" },
  { test: /a2d|a2\s*dominion/, code: "A2D" },
];

/** Project code from a project name. Named clients first, otherwise the first four letters. */
export function hhsrsCodeFromProjectName(name: string): string {
  const folded = String(name || "").trim().toLowerCase();
  for (const rule of NAMED_CODES) {
    if (rule.test.test(folded)) return rule.code;
  }
  const letters = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  return letters || "HHSR";
}

export function formatHhsrsReference(code: string, n: number): string {
  const safe = String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const prefix = safe || "HHSR";
  const number = Math.max(1, Math.floor(n));
  return `${prefix}-${String(number).padStart(3, "0")}`;
}

/** Counter key. One row per project, or per name when there is no project row. */
export function referenceCounterKey(projectId: string | null | undefined, projectName: string): string {
  const id = String(projectId || "").trim();
  if (id) return id;
  return `name:${String(projectName || "").trim().toLowerCase()}`;
}

export async function resolveProjectHhsrsCode(
  tx: Prisma.TransactionClient,
  input: { projectId: string | null; projectName: string }
): Promise<string> {
  const projectId = String(input.projectId || "").trim();
  if (projectId) {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { hhsrsCode: true, name: true },
    });
    if (project) {
      const code = project.hhsrsCode.trim() || hhsrsCodeFromProjectName(project.name);
      if (!project.hhsrsCode.trim()) {
        await tx.project.update({ where: { id: projectId }, data: { hhsrsCode: code } });
      }
      return code;
    }
  }
  return hhsrsCodeFromProjectName(input.projectName);
}

/**
 * Take the next reference for this project. Call inside the same transaction
 * that inserts the submission. Holds the counter row so concurrent submits queue.
 */
export async function allocateHhsrsReference(
  tx: Prisma.TransactionClient,
  input: { projectId: string | null; projectName: string }
): Promise<string> {
  const code = await resolveProjectHhsrsCode(tx, input);
  const key = referenceCounterKey(input.projectId, input.projectName);
  await tx.hhsrsReferenceCounter.upsert({
    where: { key },
    create: { key, nextNumber: 1 },
    update: {},
  });
  const locked = await tx.$queryRaw<Array<{ nextNumber: number }>>`
    SELECT "nextNumber" FROM "HhsrsReferenceCounter" WHERE "key" = ${key} FOR UPDATE
  `;
  let n = locked[0]?.nextNumber ?? 1;
  if (!Number.isFinite(n) || n < 1) n = 1;
  let reference = "";
  for (let i = 0; i < 1000; i++) {
    const candidate = formatHhsrsReference(code, n);
    const taken = await tx.hhsrsSiteSubmission.findFirst({
      where: { reference: candidate },
      select: { id: true },
    });
    if (!taken) {
      reference = candidate;
      break;
    }
    n += 1;
  }
  if (!reference) throw new Error("Could not allocate a reference.");
  await tx.hhsrsReferenceCounter.update({ where: { key }, data: { nextNumber: n + 1 } });
  return reference;
}

function isReferenceConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

/** Allocate a reference and insert the submission. Retries if another project just took the same code-number. */
export async function createSubmissionWithReference<T>(
  input: { projectId: string | null; projectName: string },
  create: (tx: Prisma.TransactionClient, reference: string) => Promise<T>
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await prisma.$transaction((tx) =>
        allocateHhsrsReference(tx, input).then((reference) => create(tx, reference))
      );
    } catch (err) {
      last = err;
      if (!isReferenceConflict(err) || attempt === 7) throw err;
    }
  }
  throw last instanceof Error ? last : new Error("Could not allocate a reference.");
}

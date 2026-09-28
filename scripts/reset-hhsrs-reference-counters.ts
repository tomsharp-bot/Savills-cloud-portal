/**
 * Restart HHSRS issue numbers after the go-live data wipe.
 *
 * The counters stay in step with existing submissions. Wiping the submissions
 * does not reset them on its own, so the next issue would continue (MTVH-015
 * instead of MTVH-001). Run this only after those rows are gone:
 *
 *   npx tsx scripts/reset-hhsrs-reference-counters.ts
 *
 * It sets every counter back to 1. If any submissions are still in the database
 * it refuses, so a live counter is not wiped by mistake.
 */
import { prisma } from "../src/lib/prisma.js";

async function main(): Promise<void> {
  const remaining = await prisma.hhsrsSiteSubmission.count();
  if (remaining > 0) {
    console.error(
      `Refusing to restart: ${remaining} HHSRS submission${remaining === 1 ? "" : "s"} still exist. Delete them first, then run this again.`
    );
    process.exitCode = 1;
    return;
  }
  const updated = await prisma.hhsrsReferenceCounter.updateMany({ data: { nextNumber: 1 } });
  console.log(`Reference counters restarted (${updated.count}). The next issue for each project will be 001.`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

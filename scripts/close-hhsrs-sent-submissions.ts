/**
 * Close HHSRS cases that already have a sent email but were left in Pending.
 *
 * The same update ships in migration 20260928201000_hhsrs_close_sent_submissions,
 * which runs on deploy. Use this only to run that close on its own:
 *
 *   npx tsx scripts/close-hhsrs-sent-submissions.ts
 */
import { closeSubmissionsLeftOpenAfterSend } from "../src/lib/hhsrs-close-sent.js";
import { prisma } from "../src/lib/prisma.js";

async function main(): Promise<void> {
  const closed = await closeSubmissionsLeftOpenAfterSend();
  console.log(
    closed === 1
      ? "Closed 1 case that had a sent email but was still open."
      : `Closed ${closed} cases that had a sent email but were still open.`
  );
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

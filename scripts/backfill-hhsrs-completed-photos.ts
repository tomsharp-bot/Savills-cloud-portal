/**
 * Copy HHSRS photos into Spaces for cases already on the Main Log.
 *
 * This does nothing unless you pass a flag. It is not run on startup or deploy.
 * New cases are copied when they are marked as actioned. Use this only to
 * retry failures, or to backfill older Main Log cases on purpose.
 *
 *   npx tsx scripts/backfill-hhsrs-completed-photos.ts
 *     prints this help and exits without copying
 *   npx tsx scripts/backfill-hhsrs-completed-photos.ts --retry-failed
 *     retries cases whose last copy failed
 *   npx tsx scripts/backfill-hhsrs-completed-photos.ts --backfill
 *     copies actioned cases that have never been copied
 */
function wants(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<number> {
  const retry = wants("--retry-failed");
  const backfill = wants("--backfill");
  if (!retry && !backfill) {
    console.log(
      "HHSRS photo copy is off. Pass --retry-failed to retry failed copies, or --backfill to copy older Main Log cases. Nothing was copied."
    );
    return 0;
  }

  const { copyLoggedHhsrsPhotos, listFailedHhsrsCopyIds, listUncopiedActionedIds } = await import(
    "../src/lib/hhsrs-completed-photos.js"
  );
  const { prisma } = await import("../src/lib/prisma.js");
  try {
    const ids = new Set<string>();
    if (retry) {
      for (const id of await listFailedHhsrsCopyIds()) ids.add(id);
    }
    if (backfill) {
      for (const id of await listUncopiedActionedIds()) ids.add(id);
    }

    let copied = 0;
    let failed = 0;
    let skipped = 0;
    for (const id of ids) {
      const result = await copyLoggedHhsrsPhotos(id);
      if (result.status === "copied") copied += 1;
      else if (result.status === "failed") {
        failed += 1;
        console.error(`Copy failed for ${id}: ${result.error}`);
      } else skipped += 1;
    }
    console.log(`Finished. Copied ${copied}, failed ${failed}, skipped ${skipped}.`);
    return failed > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });

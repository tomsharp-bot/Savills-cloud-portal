import type { AssetKind } from "@prisma/client";
import { prisma } from "./prisma.js";
import { isSurveyedStatus } from "./stock-refresh.js";

export type PurgeAsset = {
  id: string;
  kind: AssetKind;
  uprn: string;
  assetStatus: string;
  stockMissing: boolean;
};

export type PurgeRow = {
  id: string;
  kind: AssetKind;
  uprn: string;
  completed: boolean;
};

export type PurgePlan = {
  deleted: PurgeRow[];
  keptCompleted: PurgeRow[];
};

export type PurgeKindCounts = Record<AssetKind, number>;

export type PurgeResult = {
  deleted: number;
  keptCompleted: number;
  includeCompleted: boolean;
  byKind: PurgeKindCounts;
};

const EMPTY_COUNTS: PurgeKindCounts = { dwelling: 0, block: 0, garage: 0 };

export function emptyKindCounts(): PurgeKindCounts {
  return { ...EMPTY_COUNTS };
}

export function planMissingStockPurge(assets: PurgeAsset[], includeCompleted: boolean): PurgePlan {
  const deleted: PurgeRow[] = [];
  const keptCompleted: PurgeRow[] = [];
  for (const asset of assets || []) {
    if (!asset.stockMissing) continue;
    const completed = isSurveyedStatus(asset.assetStatus);
    const row: PurgeRow = { id: asset.id, kind: asset.kind, uprn: asset.uprn, completed };
    if (completed && !includeCompleted) {
      keptCompleted.push(row);
    } else {
      deleted.push(row);
    }
  }
  return { deleted, keptCompleted };
}

export function countByKind(rows: Array<{ kind: AssetKind }>): PurgeKindCounts {
  const counts = emptyKindCounts();
  for (const row of rows) {
    counts[row.kind] += 1;
  }
  return counts;
}

export function formatPurgeNotice(result: PurgeResult): string {
  const kindBits: string[] = [];
  if (result.byKind.dwelling) kindBits.push(`${result.byKind.dwelling} dwelling(s)`);
  if (result.byKind.block) kindBits.push(`${result.byKind.block} block(s)`);
  if (result.byKind.garage) kindBits.push(`${result.byKind.garage} garage(s)`);
  const kindNote = kindBits.length ? ` (${kindBits.join(", ")})` : "";
  let msg = `Removed ${result.deleted} asset(s) marked not on the latest stocklist${kindNote}.`;
  if (!result.includeCompleted && result.keptCompleted) {
    msg += ` Kept ${result.keptCompleted} completed row(s).`;
  }
  return msg + " Summary counts updated.";
}

export async function applyMissingStockPurge(opts: {
  projectId: string;
  includeCompleted: boolean;
}): Promise<PurgeResult> {
  const existing = await prisma.asset.findMany({
    where: { projectId: opts.projectId, stockMissing: true },
    select: { id: true, kind: true, uprn: true, assetStatus: true, stockMissing: true },
  });
  const plan = planMissingStockPurge(existing, opts.includeCompleted);
  if (plan.deleted.length) {
    await prisma.asset.deleteMany({
      where: { id: { in: plan.deleted.map((row) => row.id) } },
    });
  }
  return {
    deleted: plan.deleted.length,
    keptCompleted: plan.keptCompleted.length,
    includeCompleted: opts.includeCompleted,
    byKind: countByKind(plan.deleted),
  };
}

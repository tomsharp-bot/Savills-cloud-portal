import { cellVal } from "./asset-status.js";
import type { RawRow } from "./excel.js";
import { prisma } from "./prisma.js";
import { extractUprn } from "./stock-refresh.js";

export function isTruthyFlag(v: unknown): boolean {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "yes" || s === "true" || s === "y" || s === "1" || s === "external" || s === "ext" || s === "ext-only" || s === "ext only";
}

export function flaggedUprnsFromRows(rows: RawRow[], flagCol: string): string[] {
  const out: string[] = [];
  for (const raw of rows || []) {
    const uprn = extractUprn(raw);
    if (!uprn) continue;
    let flag = cellVal(raw, flagCol);
    if (flag === "" || flag == null) {
      flag = cellVal(raw, "External") || cellVal(raw, "Ext") || cellVal(raw, "Ext-Only") || cellVal(raw, "External Only");
    }
    if (isTruthyFlag(flag)) out.push(uprn);
  }
  return [...new Set(out)];
}

export async function applyExternalUprnSet(projectId: string, uprns: string[]): Promise<{ matched: number; flagged: number }> {
  const unique = [...new Set(uprns.map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (!unique.length) return { matched: 0, flagged: 0 };
  // One UPDATE per chunk. Loading every asset to flip a flag OOM'd the small instance on ~44k stock.
  let matched = 0;
  const size = 2000;
  for (let i = 0; i < unique.length; i += size) {
    const chunk = unique.slice(i, i + size);
    const result = await prisma.asset.updateMany({
      where: { projectId, uprn: { in: chunk } },
      data: { external: "Yes", assetStatus: "Ext-Only" },
    });
    matched += result.count;
  }
  return { matched, flagged: unique.length };
}

export async function persistExternalLink(opts: {
  projectId: string;
  fileName: string;
  flagCol: string;
  uprns: string[];
}): Promise<void> {
  await prisma.externalLink.upsert({
    where: { projectId: opts.projectId },
    update: { fileName: opts.fileName, flagCol: opts.flagCol, uprns: opts.uprns, linkedAt: new Date() },
    create: { projectId: opts.projectId, fileName: opts.fileName, flagCol: opts.flagCol, uprns: opts.uprns },
  });
}

export async function reapplyExternalLink(projectId: string): Promise<{ matched: number; flagged: number; fileName?: string } | null> {
  const link = await prisma.externalLink.findUnique({ where: { projectId } });
  if (!link) return null;
  const uprns = Array.isArray(link.uprns) ? (link.uprns as string[]) : [];
  const res = await applyExternalUprnSet(projectId, uprns);
  return { ...res, fileName: link.fileName };
}

export async function reapplyAllExternalLinks(): Promise<void> {
  const links = await prisma.externalLink.findMany();
  for (const link of links) {
    const uprns = Array.isArray(link.uprns) ? (link.uprns as string[]) : [];
    await applyExternalUprnSet(link.projectId, uprns);
  }
}

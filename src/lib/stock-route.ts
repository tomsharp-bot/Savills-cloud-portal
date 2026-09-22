import type { AssetKind } from "@prisma/client";
import { inferStockKind, rowHasNonBlockResidentialType } from "./asset-status.js";

export type StockRouteTarget = "auto" | AssetKind;

/**
 * Archetype → stock tab. Auto uses inferStockKind; an explicit Dwellings, Blocks,
 * or Garages target keeps that tab. The stocklist uploader calls this.
 */
export function routeStockRow(
  raw: Record<string, unknown> | null | undefined,
  target: StockRouteTarget = "auto"
): AssetKind {
  if (target !== "auto") return target;
  return inferStockKind(raw);
}

function headerKey(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, "");
}

/** First UPRN wins; blank UPRNs are skipped. Same rule as the stocklist plan. */
export function uprnOf(raw: Record<string, unknown> | null | undefined): string {
  if (!raw) return "";
  for (const key of Object.keys(raw)) {
    if (headerKey(key) !== "uprn") continue;
    const value = String(raw[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** How many file rows Auto (or an explicit target) sends to each tab. */
export function countRoutedStock(
  rows: Array<Record<string, unknown>> | null | undefined,
  target: StockRouteTarget = "auto"
): Record<AssetKind, number> {
  const counts: Record<AssetKind, number> = { dwelling: 0, block: 0, garage: 0 };
  const seen = new Set<string>();
  for (const raw of rows || []) {
    const uprn = uprnOf(raw);
    if (!uprn || seen.has(uprn)) continue;
    seen.add(uprn);
    counts[routeStockRow(raw, target)] += 1;
  }
  return counts;
}

/**
 * Admin notice when a stocklist clearly contains homes, those homes were inserted,
 * and the upload still added 0 dwellings while adding blocks (the Leeds miscount).
 * Stays quiet for an explicit Blocks/Dwellings/Garages target, and when the homes
 * were already on the project (matched, not inserted).
 */
export function dwellingMisrouteWarning(opts: {
  rows: Array<Record<string, unknown>> | null | undefined;
  addedByTab: Record<AssetKind, number>;
  addedUprns: string[];
  target?: StockRouteTarget;
}): string | null {
  if ((opts.target ?? "auto") !== "auto") return null;
  if (opts.addedByTab.dwelling !== 0 || opts.addedByTab.block <= 0) return null;
  const added = new Set(opts.addedUprns.map((uprn) => String(uprn).trim()).filter(Boolean));
  const seen = new Set<string>();
  let residentialInserted = false;
  for (const raw of opts.rows || []) {
    const uprn = uprnOf(raw);
    if (!uprn || seen.has(uprn)) continue;
    seen.add(uprn);
    if (!added.has(uprn)) continue;
    if (rowHasNonBlockResidentialType(raw)) {
      residentialInserted = true;
      break;
    }
  }
  if (!residentialInserted) return null;
  const blocks = opts.addedByTab.block;
  return (
    `Warning: this file includes house, flat, bungalow, or other residential rows, ` +
    `but 0 dwellings were added and ${blocks} ${blocks === 1 ? "block was" : "blocks were"} added. ` +
    `Those homes were not counted on Dwellings. Summary will not match the stocklist until Auto routing is corrected.`
  );
}

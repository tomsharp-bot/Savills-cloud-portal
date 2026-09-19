import type { Asset, AssetKind } from "@prisma/client";
import * as XLSX from "xlsx";
import { formatStockDate } from "./dates.js";
import { parseExportScope, STOCK_DATE_COLS, STOCK_LABELS, stockColumns, stockTabTitle } from "./stock-columns.js";

export type ExportAsset = Asset & { agency?: string };

export function stockExportCell(asset: ExportAsset, col: string): string {
  if (col === "omitAsset") return asset.omitAsset ? "Yes" : "";
  if (col === "agency") return String(asset.agency || "");
  if (STOCK_DATE_COLS.has(col)) return formatStockDate((asset as Record<string, unknown>)[col]);
  const v = (asset as Record<string, unknown>)[col];
  return v == null ? "" : String(v);
}

export function assetToExportRow(asset: ExportAsset, kind: AssetKind): Record<string, string> {
  const row: Record<string, string> = {};
  for (const col of stockColumns(kind)) {
    row[STOCK_LABELS[col] || col] = stockExportCell(asset, col);
  }
  return row;
}

export function buildStockWorkbook(
  groups: { kind: AssetKind; rows: ExportAsset[] }[]
): Buffer {
  const wb = XLSX.utils.book_new();
  for (const group of groups) {
    const cols = stockColumns(group.kind);
    const headers = cols.map((c) => STOCK_LABELS[c] || c);
    const data = group.rows.map((r) => assetToExportRow(r, group.kind));
    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    XLSX.utils.book_append_sheet(wb, ws, stockTabTitle(group.kind));
  }
  if (!wb.SheetNames.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["No stock"]]), "Stock");
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function stockExportFilename(projectName: string, scope: unknown): string {
  const safe = String(projectName || "project")
    .replace(/[^\w\s.-]+/g, "")
    .trim()
    .replace(/\s+/g, "-") || "project";
  const parsed = parseExportScope(scope);
  const suffix = parsed === "all" ? "stocklist" : `${stockTabTitle(parsed).toLowerCase()}-stocklist`;
  return `${safe}-${suffix}.xlsx`;
}

export { parseExportScope };

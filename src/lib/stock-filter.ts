import { STOCK_SELECT_COLS } from "./stock-columns.js";

export type StockFilterRow = Record<string, unknown>;

/** Named-field lookup so Asset Status never falls through to Survey Type or Site Comments. */
export function stockFilterCellText(row: StockFilterRow, column: string): string {
  if (column === "omitAsset") return row.omitAsset ? "omitted" : "included";
  if (Object.prototype.hasOwnProperty.call(row, column) && row[column] != null) {
    return String(row[column]).trim();
  }
  return "";
}

export function stockRowMatchesFilters(
  row: StockFilterRow,
  filters: Record<string, string>,
  selectCols: Set<string> = STOCK_SELECT_COLS
): boolean {
  for (const [key, raw] of Object.entries(filters)) {
    const q = String(raw ?? "").trim().toLowerCase();
    if (!q) continue;
    const text = stockFilterCellText(row, key).toLowerCase();
    if (selectCols.has(key) || key === "omitAsset") {
      if (text !== q) return false;
    } else if (!text.includes(q)) {
      return false;
    }
  }
  return true;
}

export function filterStockRows<T extends StockFilterRow>(
  rows: T[],
  filters: Record<string, string>
): T[] {
  return rows.filter((row) => stockRowMatchesFilters(row, filters));
}

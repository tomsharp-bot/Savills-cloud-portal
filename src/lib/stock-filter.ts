import { formatStockDate } from "./dates.js";
import { epcRequiredFlag } from "./epc-survey.js";
import { STOCK_DATE_COLS, STOCK_SELECT_COLS } from "./stock-columns.js";

export type StockFilterRow = Record<string, unknown>;

/** Select value for an empty cell. A blank option value would mean "All". */
export const BLANK_FILTER = "__blank__";

/** Select value for every cell that has text. Distinct from All, which clears the filter. */
export const NONBLANK_FILTER = "__nonblank__";

/** Named-field lookup so Asset Status never falls through to Survey Type or Site Comments. */
export function stockFilterCellText(row: StockFilterRow, column: string): string {
  if (column === "omitAsset") return row.omitAsset ? "omitted" : "included";
  if (column === "epcRequired") return epcRequiredFlag(row.epcRequired) ? "YES" : "";
  if (Object.prototype.hasOwnProperty.call(row, column) && row[column] != null) {
    const raw = row[column];
    if (STOCK_DATE_COLS.has(column)) return formatStockDate(raw).trim();
    return String(raw).trim();
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
    const exact = selectCols.has(key) || key === "omitAsset";
    if (q === BLANK_FILTER) {
      if (text !== "") return false;
    } else if (q === NONBLANK_FILTER) {
      if (text === "") return false;
    } else if (exact) {
      if (text !== q) return false;
    } else if (!text.includes(q)) {
      return false;
    }
  }
  return true;
}

export function filterStockRows<T extends StockFilterRow>(
  rows: T[],
  filters: Record<string, string>,
  selectCols?: Set<string>
): T[] {
  return rows.filter((row) => stockRowMatchesFilters(row, filters, selectCols));
}

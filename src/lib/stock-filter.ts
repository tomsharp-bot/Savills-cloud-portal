import { formatStockDate } from "./dates.js";
import { epcRequiredFlag } from "./epc-survey.js";
import { STOCK_DATE_COLS, STOCK_SELECT_COLS } from "./stock-columns.js";

export type StockFilterRow = Record<string, unknown>;

/** Select value for an empty cell. A blank option value would mean "All". */
export const BLANK_FILTER = "__blank__";

/**
 * Select value for every cell that has text.
 * Distinct from All, which clears the filter.
 * An empty string and whitespace-only text are blank, the same as NULL.
 */
export const NONBLANK_FILTER = "__nonblank__";

/** One column can carry several chosen values. A text filter stays a single string. */
export type StockFilterMap = Record<string, string | readonly string[]>;

/**
 * Values chosen for one column.
 * A repeated query key arrives as an array. The query parser turns a long
 * repeated key into an object once it passes its array limit, so that shape
 * counts too. A single string is one value, not a list of characters.
 */
export function stockFilterValues(raw: unknown): string[] {
  if (raw == null) return [];
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "object"
      ? Object.values(raw as Record<string, unknown>)
      : [raw];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (Array.isArray(item) || (item != null && typeof item === "object")) {
      for (const nested of stockFilterValues(item)) {
        const key = nested.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(nested);
      }
      continue;
    }
    const value = String(item ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

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

function cellMatchesFilterValue(text: string, q: string, exact: boolean): boolean {
  if (q === BLANK_FILTER) return text === "";
  if (q === NONBLANK_FILTER) return text !== "";
  if (exact) return text === q;
  return text.includes(q);
}

/**
 * A row matches a column when its cell is any of the selected values.
 * Filters on different columns all have to match.
 */
export function stockRowMatchesFilters(
  row: StockFilterRow,
  filters: StockFilterMap,
  selectCols: Set<string> = STOCK_SELECT_COLS
): boolean {
  for (const [key, raw] of Object.entries(filters)) {
    const values = stockFilterValues(raw).map((value) => value.toLowerCase());
    if (!values.length) continue;
    const text = stockFilterCellText(row, key).toLowerCase();
    const exact = selectCols.has(key) || key === "omitAsset";
    if (!values.some((q) => cellMatchesFilterValue(text, q, exact))) return false;
  }
  return true;
}

export function filterStockRows<T extends StockFilterRow>(
  rows: T[],
  filters: StockFilterMap,
  selectCols?: Set<string>
): T[] {
  return rows.filter((row) => stockRowMatchesFilters(row, filters, selectCols));
}

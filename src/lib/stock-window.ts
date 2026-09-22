import { assetStatusFilterOptions } from "./asset-status.js";
import { STOCK_SELECT_COLS } from "./stock-columns.js";
import { filterStockRows, type StockFilterRow } from "./stock-filter.js";
import {
  STOCK_SELECT_OPTION_CAP,
  collectSelectOptions,
  exactFilterColumns,
  parseStockListQuery,
  sortStockRows,
  stockPageLabel,
  type StockSortDir,
} from "./stock-page.js";

/** Rows mounted in the DOM for one stock window. Far below the ~5k full-table crash. */
export const STOCK_WINDOW_SIZE = 100;

/** Hard ceiling. A client cannot ask the server to render tens of thousands of rows. */
export const STOCK_WINDOW_MAX = 150;

/** Fixed row height used by the virtual spacers. CSS keeps every data row at this height. */
export const STOCK_ROW_HEIGHT = 40;

export type StockWindowRequest = {
  offset: number;
  limit: number;
  sort: string;
  dir: StockSortDir;
  filters: Record<string, string>;
  exact: Set<string>;
};

export interface StockGateway<T> {
  total(): Promise<number>;
  matched(req: Pick<StockWindowRequest, "filters" | "exact">): Promise<number>;
  /** Return at most `limit` rows. Implementations must not materialise the whole tab. */
  page(req: StockWindowRequest): Promise<T[]>;
  options(): Promise<Record<string, string[]>>;
}

export function clampStockWindowLimit(raw: unknown): number {
  if (raw == null || raw === "") return STOCK_WINDOW_SIZE;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return STOCK_WINDOW_SIZE;
  return Math.min(Math.floor(n), STOCK_WINDOW_MAX);
}

export function parseStockWindowQuery(query: Record<string, unknown>, columns: readonly string[]) {
  const base = parseStockListQuery(query, columns);
  const limit = clampStockWindowLimit(query.limit);
  let offset = parseInt(String(query.offset ?? ""), 10);
  if (!Number.isFinite(offset) || offset < 0) {
    offset = base.page > 1 ? (base.page - 1) * limit : 0;
  }
  return { ...base, offset: Math.floor(offset), limit, pageSize: limit };
}

export function virtualPadHeights(
  matched: number,
  offset: number,
  shown: number,
  rowHeight = STOCK_ROW_HEIGHT
): { top: number; bottom: number } {
  const height = rowHeight > 0 ? rowHeight : STOCK_ROW_HEIGHT;
  return {
    top: Math.max(0, offset) * height,
    bottom: Math.max(0, matched - Math.max(0, offset) - Math.max(0, shown)) * height,
  };
}

/** First data-row index that should be on screen for a scroll position. */
export function stockVirtualStart(scrollTop: number, rowHeight = STOCK_ROW_HEIGHT): number {
  const height = rowHeight > 0 ? rowHeight : STOCK_ROW_HEIGHT;
  return Math.floor(Math.max(0, scrollTop) / height);
}

function compareOption(a: string, b: string): number {
  return a.localeCompare(b, "en-GB", { numeric: true, sensitivity: "base" });
}

/** Turn a capped distinct probe into the dropdown map the grid already uses. */
export function optionsFromProbes(
  columns: readonly string[],
  probes: Array<{ column_name: string; value: string | null }>
): Record<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const probe of probes) {
    const list = grouped.get(probe.column_name) ?? [];
    list.push(probe.value == null ? "" : String(probe.value).trim());
    grouped.set(probe.column_name, list);
  }
  const out: Record<string, string[]> = {};
  for (const col of columns) {
    if (!STOCK_SELECT_COLS.has(col) || col === "epcRequired" || col === "omitAsset") continue;
    const vals = grouped.get(col) ?? [];
    if (vals.length > STOCK_SELECT_OPTION_CAP) continue;
    if (col === "assetStatus") {
      const statuses = assetStatusFilterOptions(vals);
      if (statuses.length <= STOCK_SELECT_OPTION_CAP) out[col] = statuses;
      continue;
    }
    const unique = [...new Set(vals)];
    unique.sort(compareOption);
    out[col] = unique;
  }
  return out;
}

export async function assembleStockWindow<T>(
  gateway: StockGateway<T>,
  columns: readonly string[],
  query: Record<string, unknown>
) {
  const parsed = parseStockWindowQuery(query, columns);
  const [options, total] = await Promise.all([gateway.options(), gateway.total()]);
  const exact = exactFilterColumns(options);
  const hasFilters = Object.values(parsed.filters).some((value) => String(value || "").trim());
  const matched = hasFilters ? await gateway.matched({ filters: parsed.filters, exact }) : total;
  const limit = parsed.limit;
  const offset = matched === 0 ? 0 : Math.min(parsed.offset, Math.max(0, matched - 1));
  const rows = matched === 0 ? [] : await gateway.page({ ...parsed, exact, offset, limit });
  const page = {
    rows,
    total,
    matched,
    offset,
    limit,
    page: 1,
    pageSize: limit,
    pageCount: 1,
    from: rows.length ? offset + 1 : 0,
    to: offset + rows.length,
    sort: parsed.sort,
    dir: parsed.dir,
  };
  return {
    listQuery: parsed,
    page,
    filterOptions: options,
    label: stockPageLabel(page),
    stockFiltered: total > 0 && matched === 0,
  };
}

/** Test double: filters the full array, but only returns the requested window. */
export function memoryStockGateway<T extends StockFilterRow>(
  rows: T[],
  columns: readonly string[]
): StockGateway<T> {
  return {
    async total() {
      return rows.length;
    },
    async matched(req) {
      return filterStockRows(rows, req.filters, req.exact).length;
    },
    async page(req) {
      const filtered = filterStockRows(rows, req.filters, req.exact);
      const sorted = sortStockRows(filtered, req.sort, req.dir);
      return sorted.slice(req.offset, req.offset + req.limit);
    },
    async options() {
      return collectSelectOptions(rows, columns);
    },
  };
}

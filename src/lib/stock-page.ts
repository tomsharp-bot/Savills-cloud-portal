import type { AssetKind } from "@prisma/client";
import { assetStatusFilterOptions } from "./asset-status.js";
import { STOCK_SELECT_COLS } from "./stock-columns.js";
import { filterStockRows, stockFilterCellText, type StockFilterRow } from "./stock-filter.js";

/** One page of stock rows. The grid never mounts more than this many `<tr>`s. */
export const STOCK_PAGE_SIZE = 100;

/**
 * A select with one option per distinct visit or letter date will freeze the
 * browser once a stocklist is tens of thousands of rows. Above this, that
 * column is a text filter instead.
 */
export const STOCK_SELECT_OPTION_CAP = 80;

export function stockKindFromTab(tab: string): AssetKind | null {
  if (tab === "dwellings" || tab === "dwelling") return "dwelling";
  if (tab === "blocks" || tab === "block") return "block";
  if (tab === "garages" || tab === "garage") return "garage";
  return null;
}

export type StockSortDir = "asc" | "desc";

export type StockListQuery = {
  page: number;
  pageSize: number;
  sort: string;
  dir: StockSortDir;
  filters: Record<string, string>;
};

export type StockPage<T> = {
  rows: T[];
  /** Rows in the tab before filters. */
  total: number;
  /** Rows that match the current filters. */
  matched: number;
  page: number;
  pageSize: number;
  pageCount: number;
  from: number;
  to: number;
  sort: string;
  dir: StockSortDir;
};

export function clampStockPageSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return STOCK_PAGE_SIZE;
  return Math.min(Math.floor(n), STOCK_PAGE_SIZE);
}

export function parseStockListQuery(
  query: Record<string, unknown>,
  columns: readonly string[]
): StockListQuery {
  const pageRaw = parseInt(String(query.page ?? "1"), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const sortRaw = String(query.sort ?? "");
  const sort = columns.includes(sortRaw) ? sortRaw : columns.includes("uprn") ? "uprn" : columns[0] || "uprn";
  const dir: StockSortDir = String(query.dir ?? "").toLowerCase() === "desc" ? "desc" : "asc";
  const filters: Record<string, string> = {};
  for (const col of columns) {
    const raw = query[`f_${col}`];
    if (raw == null) continue;
    const value = String(Array.isArray(raw) ? raw[0] : raw);
    if (value.trim()) filters[col] = value;
  }
  return { page, pageSize: clampStockPageSize(query.pageSize), sort, dir, filters };
}

function compareStockText(a: string, b: string): number {
  return a.localeCompare(b, "en-GB", { numeric: true, sensitivity: "base" });
}

export function sortStockRows<T extends StockFilterRow>(rows: T[], sort: string, dir: StockSortDir): T[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const primary = compareStockText(stockFilterCellText(a, sort), stockFilterCellText(b, sort));
    if (primary !== 0) return primary * sign;
    return compareStockText(stockFilterCellText(a, "uprn"), stockFilterCellText(b, "uprn"));
  });
}

/**
 * Filter and sort the full tab, then return one page.
 * Filtering only the current page would hide matches that sit on later pages.
 */
export function buildStockPage<T extends StockFilterRow>(
  rows: T[],
  query: StockListQuery,
  columns: readonly string[],
  exactCols?: Set<string>
): StockPage<T> {
  const pageSize = clampStockPageSize(query.pageSize);
  const filtered = filterStockRows(rows, query.filters, exactCols);
  const sort = columns.includes(query.sort) ? query.sort : columns.includes("uprn") ? "uprn" : columns[0] || "uprn";
  const sorted = sortStockRows(filtered, sort, query.dir);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, query.page || 1), pageCount);
  const start = (page - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);
  return {
    rows: slice,
    total: rows.length,
    matched: sorted.length,
    page,
    pageSize,
    pageCount,
    from: slice.length ? start + 1 : 0,
    to: start + slice.length,
    sort,
    dir: query.dir === "desc" ? "desc" : "asc",
  };
}

export function stockPageLabel(page: Pick<StockPage<unknown>, "from" | "to" | "matched" | "total">): string {
  const total = page.total.toLocaleString("en-GB");
  const matched = page.matched.toLocaleString("en-GB");
  if (page.matched === 0) return `0 of ${total} Assets Displayed`;
  const range = `${page.from.toLocaleString("en-GB")}–${page.to.toLocaleString("en-GB")}`;
  if (page.matched !== page.total) {
    return `Showing ${range} of ${matched} Assets (${total} in this tab)`;
  }
  return `Showing ${range} of ${matched} Assets`;
}

export function stockPagerLabel(page: Pick<StockPage<unknown>, "page" | "pageCount">): string {
  return `Page ${page.page} of ${page.pageCount}`;
}

/** Dropdown values from the whole tab, not the visible page. High-cardinality columns are omitted. */
export function collectSelectOptions(
  rows: StockFilterRow[],
  columns: readonly string[]
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const col of columns) {
    if (!STOCK_SELECT_COLS.has(col) || col === "epcRequired" || col === "omitAsset") continue;
    if (col === "assetStatus") {
      const statuses = assetStatusFilterOptions(rows.map((row) => stockFilterCellText(row, col)));
      if (statuses.length <= STOCK_SELECT_OPTION_CAP) out[col] = statuses;
      continue;
    }
    const vals = [...new Set(rows.map((row) => stockFilterCellText(row, col)))];
    if (vals.length > STOCK_SELECT_OPTION_CAP) continue;
    vals.sort(compareStockText);
    out[col] = vals;
  }
  return out;
}

/** Columns that render as a dropdown. Anything else, including a capped select, is a contains-match. */
export function exactFilterColumns(filterOptions: Record<string, string[]>): Set<string> {
  const exact = new Set<string>(Object.keys(filterOptions));
  exact.add("omitAsset");
  exact.add("epcRequired");
  return exact;
}

export function assembleStockTab<T extends StockFilterRow>(
  rows: T[],
  columns: readonly string[],
  query: Record<string, unknown>
) {
  const listQuery = parseStockListQuery(query, columns);
  const filterOptions = collectSelectOptions(rows, columns);
  const page = buildStockPage(rows, listQuery, columns, exactFilterColumns(filterOptions));
  return {
    listQuery,
    page,
    filterOptions,
    label: stockPageLabel(page),
    pagerLabel: stockPagerLabel(page),
    stockFiltered: page.total > 0 && page.matched === 0,
  };
}

export function attachAgency<T extends { surveyedBy?: string | null; surveyor?: string | null }>(
  rows: T[],
  agencyByInitials: Map<string, string>
): (T & { agency: string })[] {
  return rows.map((row) => {
    const tokens = [row.surveyedBy, row.surveyor].map((value) => String(value || "").trim()).filter(Boolean);
    let agency = "";
    for (const token of tokens) {
      const hit = agencyByInitials.get(token.toUpperCase());
      if (hit) {
        agency = hit;
        break;
      }
    }
    return { ...row, agency };
  });
}

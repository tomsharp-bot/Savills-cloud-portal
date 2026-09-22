import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ejs from "ejs";
import { STOCK_DATE_COLS, STOCK_LABELS, STOCK_SELECT_COLS, stockColumns } from "./stock-columns.js";
import { formatStockDate } from "./dates.js";
import {
  STOCK_PAGE_SIZE,
  STOCK_SELECT_OPTION_CAP,
  assembleStockTab,
  buildStockPage,
  clampStockPageSize,
  collectSelectOptions,
  parseStockListQuery,
  stockPageLabel,
} from "./stock-page.js";

const root = process.cwd();

function row(uprn: string, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${uprn}`,
    uprn,
    assetStatus: "No Visit",
    surveyType: "Condition Only",
    siteComments: "",
    street: "Low Street",
    omitAsset: false,
    stockMissing: false,
    epcRequired: false,
    surveyDate: "",
    ...extra,
  };
}

describe("Stock paging", () => {
  it("returns one page of a large list and still filters the whole set", () => {
    const rows = Array.from({ length: 5000 }, (_, i) =>
      row(String(i).padStart(5, "0"), { street: i % 20 === 0 ? "High Street" : "Low Street" })
    );
    const columns = stockColumns("dwelling", { includeAdminOnly: false });
    const query = parseStockListQuery({ page: "2", pageSize: "100", f_street: "high" }, columns);
    const page = buildStockPage(rows, query, columns);
    assert.equal(page.pageSize, 100);
    assert.equal(page.total, 5000);
    assert.equal(page.matched, 250);
    assert.equal(page.rows.length, 100);
    assert.ok(page.rows.every((item) => String(item.street).includes("High")));
    assert.equal(page.rows[0].uprn, rows.filter((item) => item.street === "High Street")[100].uprn);
    assert.equal(clampStockPageSize(40000), STOCK_PAGE_SIZE);
  });

  it("sorts the full filtered set before slicing the page", () => {
    const rows = [row("2", { street: "Zebra" }), row("1", { street: "Alpha" }), row("3", { street: "Middle" })];
    const columns = ["uprn", "street"];
    const query = parseStockListQuery({ sort: "street", dir: "asc", pageSize: "1", page: "2" }, columns);
    const page = buildStockPage(rows, query, columns);
    assert.equal(page.rows[0].street, "Middle");
    assert.equal(page.matched, 3);
  });

  it("does not render a DOM row per asset when given thousands of records", async () => {
    const columns = stockColumns("dwelling", { includeAdminOnly: false });
    const rows = Array.from({ length: 4000 }, (_, i) => row(String(i)));
    const page = buildStockPage(rows, parseStockListQuery({ page: "1" }, columns), columns);
    assert.equal(page.rows.length, STOCK_PAGE_SIZE);
    const template = readFileSync(join(root, "views/partials/stock-rows.ejs"), "utf8");
    const html = ejs.render(
      template,
      {
        rows,
        cols: columns,
        stockPageSize: STOCK_PAGE_SIZE,
        stockFiltered: false,
        isAdmin: false,
        isSurveyor: false,
        formatStockDate,
        stockDateCols: STOCK_DATE_COLS,
        adminEditCols: [],
      },
      { filename: join(root, "views/partials/stock-rows.ejs") }
    );
    const nodes = html.match(/data-asset=/g) || [];
    assert.equal(nodes.length, STOCK_PAGE_SIZE);
    assert.match(html, /data-asset="id-0"/);
    assert.doesNotMatch(html, /data-asset="id-100"/);
    assert.equal(page.rows.length, nodes.length);
    assert.match(stockPageLabel(page), /Showing 1–100 of 4,000 Assets/);
  });

  it("turns a high-cardinality column into a text filter instead of one option per asset", () => {
    const columns = stockColumns("dwelling", { includeAdminOnly: true });
    const rows = Array.from({ length: 4000 }, (_, i) =>
      row(String(i), {
        surveyDate: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
        letterDate1: `NOTE-${i}-END`,
        archetype: "House",
      })
    );
    const options = collectSelectOptions(rows, columns);
    assert.ok(options.surveyDate);
    assert.ok(options.surveyDate.length <= STOCK_SELECT_OPTION_CAP);
    assert.equal(options.letterDate1, undefined);
    assert.ok(options.archetype);
    const tab = assembleStockTab(rows, columns, { f_letterDate1: "NOTE-10-END" });
    assert.equal(tab.page.matched, 1);
    assert.equal(tab.page.rows[0].uprn, "10");
    assert.equal(tab.page.rows.length, 1);

    const template = readFileSync(join(root, "views/partials/stock-table.ejs"), "utf8");
    const html = ejs.render(
      template,
      {
        kind: "dwelling",
        stockColsByKind: { dwelling: columns },
        stockLabels: STOCK_LABELS,
        stockSelectCols: STOCK_SELECT_COLS,
        stockFilters: {},
        stockFilterOptions: options,
        stockSort: "uprn",
        stockDir: "asc",
        stockPage: tab.page,
        stockLabel: tab.label,
        stockPagerLabel: tab.pagerLabel,
        stockPageSize: STOCK_PAGE_SIZE,
        rows: tab.page.rows,
        isAdmin: true,
        isClient: false,
        isSurveyor: false,
        project: { id: "p" },
        baseUrl: (path: string) => path,
        assetStatusOptions: options.assetStatus || [],
        formatStockDate,
        stockDateCols: STOCK_DATE_COLS,
        adminEditCols: [],
        stockFiltered: false,
      },
      { filename: join(root, "views/partials/stock-table.ejs") }
    );
    const optionCount = html.match(/<option\b/g)?.length ?? 0;
    assert.ok(optionCount < 200, `expected a small filter list, got ${optionCount} options`);
    assert.match(html, /data-filter="letterDate1"/);
    assert.doesNotMatch(html, /NOTE-3999-END/);
    assert.equal((html.match(/data-asset=/g) || []).length, 1);
  });

  it("keeps Clear All Filters, active-filter colour, and the Site Comments header", () => {
    const table = readFileSync(join(root, "views/partials/stock-table.ejs"), "utf8");
    const css = readFileSync(join(root, "public/css/app.css"), "utf8");
    assert.match(table, /Clear All Filters/);
    assert.match(table, /data-clear-filters/);
    assert.match(table, /filter-active/);
    assert.match(table, /col-site-comments/);
    assert.match(css, /filter-active\{color:#a11/);
    assert.match(css, /col-site-comments\{background:#ffe566/);
  });
});

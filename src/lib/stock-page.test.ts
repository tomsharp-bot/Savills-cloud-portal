import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ejs from "ejs";
import { STOCK_DATE_COLS, stockColumns } from "./stock-columns.js";
import { formatStockDate } from "./dates.js";
import {
  STOCK_PAGE_SIZE,
  buildStockPage,
  clampStockPageSize,
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

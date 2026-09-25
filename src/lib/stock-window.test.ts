import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Asset, AssetKind } from "@prisma/client";
import ejs from "ejs";
import { STOCK_DATE_COLS, stockColumns } from "./stock-columns.js";
import { formatStockDate } from "./dates.js";
import { prismaStockGateway, loadStockWindow, clearStockOptionCache } from "./stock-query.js";
import { flattenSql, stockIdQuery, stockFilterSql } from "./stock-sql.js";
import {
  STOCK_ROW_HEIGHT,
  STOCK_WINDOW_MAX,
  STOCK_WINDOW_SIZE,
  assembleStockWindow,
  clampStockWindowLimit,
  memoryStockGateway,
  stockVirtualStart,
  virtualPadHeights,
} from "./stock-window.js";

const root = process.cwd();
const MTVH_DWELLINGS = 44231;

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

function asset(id: string, kind: AssetKind = "dwelling"): Asset {
  return {
    id,
    projectId: "p",
    kind,
    uprn: id.replace(/^id-/, ""),
    assetStatus: "No Visit",
    surveyDate: "",
    surveyedBy: "",
    visit1: "",
    visit2: "",
    visit3: "",
    number: "",
    block: "",
    street: "Low Street",
    area: "",
    city: "",
    postcode: "",
    archetype: "House",
    yearBuilt: "",
    patch: "",
    surveyor: "",
    surveyType: "Condition Only",
    epcRequired: false,
    siteComments: "",
    external: "",
    residentName: "",
    residentNumber: "",
    residentEmail: "",
    letterDate1: "",
    letterDate2: "",
    x1: "",
    x2: "",
    x3: "",
    omitAsset: false,
    stockMissing: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("Virtual stock window for a 44k dwellings tab", () => {
  it("refuses to mount more than a window even if the client asks for every row", () => {
    assert.equal(clampStockWindowLimit(40000), STOCK_WINDOW_MAX);
    assert.equal(clampStockWindowLimit(44231), STOCK_WINDOW_MAX);
    assert.ok(STOCK_WINDOW_MAX < 5000);
    assert.equal(clampStockWindowLimit(undefined), STOCK_WINDOW_SIZE);
  });

  it("opens ~44k dwellings as one window and still filters a row past that window", async () => {
    const columns = stockColumns("dwelling", { includeAdminOnly: false });
    const rows = Array.from({ length: MTVH_DWELLINGS }, (_, i) =>
      row(String(i), { street: i === 44000 ? "High Street" : "Low Street" })
    );
    const opened = await assembleStockWindow(memoryStockGateway(rows, columns), columns, {});
    assert.equal(opened.page.total, MTVH_DWELLINGS);
    assert.equal(opened.page.matched, MTVH_DWELLINGS);
    assert.equal(opened.page.rows.length, STOCK_WINDOW_SIZE);
    assert.ok(opened.page.rows.length < 5000);
    assert.match(opened.label, /Showing 1–100 of 44,231 Assets/);

    const filtered = await assembleStockWindow(memoryStockGateway(rows, columns), columns, {
      f_street: "High",
      offset: "0",
    });
    assert.equal(filtered.page.matched, 1);
    assert.equal(filtered.page.total, MTVH_DWELLINGS);
    assert.equal(filtered.page.rows.length, 1);
    assert.equal(filtered.page.rows[0].uprn, "44000");
    assert.match(filtered.label, /Showing 1–1 of 1 Assets \(44,231 in this tab\)/);
  });

  it("renders spacer pads instead of one DOM row per asset", () => {
    const columns = stockColumns("dwelling", { includeAdminOnly: false });
    const rows = Array.from({ length: MTVH_DWELLINGS }, (_, i) => row(String(i)));
    const template = readFileSync(join(root, "views/partials/stock-rows.ejs"), "utf8");
    const html = ejs.render(
      template,
      {
        rows,
        cols: columns,
        stockWindowSize: STOCK_WINDOW_SIZE,
        stockWindowMax: STOCK_WINDOW_MAX,
        stockVirtual: true,
        stockOffset: 0,
        stockMatched: MTVH_DWELLINGS,
        stockRowHeight: STOCK_ROW_HEIGHT,
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
    assert.equal(nodes.length, STOCK_WINDOW_SIZE);
    assert.equal((html.match(/data-pad=/g) || []).length, 2);
    assert.doesNotMatch(html, /data-asset="id-100"/);
    assert.doesNotMatch(html, /data-asset="id-44000"/);
    const pads = virtualPadHeights(MTVH_DWELLINGS, 0, STOCK_WINDOW_SIZE, STOCK_ROW_HEIGHT);
    assert.equal(pads.top, 0);
    assert.equal(pads.bottom, (MTVH_DWELLINGS - STOCK_WINDOW_SIZE) * STOCK_ROW_HEIGHT);
    assert.match(html, new RegExp(`height:${pads.bottom}px`));
    assert.equal(stockVirtualStart(pads.bottom, STOCK_ROW_HEIGHT), MTVH_DWELLINGS - STOCK_WINDOW_SIZE);
  });

  it("still caps the template when a caller passes the whole tab and a huge window", () => {
    const columns = stockColumns("dwelling", { includeAdminOnly: false });
    const rows = Array.from({ length: MTVH_DWELLINGS }, (_, i) => row(String(i)));
    const template = readFileSync(join(root, "views/partials/stock-rows.ejs"), "utf8");
    const html = ejs.render(
      template,
      {
        rows,
        cols: columns,
        stockWindowSize: 40000,
        stockWindowMax: STOCK_WINDOW_MAX,
        stockVirtual: false,
        stockFiltered: false,
        isAdmin: false,
        isSurveyor: false,
        formatStockDate,
        stockDateCols: STOCK_DATE_COLS,
        adminEditCols: [],
      },
      { filename: join(root, "views/partials/stock-rows.ejs") }
    );
    assert.equal((html.match(/data-asset=/g) || []).length, STOCK_WINDOW_MAX);
  });

  it("keeps the id query windowed so Postgres, not Node, walks the full tab", () => {
    const where = stockFilterSql({ street: "High" }, new Set(), false, new Set(["street", "uprn"]));
    const query = stockIdQuery({
      projectId: "proj",
      kind: "dwelling",
      conditionEpc: true,
      where,
      sort: "surveyType",
      dir: "asc",
      limit: clampStockWindowLimit(44231),
      offset: 0,
    });
    const flat = flattenSql(query);
    const compact = flat.text.replace(/\s+/g, " ");
    assert.match(compact, /SELECT a\.id/);
    assert.match(compact, /LIMIT/);
    assert.match(compact, /OFFSET/);
    const limitSlot = compact.match(/LIMIT\s+\$(\d+)/);
    assert.ok(limitSlot);
    assert.equal(flat.values[Number(limitSlot[1]) - 1], STOCK_WINDOW_MAX);
    assert.ok(!flat.values.includes(44231));
    assert.match(compact, /LIKE/);
    assert.match(compact, /SCS \+ EPC/);
    assert.match(compact, /SCS Only/);
    assert.match(compact, /External/);
    assert.ok(flat.values.includes("full survey completed"));
    assert.ok(flat.values.includes("survey complete"));
    assert.ok(flat.values.includes("completed"));
    assert.ok(flat.values.includes("ext only"));
    const nonBlank = stockFilterSql(
      { surveyDate: "__nonblank__", patch: "Patch 8" },
      new Set(["surveyDate", "patch"]),
      false,
      new Set(["surveyDate", "patch"])
    );
    const nonBlankFlat = flattenSql(nonBlank);
    const nonBlankSql = nonBlankFlat.text.replace(/\s+/g, " ");
    assert.match(nonBlankSql, /<> ''/);
    assert.match(nonBlankSql, /AND/);
    assert.ok(nonBlankFlat.values.some((value) => String(value).toLowerCase() === "patch 8"));
    const anyProject = stockIdQuery({
      projectId: "proj",
      kind: "dwelling",
      conditionEpc: false,
      where,
      sort: "surveyType",
      dir: "asc",
      limit: 10,
      offset: 0,
    });
    const anyCompact = flattenSql(anyProject).text.replace(/\s+/g, " ");
    assert.match(anyCompact, /SCS Only/);
    assert.match(anyCompact, /External/);
  });

  it("hydrates only the window when the tab has 44,231 dwellings", async () => {
    clearStockOptionCache();
    const columns = stockColumns("dwelling", { includeAdminOnly: true, includeEpcRequired: true });
    let hydrated = 0;
    const queries: string[] = [];
    const fake = {
      async $queryRaw(sql: Parameters<typeof flattenSql>[0]) {
        const flat = flattenSql(sql);
        const compact = flat.text.replace(/\s+/g, " ");
        queries.push(compact);
        if (/SELECT COUNT/i.test(compact)) return [{ count: MTVH_DWELLINGS }];
        if (/SELECT a\.id/i.test(compact)) {
          const limitSlot = compact.match(/LIMIT\s+\$(\d+)/i);
          assert.ok(limitSlot, compact);
          const limit = Number(flat.values[Number(limitSlot[1]) - 1]);
          assert.ok(limit > 0 && limit <= STOCK_WINDOW_MAX);
          assert.ok(limit < MTVH_DWELLINGS);
          return Array.from({ length: limit }, (_, i) => ({ id: `id-${i}` }));
        }
        if (/column_name/i.test(compact)) {
          assert.match(compact, /LIMIT/);
          return [{ column_name: "assetStatus", value: "No Visit" }, { column_name: "archetype", value: "House" }];
        }
        throw new Error(`unexpected sql ${compact.slice(0, 180)}`);
      },
      asset: {
        async findMany(args: { where: { id: { in: string[] } } }) {
          hydrated += args.where.id.in.length;
          assert.ok(args.where.id.in.length <= STOCK_WINDOW_MAX);
          return args.where.id.in.map((id) => asset(id));
        },
      },
      user: {
        async findMany() {
          return [];
        },
      },
    };
    const gateway = prismaStockGateway("proj", "dwelling", true, columns, fake as never);
    const opened = await loadStockWindow({
      projectId: "proj",
      kind: "dwelling",
      conditionEpc: true,
      columns,
      query: {},
      gateway,
    });
    assert.equal(opened.page.total, MTVH_DWELLINGS);
    assert.equal(opened.page.matched, MTVH_DWELLINGS);
    assert.equal(opened.page.rows.length, STOCK_WINDOW_SIZE);
    assert.equal(hydrated, STOCK_WINDOW_SIZE);
    assert.ok(queries.some((sql) => /SELECT a\.id/.test(sql) && /LIMIT/.test(sql)));

    const filtered = await loadStockWindow({
      projectId: "proj",
      kind: "dwelling",
      conditionEpc: true,
      columns,
      query: { f_street: "High", offset: "44000" },
      gateway,
    });
    assert.equal(filtered.page.total, MTVH_DWELLINGS);
    assert.ok(filtered.page.rows.length <= STOCK_WINDOW_MAX);
    assert.ok(hydrated <= STOCK_WINDOW_MAX * 2);
    const idSql = queries.filter((sql) => /SELECT a\.id/.test(sql)).pop() || "";
    assert.match(idSql, /street/i);
    assert.match(idSql, /LIKE/);
  });

  it("wires scroll virtualisation without bringing back a full-table pager", () => {
    const js = readFileSync(join(root, "public/js/app.js"), "utf8");
    const table = readFileSync(join(root, "views/partials/stock-table.ejs"), "utf8");
    const projects = readFileSync(join(root, "src/routes/projects.ts"), "utf8");
    const stock = readFileSync(join(root, "src/routes/stock.ts"), "utf8");
    const external = readFileSync(join(root, "src/lib/external.ts"), "utf8");
    assert.match(js, /data-pad/);
    assert.match(js, /maybeVirtualFetch/);
    assert.match(js, /addEventListener\("scroll"/);
    assert.match(js, /data-clear-filters/);
    assert.match(js, /filter-active/);
    assert.match(js, /\/stock\/page/);
    assert.doesNotMatch(js, /data-stock-page-next/);
    assert.match(table, /Clear All Filters/);
    assert.match(table, /data-offset=/);
    assert.match(table, /filter-active/);
    assert.doesNotMatch(table, /data-stock-page-next/);
    assert.match(projects, /loadStockWindow/);
    assert.doesNotMatch(projects, /loadStockRows/);
    assert.match(stock, /loadStockWindow/);
    assert.doesNotMatch(stock, /loadStockRows/);
    assert.match(external, /updateMany/);
    assert.doesNotMatch(external, /findMany\(\{ where: \{ projectId \} \}\)/);
  });
});

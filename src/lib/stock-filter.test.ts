import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ejs from "ejs";
import { statusFromVisitLogs } from "./asset-status.js";
import { BLANK_FILTER, NONBLANK_FILTER, filterStockRows, stockFilterValues } from "./stock-filter.js";
import { STOCK_DATE_COLS, STOCK_LABELS, STOCK_SELECT_COLS, stockColumns } from "./stock-columns.js";
import { formatStockDate } from "./dates.js";
import { parseStockListQuery } from "./stock-page.js";
import { flattenSql, stockFilterSql } from "./stock-sql.js";

const root = process.cwd();

describe("Visit import → Full Survey Asset Status filter", () => {
  it("import successful visit → asset status Full Survey → filter returns it", () => {
    const importedStatus = statusFromVisitLogs([
      { visitType: "SCS", accessType: "Successful" },
    ]).assetStatus;
    assert.equal(importedStatus, "Full Survey");

    const dwellings = [
      {
        uprn: "635770",
        kind: "dwelling",
        assetStatus: importedStatus,
        surveyType: "Condition Only",
        siteComments: "Letter sent — no access previously",
      },
      {
        uprn: "100040200111",
        kind: "dwelling",
        assetStatus: "No Visit",
        surveyType: "Condition Only",
        siteComments: "Full Survey booked",
      },
      {
        uprn: "100040200112",
        kind: "dwelling",
        assetStatus: "No Access",
        surveyType: "Condition + EPC",
        siteComments: "",
      },
    ];

    const shown = filterStockRows(dwellings, { assetStatus: "Full Survey" });
    assert.equal(shown.length, 1);
    assert.equal(shown[0].uprn, "635770");
    assert.equal(shown[0].assetStatus, "Full Survey");
  });

  it("does not match Survey Type or Site Comments when filtering Asset Status", () => {
    const rows = [
      {
        uprn: "keep",
        assetStatus: "Full Survey",
        surveyType: "Condition Only",
        siteComments: "No Access",
      },
      {
        uprn: "skip",
        assetStatus: "No Access",
        surveyType: "Condition Only",
        siteComments: "Full Survey follow-up",
      },
    ];
    const shown = filterStockRows(rows, { assetStatus: "Full Survey" });
    assert.deepEqual(
      shown.map((r) => r.uprn),
      ["keep"]
    );
  });

  it("maps Full Survey / Completed visit labels onto the same filter option for each stock tab", () => {
    for (const kind of ["dwelling", "block", "garage"] as const) {
      const surveyType = kind === "dwelling" ? "Condition Only" : kind === "block" ? "Blocks" : "Garages";
      const rows = ["Successful", "Full Survey", "Completed"].map((accessType, i) => ({
        kind,
        uprn: `${kind}-${i}`,
        surveyType,
        siteComments: "",
        assetStatus: statusFromVisitLogs([{ visitType: surveyType, accessType }]).assetStatus,
      }));
      for (const row of rows) {
        assert.equal(row.assetStatus, "Full Survey", `${kind} ${row.uprn}`);
      }
      const shown = filterStockRows(rows, { assetStatus: "Full Survey" });
      assert.equal(shown.length, 3, kind);
    }
  });

  it("Asset Status cells expose data-col and data-value so the grid filter hits the right field", () => {
    const table = readFileSync(join(root, "views/partials/stock-table.ejs"), "utf8");
    const rowTemplate = readFileSync(join(root, "views/partials/stock-rows.ejs"), "utf8");
    const template = table + "\n" + rowTemplate;
    assert.match(template, /data-col="assetStatus"/);
    assert.match(template, /data-value="<%= r\.assetStatus %>"/);
    const script = readFileSync(join(root, "public/js/app.js"), "utf8");
    assert.match(script, /\/stock\/page/);
    assert.match(script, /appUrl\(/);
    assert.match(script, /f_" \+ el\.dataset\.filter/);
    assert.match(script, /data-clear-filters/);
    assert.match(script, /filter-active/);
    assert.match(template, /data-col="siteComments"/);
    assert.match(template, /data-col="omitAsset"/);
    assert.match(template, /data-comment=/);
    assert.match(template, /__blank__/);
    assert.match(template, /__nonblank__/);
    assert.match(template, /\(Non-blanks\)/);
    assert.match(template, /data-filter-presence/);
    assert.match(template, /data-filter="<%= c %>"/);
    assert.match(template, /data-col="<%= c %>"/);
  });

  it("binds every stock column to its own field on Dwellings, Blocks and Garages", () => {
    const template =
      readFileSync(join(root, "views/partials/stock-table.ejs"), "utf8") +
      "\n" +
      readFileSync(join(root, "views/partials/stock-rows.ejs"), "utf8");
    for (const kind of ["dwelling", "block", "garage"] as const) {
      for (const col of stockColumns(kind)) {
        if (col === "siteComments" || col === "omitAsset" || col === "assetStatus") continue;
        assert.match(template, /data-col="<%= c %>"/, `${kind} ${col}`);
      }
    }
    assert.ok(template.includes('data-col="assetStatus"'));
    assert.ok(template.includes('data-col="siteComments"'));
    assert.ok(template.includes('data-col="omitAsset"'));
  });

  it("does not treat another column's text as a match for any filterable field", () => {
    const row = {
      uprn: "keep",
      assetStatus: "No Access",
      surveyType: "Condition Only",
      surveyor: "PM",
      surveyedBy: "PM",
      patch: "Patch 1",
      archetype: "House",
      external: "Yes",
      siteComments: "door stuck",
      street: "High Street",
      surveyDate: "18/09/2026",
      omitAsset: false,
    };
    const decoy = {
      uprn: "skip",
      assetStatus: "Full Survey",
      surveyType: "No Access",
      surveyor: "Condition Only",
      surveyedBy: "House",
      patch: "Yes",
      archetype: "Patch 1",
      external: "PM",
      siteComments: "18/09/26",
      street: "door stuck",
      surveyDate: "01/01/2026",
      omitAsset: true,
    };
    const checks: [string, string][] = [
      ["assetStatus", "No Access"],
      ["surveyType", "Condition Only"],
      ["surveyor", "PM"],
      ["surveyedBy", "PM"],
      ["patch", "Patch 1"],
      ["archetype", "House"],
      ["external", "Yes"],
      ["siteComments", "door stuck"],
      ["street", "High Street"],
      ["surveyDate", "18/09/26"],
      ["omitAsset", "included"],
    ];
    for (const [key, value] of checks) {
      const shown = filterStockRows([row, decoy], { [key]: value });
      assert.deepEqual(
        shown.map((r) => r.uprn),
        ["keep"],
        key
      );
    }
    assert.equal(filterStockRows([row, decoy], { assetStatus: "Full Survey" })[0].uprn, "skip");
    assert.ok(STOCK_SELECT_COLS.has("surveyDate"));
    assert.ok(STOCK_DATE_COLS.has("surveyDate"));
  });

  it("matches a blank dropdown to empty cells only", () => {
    const rows = [
      { uprn: "empty", surveyor: "  ", surveyDate: "", siteComments: "PM" },
      { uprn: "filled", surveyor: "PM", surveyDate: "02/04/2026", siteComments: "" },
    ];
    assert.deepEqual(
      filterStockRows(rows, { surveyor: BLANK_FILTER }).map((r) => r.uprn),
      ["empty"]
    );
    assert.deepEqual(
      filterStockRows(rows, { surveyDate: BLANK_FILTER }).map((r) => r.uprn),
      ["empty"]
    );
    assert.deepEqual(
      filterStockRows(rows, { surveyor: "PM" }).map((r) => r.uprn),
      ["filled"]
    );
  });

  it("keeps every row with a value when Non-blanks is chosen, including with another column", () => {
    const rows = [
      { uprn: "dated", surveyDate: "02/04/2026", patch: "Patch 8", assetStatus: "Full Survey" },
      { uprn: "blank", surveyDate: "  ", patch: "Patch 8", assetStatus: "No Visit" },
      { uprn: "other", surveyDate: "03/04/2026", patch: "Patch 1", assetStatus: "No Visit" },
    ];
    const exact = new Set(["surveyDate", "patch", "assetStatus"]);
    assert.deepEqual(
      filterStockRows(rows, { surveyDate: NONBLANK_FILTER }, exact).map((row) => row.uprn),
      ["dated", "other"]
    );
    assert.deepEqual(
      filterStockRows(rows, { surveyDate: NONBLANK_FILTER, patch: "Patch 8" }, exact).map((row) => row.uprn),
      ["dated"]
    );
    assert.deepEqual(
      filterStockRows(rows, { surveyDate: BLANK_FILTER, patch: "Patch 8" }, exact).map((row) => row.uprn),
      ["blank"]
    );
    assert.deepEqual(
      filterStockRows(rows, { assetStatus: NONBLANK_FILTER, surveyDate: NONBLANK_FILTER }, exact).map((row) => row.uprn),
      ["dated", "other"]
    );
  });

  it("treats an empty string as blank for Survey Date, Surveyed By, and Patch", () => {
    const rows = [
      { uprn: "empty", surveyDate: "", surveyedBy: "", patch: "" },
      { uprn: "dated", surveyDate: "01/02/26", surveyedBy: "", patch: "" },
      { uprn: "named", surveyDate: "", surveyedBy: "PM", patch: "" },
      { uprn: "patched", surveyDate: "", surveyedBy: "", patch: "Patch 8" },
    ];
    const exact = new Set(["surveyDate", "surveyedBy", "patch"]);
    assert.deepEqual(
      filterStockRows(rows, { surveyDate: NONBLANK_FILTER }, exact).map((row) => row.uprn),
      ["dated"]
    );
    assert.deepEqual(
      filterStockRows(rows, { surveyedBy: NONBLANK_FILTER }, exact).map((row) => row.uprn),
      ["named"]
    );
    assert.deepEqual(
      filterStockRows(rows, { patch: NONBLANK_FILTER }, exact).map((row) => row.uprn),
      ["patched"]
    );
    assert.deepEqual(
      filterStockRows(rows, { surveyDate: BLANK_FILTER }, exact).map((row) => row.uprn),
      ["empty", "named", "patched"]
    );
  });

  it("matches a row when its cell is any of two selected values, including two dates", () => {
    const columns = ["uprn", "assetStatus", "surveyDate", "patch"];
    const rows = [
      { uprn: "a", assetStatus: "Full Survey", surveyDate: "02/04/2026", patch: "Patch 8" },
      { uprn: "b", assetStatus: "No Access", surveyDate: "03/04/2026", patch: "Patch 8" },
      { uprn: "c", assetStatus: "Void", surveyDate: "04/04/2026", patch: "Patch 1" },
      { uprn: "d", assetStatus: "No Visit", surveyDate: "", patch: "Patch 8" },
    ];
    const parsed = parseStockListQuery(
      {
        f_assetStatus: ["Full Survey", "No Access"],
        f_surveyDate: ["02/04/26", "03/04/26"],
      },
      columns
    );
    assert.deepEqual(parsed.filters.assetStatus, ["Full Survey", "No Access"]);
    assert.deepEqual(parsed.filters.surveyDate, ["02/04/26", "03/04/26"]);
    assert.deepEqual(
      filterStockRows(rows, parsed.filters).map((row) => row.uprn),
      ["a", "b"]
    );
    assert.deepEqual(
      filterStockRows(rows, {
        assetStatus: ["Full Survey", "Void"],
        surveyDate: ["02/04/26", "03/04/26"],
      }).map((row) => row.uprn),
      ["a"]
    );
    assert.deepEqual(filterStockRows(rows, { assetStatus: ["No Access"] }).map((row) => row.uprn), ["b"]);
    assert.deepEqual(filterStockRows(rows, { surveyDate: "02/04/26" }).map((row) => row.uprn), ["a"]);
    assert.deepEqual(filterStockRows(rows, { surveyDate: [BLANK_FILTER] }).map((row) => row.uprn), ["d"]);
    assert.deepEqual(
      filterStockRows(rows, { surveyDate: [NONBLANK_FILTER] }).map((row) => row.uprn),
      ["a", "b", "c"]
    );
    assert.deepEqual(
      filterStockRows(rows, { surveyDate: ["02/04/26", BLANK_FILTER] }).map((row) => row.uprn),
      ["a", "d"]
    );
    assert.deepEqual(
      stockFilterValues({ 0: "02/04/26", 1: "03/04/26" }),
      ["02/04/26", "03/04/26"]
    );
    const where = stockFilterSql(
      { surveyDate: ["02/04/26", "03/04/26"], patch: "Patch 8" },
      new Set(["surveyDate", "patch"]),
      false,
      new Set(["surveyDate", "patch"])
    );
    const flat = flattenSql(where);
    const sql = flat.text.replace(/\s+/g, " ");
    assert.match(sql, /OR/);
    assert.match(sql, /AND/);
    assert.ok(flat.values.includes("02/04/26"));
    assert.ok(flat.values.includes("03/04/26"));
    assert.ok(flat.values.some((value) => String(value).toLowerCase() === "patch 8"));
  });

  it("renders EPC Req. as the word YES and nothing else", () => {
    const template = readFileSync(join(root, "views/partials/stock-rows.ejs"), "utf8");
    const script = readFileSync(join(root, "public/js/app.js"), "utf8");
    for (const isAdmin of [true, false]) {
      const html = ejs.render(
        template,
        {
          rows: [
            { id: "yes", epcRequired: true, omitAsset: false, stockMissing: false },
            { id: "no", epcRequired: false, omitAsset: false, stockMissing: false },
          ],
          cols: ["epcRequired"],
          stockVirtual: false,
          stockFiltered: false,
          isAdmin,
          isSurveyor: false,
          formatStockDate,
          stockDateCols: STOCK_DATE_COLS,
          adminEditCols: [],
        },
        { filename: join(root, "views/partials/stock-rows.ejs") }
      );
      for (const [id, text] of [
        ["yes", "YES"],
        ["no", ""],
      ] as const) {
        const cell = html.match(new RegExp(`data-asset="${id}"[\\s\\S]*?<td[^>]*data-col="epcRequired"[^>]*>([\\s\\S]*?)<\\/td>`));
        assert.ok(cell, `${id} admin=${isAdmin}`);
        assert.equal(cell[1].trim(), text, `${id} admin=${isAdmin}`);
        assert.doesNotMatch(cell[1], /input|checkbox|✓|✔|☑|✅/i, `${id} admin=${isAdmin}`);
      }
    }
    assert.doesNotMatch(template, /data-epc/);
    assert.doesNotMatch(script, /input\[data-epc\]/);
    assert.doesNotMatch(script, /epcRequired: inp\.checked/);
  });

  it("renders column filters so two values, including two dates, can be selected together", () => {
    const columns = ["assetStatus", "surveyDate", "street"];
    const template = readFileSync(join(root, "views/partials/stock-table.ejs"), "utf8");
    const html = ejs.render(
      template,
      {
        kind: "dwelling",
        stockColsByKind: { dwelling: columns },
        stockLabels: STOCK_LABELS,
        stockSelectCols: STOCK_SELECT_COLS,
        stockFilters: {
          assetStatus: ["Full Survey", "No Access"],
          surveyDate: ["02/04/26", "03/04/26"],
        },
        stockFilterOptions: {
          assetStatus: ["Full Survey", "No Access", "No Visit"],
          surveyDate: ["", "02/04/26", "03/04/26", "04/04/26"],
        },
        stockSort: "uprn",
        stockDir: "asc",
        stockPage: { page: 1, pageCount: 1, matched: 0, total: 0, offset: 0 },
        stockLabel: "0 of 0 Assets Displayed",
        stockWindowSize: 100,
        stockRowHeight: 40,
        stockMatched: 0,
        stockOffset: 0,
        rows: [],
        isAdmin: true,
        isClient: false,
        isSurveyor: false,
        project: { id: "p" },
        baseUrl: (path: string) => path,
        formatStockDate,
        stockDateCols: STOCK_DATE_COLS,
        adminEditCols: [],
        stockFiltered: false,
        stockVirtual: false,
      },
      { filename: join(root, "views/partials/stock-table.ejs") }
    );
    assert.match(html, /data-multi-filter/);
    assert.match(html, /data-filter="assetStatus"/);
    assert.match(html, /data-filter="surveyDate"/);
    assert.match(html, /value="Full Survey"[^>]*checked/);
    assert.match(html, /value="No Access"[^>]*checked/);
    assert.match(html, /value="02\/04\/26"[^>]*checked/);
    assert.match(html, /value="03\/04\/26"[^>]*checked/);
    assert.match(html, /\(blank\)/);
    assert.match(html, /\(Non-blanks\)/);
    assert.match(html, /__blank__/);
    assert.match(html, /__nonblank__/);
    assert.doesNotMatch(html, /<select[^>]*data-filter="assetStatus"/);
    assert.doesNotMatch(html, /<select[^>]*data-filter="surveyDate"/);
    const script = readFileSync(join(root, "public/js/app.js"), "utf8");
    assert.match(script, /input\[type="checkbox"\]:checked/);
    assert.match(script, /const key = "f_" \+ el\.dataset\.filter/);
    assert.match(script, /values\.forEach\(\(value\) => params\.append\(key, value\)\)/);
  });
});

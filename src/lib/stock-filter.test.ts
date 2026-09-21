import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statusFromVisitLogs } from "./asset-status.js";
import { BLANK_FILTER, filterStockRows } from "./stock-filter.js";
import { STOCK_DATE_COLS, STOCK_SELECT_COLS, stockColumns } from "./stock-columns.js";

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
    const template = readFileSync(join(root, "views/partials/stock-table.ejs"), "utf8");
    assert.match(template, /data-col="assetStatus"/);
    assert.match(template, /data-value="<%= r\.assetStatus %>"/);
    const script = readFileSync(join(root, "public/js/app.js"), "utf8");
    assert.match(script, /data-col=/);
    assert.match(script, /data-value/);
    assert.doesNotMatch(
      script,
      /comment\s*\n?\s*\? comment\.value\s*\n?\s*: tr\.textContent/
    );
    const cellFn = script.slice(script.indexOf("function stockFilterCellText"), script.indexOf("function applyStockFilters"));
    assert.doesNotMatch(cellFn, /tr\.textContent/);
    const omitAt = cellFn.indexOf('key === "omitAsset"');
    const commentAt = cellFn.indexOf('key === "siteComments"');
    const colAt = cellFn.indexOf("data-col=");
    assert.ok(omitAt >= 0 && omitAt < colAt);
    assert.ok(commentAt >= 0 && commentAt < colAt);
    assert.match(script, /__blank__/);
    assert.match(template, /data-col="siteComments"/);
    assert.match(template, /data-col="omitAsset"/);
    assert.match(template, /data-comment=/);
    assert.match(template, /__blank__/);
    assert.match(template, /data-filter="<%= c %>"/);
    assert.match(template, /data-col="<%= c %>"/);
  });

  it("binds every stock column to its own field on Dwellings, Blocks and Garages", () => {
    const template = readFileSync(join(root, "views/partials/stock-table.ejs"), "utf8");
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
});

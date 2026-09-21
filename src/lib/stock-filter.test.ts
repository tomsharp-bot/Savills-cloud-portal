import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statusFromVisitLogs } from "./asset-status.js";
import { filterStockRows } from "./stock-filter.js";

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
  });
});

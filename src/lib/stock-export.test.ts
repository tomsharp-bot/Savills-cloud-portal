import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Asset } from "@prisma/client";
import * as XLSX from "xlsx";
import { assetToExportRow, buildStockWorkbook, stockExportFilename } from "./stock-export.js";
import { stockColumns, STOCK_LABELS } from "./stock-columns.js";

function asset(partial: Partial<Asset> & { agency?: string } = {}): Asset & { agency?: string } {
  return {
    id: "a1",
    projectId: "p1",
    kind: "dwelling",
    uprn: "1001",
    assetStatus: "Full Survey",
    surveyDate: "12/03/2026",
    surveyedBy: "PM",
    visit1: "01/03/2026",
    visit2: "12/03/26",
    visit3: "",
    number: "12",
    block: "",
    street: "Moor Cross",
    area: "Bude",
    city: "Bude",
    postcode: "EX23 9EH",
    archetype: "House",
    yearBuilt: "1968",
    patch: "Patch 1",
    surveyor: "PM",
    surveyType: "Condition Only",
    siteComments: "",
    external: "",
    residentName: "Jane Roe",
    residentNumber: "07700 900123",
    residentEmail: "jane@example.com",
    letterDate1: "04/01/2026",
    letterDate2: "",
    x1: "A",
    x2: "",
    x3: "",
    omitAsset: false,
    stockMissing: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    agency: "Savills",
    ...partial,
  };
}

describe("Stocklist export", () => {
  it("uses the same grid columns and short dates", () => {
    const row = assetToExportRow(asset(), "dwelling");
    const headers = stockColumns("dwelling").map((c) => STOCK_LABELS[c]);
    assert.deepEqual(Object.keys(row), headers);
    assert.equal(row["Survey Date"], "12/03/26");
    assert.equal(row["Visit 1 Date"], "01/03/26");
    assert.equal(row["Visit 2 Date"], "12/03/26");
    assert.equal(row["Patch"], "Patch 1");
    assert.equal(row["Surveyor"], "PM");
    assert.equal(row["Agency"], "Savills");
    assert.equal(row["Resident Name"], "Jane Roe");
    assert.equal(row["Resident Email"], "jane@example.com");
    assert.equal(row["Letter Date 1"], "04/01/26");
    assert.equal(row["X1"], "A");
  });

  it("omits Admin-only columns from a surveyor export", () => {
    const row = assetToExportRow(asset(), "dwelling", { includeAdminOnly: false });
    assert.equal(row["Resident Name"], undefined);
    assert.equal(row["Omit Asset"], undefined);
    assert.equal(row["UPRN"], "1001");
    assert.equal(row["Street"], "Moor Cross");
  });

  it("writes Dwellings / Blocks / Garages sheets for an all-tabs workbook", () => {
    const buf = buildStockWorkbook([
      { kind: "dwelling", rows: [asset()] },
      { kind: "block", rows: [asset({ kind: "block", uprn: "BLK-1" })] },
      { kind: "garage", rows: [] },
    ]);
    const wb = XLSX.read(buf, { type: "buffer" });
    assert.deepEqual(wb.SheetNames, ["Dwellings", "Blocks", "Garages"]);
    const dwell = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Dwellings);
    assert.equal(dwell[0]["UPRN"], "1001");
    assert.equal(dwell[0]["Survey Date"], "12/03/26");
  });

  it("names the download from the project and scope", () => {
    assert.equal(stockExportFilename("Test 1", "all"), "Test-1-stocklist.xlsx");
    assert.equal(stockExportFilename("Test 1", "dwelling"), "Test-1-dwellings-stocklist.xlsx");
  });
});

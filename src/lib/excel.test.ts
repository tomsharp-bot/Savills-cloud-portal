import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { isUprnHeader, parseStockWorkbook, parseUprnWorkbook, readStockSheet } from "./excel.js";

describe("Stocklist workbook sheets", () => {
  it("reads Dwellings as well as Blocks when both sheets have a UPRN column", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { UPRN: "B1", Archetype: "Block" },
        { UPRN: "B2", Archetype: "Block" },
      ]),
      "Blocks"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { UPRN: "H1", Archetype: "House" },
        { UPRN: "F1", Archetype: "Flat" },
      ]),
      "Dwellings"
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const firstOnly = parseUprnWorkbook(buf, "leeds.xlsx");
    assert.deepEqual(
      firstOnly.map((row) => row.UPRN),
      ["B1", "B2"]
    );
    const all = parseUprnWorkbook(buf, "leeds.xlsx", { allSheets: true });
    assert.deepEqual(
      all.map((row) => row.UPRN),
      ["B1", "B2", "H1", "F1"]
    );
  });

  it("recognises UPRN aliases and ignores a status column", () => {
    assert.equal(isUprnHeader("UPRN"), true);
    assert.equal(isUprnHeader("Asset UPRN"), true);
    assert.equal(isUprnHeader("Property_UPRN"), true);
    assert.equal(isUprnHeader("UPRN Number"), true);
    assert.equal(isUprnHeader("U.P.R.N."), true);
    assert.equal(isUprnHeader("UPRN Status"), false);
    assert.equal(isUprnHeader("Street"), false);
  });

  it("fills UPRN from Asset UPRN when the UPRN column is blank", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["UPRN", "Asset UPRN", "Archetype"],
      ["", "555", "Flat"],
    ]);
    const read = readStockSheet(sheet);
    assert.equal(String(read.rows[0].UPRN), "555");
    assert.equal(read.rows[0].Archetype, "Flat");
  });

  it("reads rows past a frozen worksheet dimension", () => {
    const count = 2500;
    const sheet = XLSX.utils.json_to_sheet(
      Array.from({ length: count }, (_, i) => ({ UPRN: String(i + 1), Archetype: "House" }))
    );
    sheet["!ref"] = "A1:B6";
    const naive = XLSX.utils.sheet_to_json(sheet);
    assert.ok(naive.length < 20);
    const read = readStockSheet(sheet);
    assert.equal(read.rows.length, count);
    assert.equal(String(read.rows[count - 1].UPRN), String(count));
  });

  it("reads a title block and an Asset UPRN header, and skips a cover sheet", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Cover notes"]]), "Cover");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["MTVH stocklist"],
        ["Exported for Savills"],
        [],
        ["Asset UPRN", "Archetype", "Address Line 1"],
        ["1001", "House", "High St"],
        ["1002", "Block", "Quay"],
      ]),
      "Stock"
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = parseStockWorkbook(buf, "mtvh.xlsx");
    assert.deepEqual(
      parsed.rows.map((row) => [String(row.UPRN), row.Archetype]),
      [
        ["1001", "House"],
        ["1002", "Block"],
      ]
    );
    assert.deepEqual(
      parsed.sheets.map((sheet) => sheet.name),
      ["Stock"]
    );
    assert.equal(parsed.sheets[0].headerRow, 4);
    assert.match(parsed.warnings.join(" "), /Cover/);
  });

  it("parses several thousand stock rows with no early cap", () => {
    const count = 4000;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        Array.from({ length: count }, (_, i) => ({ UPRN: String(500000 + i), Archetype: "Flat" }))
      ),
      "Dwellings"
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = parseStockWorkbook(buf, "large.xlsx");
    assert.equal(parsed.rows.length, count);
    assert.equal(String(parsed.rows[0].UPRN), "500000");
    assert.equal(String(parsed.rows[count - 1].UPRN), String(500000 + count - 1));
  });

  it("finds a UPRN header below a CSV title line", () => {
    const csv = "MTVH stocklist\nAsset UPRN,Archetype\n10,Flat\n";
    const parsed = parseStockWorkbook(Buffer.from(csv), "mtvh.csv");
    assert.equal(parsed.rows.length, 1);
    assert.equal(String(parsed.rows[0].UPRN), "10");
    assert.equal(parsed.rows[0].Archetype, "Flat");
  });
});

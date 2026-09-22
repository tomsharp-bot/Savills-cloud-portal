import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseUprnWorkbook } from "./excel.js";

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
});

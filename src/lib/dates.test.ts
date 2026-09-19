import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatStockDate, formatVisitDateDisplay, visitDateSortKey } from "./dates.js";

describe("Visit / stock dates", () => {
  it("parses DD/MM/YYYY and DD/MM/YY into a canonical four-digit year", () => {
    assert.equal(formatVisitDateDisplay("12/03/2026"), "12/03/2026");
    assert.equal(formatVisitDateDisplay("12/03/26"), "12/03/2026");
    assert.equal(formatVisitDateDisplay("1-3-26"), "01/03/2026");
  });

  it("shows Survey Date and Visit 1/2/3 as DD/MM/YY on stock grids", () => {
    assert.equal(formatStockDate("12/03/2026"), "12/03/26");
    assert.equal(formatStockDate("12/03/26"), "12/03/26");
    assert.equal(formatStockDate(""), "");
    assert.equal(formatStockDate("note"), "note");
  });

  it("sorts two-digit and four-digit years in the same order", () => {
    assert.equal(visitDateSortKey("12/03/26"), "20260312");
    assert.equal(visitDateSortKey("12/03/2026"), "20260312");
    assert.ok(visitDateSortKey("01/01/26") < visitDateSortKey("02/01/26"));
  });
});

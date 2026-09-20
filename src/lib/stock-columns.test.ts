import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ONLY_STOCK_COLS,
  DWELLING_ADMIN_COLS,
  STOCK_DATE_COLS,
  STOCK_LABELS,
  stockColumns,
} from "./stock-columns.js";

describe("Stock columns", () => {
  it("adds resident, letter and X fields on Dwellings only", () => {
    const dwell = stockColumns("dwelling");
    for (const col of DWELLING_ADMIN_COLS) {
      assert.ok(dwell.includes(col), col);
      assert.ok(STOCK_LABELS[col]);
    }
    assert.ok(!stockColumns("block").includes("residentName"));
    assert.ok(!stockColumns("garage").includes("x1"));
  });

  it("hides Omit Asset and dwelling admin fields for non-admins", () => {
    const dwell = stockColumns("dwelling", { includeAdminOnly: false });
    const block = stockColumns("block", { includeAdminOnly: false });
    for (const col of ADMIN_ONLY_STOCK_COLS) {
      assert.ok(!dwell.includes(col), col);
    }
    assert.ok(!block.includes("omitAsset"));
    assert.ok(dwell.includes("uprn"));
    assert.ok(dwell.includes("siteComments"));
  });

  it("treats letter dates like other stock dates", () => {
    assert.ok(STOCK_DATE_COLS.has("letterDate1"));
    assert.ok(STOCK_DATE_COLS.has("letterDate2"));
    assert.equal(STOCK_LABELS.letterDate1, "Letter Date 1");
    assert.equal(STOCK_LABELS.residentEmail, "Resident Email");
  });
});

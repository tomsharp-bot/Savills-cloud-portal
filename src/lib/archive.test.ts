import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ARCHIVE_BOARD_LIMIT, recentArchived, sortArchived } from "./archive.js";

function p(name: string, day: number, projectManager = "Greg K") {
  return { name, projectManager, updatedAt: new Date(Date.UTC(2026, 2, day)) };
}

describe("Projects archive", () => {
  it("keeps only the five most recently archived on the board", () => {
    const items = [p("A", 1), p("B", 8), p("C", 3), p("D", 10), p("E", 2), p("F", 6), p("G", 4)];
    const preview = recentArchived(items);
    assert.equal(ARCHIVE_BOARD_LIMIT, 5);
    assert.deepEqual(
      preview.map((x) => x.name),
      ["D", "B", "F", "G", "C"]
    );
  });

  it("sorts the full archive by name or date", () => {
    const items = [p("Zed", 1, "Tom"), p("Able", 5, "Ann")];
    assert.deepEqual(
      sortArchived(items, "name", "asc").map((x) => x.name),
      ["Able", "Zed"]
    );
    assert.deepEqual(
      sortArchived(items, "updatedAt", "desc").map((x) => x.name),
      ["Able", "Zed"]
    );
  });
});

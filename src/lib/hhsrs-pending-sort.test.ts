import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  comparePendingIssues,
  parsePendingSort,
  pendingIssueSortColumns,
  pendingRatingRank,
  pendingSortFoot,
  sortPendingIssues,
  type PendingSortRow,
} from "./hhsrs-pending-sort.js";

function row(partial: Partial<PendingSortRow> & Pick<PendingSortRow, "projectName" | "rating" | "createdAt">): PendingSortRow {
  return {
    fullAddress: "",
    uprn: "",
    surveyorName: "",
    category: "",
    photoPaths: [],
    ...partial,
  };
}

function at(daysAgo: number): Date {
  return new Date(Date.UTC(2026, 8, 30) - daysAgo * 86_400_000);
}

describe("pending list sort", () => {
  it("ranks emergency above qualified highs, then High and Severe together", () => {
    assert.ok(pendingRatingRank("High - Emergency risk") > pendingRatingRank("High - Severe Risk"));
    assert.ok(pendingRatingRank("High – emergency risk") > pendingRatingRank("High – severe risk"));
    assert.equal(pendingRatingRank("High - Emergency Risk"), pendingRatingRank("Severe – emergency risk"));
    assert.equal(pendingRatingRank("High - Severe Risk"), pendingRatingRank("High - Significant risk"));
    assert.equal(pendingRatingRank("High – severe risk"), pendingRatingRank("High - Significant risk"));
    assert.ok(pendingRatingRank("High - Significant risk") > pendingRatingRank("High"));
    assert.equal(pendingRatingRank("High"), pendingRatingRank("Severe"));
    assert.equal(pendingRatingRank("High"), pendingRatingRank("Category 1"));
    assert.ok(pendingRatingRank("Severe") > pendingRatingRank("Medium"));
    assert.equal(pendingRatingRank("Medium"), pendingRatingRank("Moderate"));
    assert.equal(pendingRatingRank("Medium"), pendingRatingRank("Category 2"));
    assert.ok(pendingRatingRank("Moderate") > pendingRatingRank("Slight"));
    assert.equal(pendingRatingRank("Slight"), pendingRatingRank("Low"));
    assert.equal(pendingRatingRank(""), 0);
    assert.equal(pendingRatingRank("Not a rating"), 0);
  });

  it("defaults to project, then highest rating, then longest wait", () => {
    const rows = [
      row({ projectName: "MTVH", uprn: "1002", rating: "Medium", createdAt: at(3) }),
      row({ projectName: "MTVH", uprn: "1001", rating: "High", createdAt: at(1) }),
      row({ projectName: "MTVH", uprn: "1003", rating: "High", createdAt: at(8) }),
      row({ projectName: "Onward", uprn: "2001", rating: "Severe", createdAt: at(2) }),
      row({ projectName: "Onward", uprn: "2002", rating: "Slight", createdAt: at(9) }),
    ];
    assert.deepEqual(
      sortPendingIssues(rows, "default").map((item) => item.uprn),
      ["1003", "1001", "1002", "2001", "2002"]
    );
    assert.deepEqual(
      sortPendingIssues(rows, "rating").map((item) => item.uprn),
      ["1001", "1003", "2001", "1002", "2002"]
    );
    assert.deepEqual(
      sortPendingIssues(rows, "received").map((item) => item.uprn),
      ["2002", "1003", "1002", "2001", "1001"]
    );
    assert.deepEqual(
      sortPendingIssues(rows, "project").map((item) => item.uprn),
      ["1002", "1001", "1003", "2001", "2002"]
    );
    assert.deepEqual(
      sortPendingIssues(rows, "uprn").map((item) => item.uprn),
      ["1001", "1002", "1003", "2001", "2002"]
    );
  });

  it("sorts a column on its own and keeps ties in the incoming order", () => {
    const rows = [
      row({ projectName: "mtvh", fullAddress: "10 Harbour Lane", uprn: "100", rating: "Low", surveyorName: "Zed", category: "Noise", photoPaths: ["a.jpg", "b.jpg"], createdAt: at(1) }),
      row({ projectName: "MTVH", fullAddress: "2 Harbour Lane", uprn: "99", rating: "High", surveyorName: "amy", category: "Damp", photoPaths: ["a.jpg"], createdAt: at(4) }),
      row({ projectName: "Onward", fullAddress: "2 Harbour Lane", uprn: "200", rating: "High", surveyorName: "Amy", category: "Damp", photoPaths: [], createdAt: at(2) }),
    ];
    assert.deepEqual(
      sortPendingIssues(rows, "default").map((item) => item.uprn),
      ["99", "100", "200"]
    );
    assert.deepEqual(
      sortPendingIssues(rows, "address").map((item) => item.uprn),
      ["99", "200", "100"]
    );
    assert.deepEqual(
      sortPendingIssues(rows, "photos").map((item) => item.uprn),
      ["200", "99", "100"]
    );
    assert.deepEqual(
      sortPendingIssues(rows, "surveyor").map((item) => item.uprn),
      ["99", "200", "100"]
    );
    assert.equal(comparePendingIssues(rows[1], rows[2], "rating"), 0);
    assert.deepEqual(
      sortPendingIssues(rows, "rating").map((item) => item.uprn),
      ["99", "200", "100"]
    );
  });

  it("treats an unknown sort as the default and does not reverse a column", () => {
    assert.equal(parsePendingSort(undefined), "default");
    assert.equal(parsePendingSort(""), "default");
    assert.equal(parsePendingSort("default"), "default");
    assert.equal(parsePendingSort("sent"), "default");
    assert.equal(parsePendingSort(["rating", "project"]), "rating");
    assert.equal(parsePendingSort(" received "), "received");

    const rating = pendingIssueSortColumns("rating");
    const ratingCol = rating.find((col) => col.key === "rating");
    const projectCol = rating.find((col) => col.key === "project");
    assert.equal(ratingCol?.active, true);
    assert.equal(ratingCol?.dir, "desc");
    assert.equal(ratingCol?.href, "/HHSRSreporter?sort=rating");
    assert.equal(ratingCol?.title, "Sorted highest rating first");
    assert.equal(projectCol?.active, false);
    assert.equal(projectCol?.href, "/HHSRSreporter?sort=project");
    assert.equal(pendingIssueSortColumns("rating").find((col) => col.key === "rating")?.href, ratingCol?.href);

    const idle = pendingIssueSortColumns("default");
    assert.equal(idle.some((col) => col.active), false);
    assert.deepEqual(
      idle.map((col) => col.label),
      ["Project", "Address", "Photos", "UPRN", "Surveyor", "Category", "Rating", "Received"]
    );
    assert.equal(pendingSortFoot("default"), "Project, then highest rating, then longest wait");
    assert.equal(pendingSortFoot("received"), "Longest wait first");
    assert.equal(pendingSortFoot("rating"), "Highest rating first");
  });

  it("wires the default control and column links only on the pending waiting list", () => {
    const pending = readFileSync("views/hhsrs-reporter/pending.ejs", "utf8");
    const waiting = pending.slice(pending.indexOf('id="not-actioned"'), pending.indexOf('id="last-actioned"'));
    const last = pending.slice(pending.indexOf('id="last-actioned"'));
    const review = readFileSync("views/hhsrs-reporter/review.ejs", "utf8");
    const main = readFileSync("views/hhsrs-reporter/main-log.ejs", "utf8");
    const route = readFileSync("src/routes/hhsrs-reporter.ts", "utf8");
    const handler = route.slice(route.indexOf('hhsrsReporterRouter.get("/",'), route.indexOf("/* ---------- Review"));

    assert.match(waiting, /pending-sort-default/);
    assert.match(waiting, /or click a column/);
    assert.match(waiting, /pendingSortColumns: pendingIssueSortColumns/);
    assert.match(waiting, /pendingFoot: pendingSortFoot/);
    assert.doesNotMatch(last, /pending-sort-default/);
    assert.doesNotMatch(last, /pendingIssueSortColumns/);
    assert.doesNotMatch(last, /pendingSortColumns/);
    assert.match(last, /Most recently actioned first/);
    assert.doesNotMatch(review, /pending-sort-default/);
    assert.doesNotMatch(main, /pending-sort-default/);
    assert.match(handler, /sortPendingIssues\(waitingRows, pendingSort\)/);
    assert.doesNotMatch(handler, /sortPendingIssues\(actionedRows/);
    assert.match(handler, /orderBy: \[\{ emailSentAt: "desc" \}, \{ updatedAt: "desc" \}\]/);
  });
});

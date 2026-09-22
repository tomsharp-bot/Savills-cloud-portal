import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Asset, Project } from "@prisma/client";
import { buildSummary } from "./summary.js";
import {
  OMITTED_SURVEYED_NOTE,
  appendSurveyedNote,
  formatStockRefreshResult,
  kindForStockRow,
  planStocklistRefresh,
  type RefreshAsset,
} from "./stock-refresh.js";
import { flaggedUprnsFromRows, isTruthyFlag } from "./external.js";

function row(partial: Partial<RefreshAsset> & { uprn: string }): RefreshAsset {
  return {
    kind: "dwelling",
    assetStatus: "No Visit",
    siteComments: "",
    external: "",
    omitAsset: false,
    stockMissing: false,
    ...partial,
  };
}

describe("Stocklist refresh plan", () => {
  it("adds new UPRNs and marks missing ones without deleting", () => {
    const existing = [row({ uprn: "A", assetStatus: "No Visit" }), row({ uprn: "B", assetStatus: "Full Survey" })];
    const plan = planStocklistRefresh(existing, [{ UPRN: "A", Street: "High St" }, { UPRN: "C", Street: "New Rd" }], true);
    assert.deepEqual(
      plan.added.map((a) => a.uprn),
      ["C"]
    );
    assert.deepEqual(plan.removed, ["B"]);
    assert.deepEqual(
      plan.matched.map((m) => m.uprn),
      ["A"]
    );
    assert.equal(plan.matched[0].address.street, "High St");
  });

  it("maps underscored headers onto the right stock fields", () => {
    const plan = planStocklistRefresh(
      [],
      [
        {
          UPRN: "1",
          Address_Line_1: "High St",
          Address_Line_5: "Bude",
          Post_Code: "EX23 8JZ",
          Year_Built: "1962",
          Survey_Type: "Condition Only",
          Block: "Harbour Court",
          Archetype: "House",
          Street: "  Should not win  ",
        },
      ],
      false
    );
    const added = plan.added[0];
    assert.equal(added.kind, "dwelling");
    assert.equal(added.address.street, "High St");
    assert.equal(added.address.city, "Bude");
    assert.equal(added.address.postcode, "EX23 8JZ");
    assert.equal(added.address.yearBuilt, "1962");
    assert.equal(added.address.surveyType, "Condition Only");
    assert.equal(added.address.block, "Harbour Court");
    assert.equal(added.address.number, undefined);
  });

  it("trims padded stock values so filters can match them", () => {
    const plan = planStocklistRefresh([], [{ UPRN: "1", Street: "  High St  ", Surveyor: " AS " }], false);
    assert.equal(plan.added[0].address.street, "High St");
    assert.equal(plan.added[0].address.surveyor, "AS");
  });

  it("maps Patch and Surveyor from a stocklist export so they can be re-uploaded", () => {
    const existing = [row({ uprn: "A" })];
    const plan = planStocklistRefresh(
      existing,
      [{ UPRN: "A", Patch: "Patch 4", Surveyor: "AS", Street: "High St" }],
      false
    );
    assert.equal(plan.matched[0].address.patch, "Patch 4");
    assert.equal(plan.matched[0].address.surveyor, "AS");
  });

  it("maps resident, letter and X columns when present (flexible headers)", () => {
    const existing = [row({ uprn: "A" })];
    const plan = planStocklistRefresh(
      existing,
      [
        {
          UPRN: "A",
          "resident name": "Sam Lee",
          "Resident_Number": "01234 567890",
          "Resident E-mail": "sam@example.com",
          "Letter Date1": "15/02/2026",
          "letter-date-2": "01/03/26",
          X1: "flag",
          "X 2": "note",
          x3: "z",
        },
      ],
      false
    );
    const a = plan.matched[0].address;
    assert.equal(a.residentName, "Sam Lee");
    assert.equal(a.residentNumber, "01234 567890");
    assert.equal(a.residentEmail, "sam@example.com");
    assert.equal(a.letterDate1, "15/02/26");
    assert.equal(a.letterDate2, "01/03/26");
    assert.equal(a.x1, "flag");
    assert.equal(a.x2, "note");
    assert.equal(a.x3, "z");
  });

  it("leaves resident fields off the patch when those columns are missing", () => {
    const existing = [row({ uprn: "A" })];
    const plan = planStocklistRefresh(existing, [{ UPRN: "A", Street: "High St" }], false);
    assert.equal(plan.matched[0].address.residentName, undefined);
    assert.equal(plan.matched[0].address.letterDate1, undefined);
    assert.equal(plan.matched[0].address.x1, undefined);
  });

  it("errors when no UPRN values are present", () => {
    const plan = planStocklistRefresh([row({ uprn: "A" })], [{ Street: "Nope" }], true);
    assert.equal(plan.error, "No UPRN column / values found in file");
  });

  it("appends the surveyed-omit note once", () => {
    assert.equal(appendSurveyedNote(""), OMITTED_SURVEYED_NOTE);
    assert.equal(appendSurveyedNote("Letter sent"), `Letter sent · ${OMITTED_SURVEYED_NOTE}`);
    assert.equal(appendSurveyedNote(OMITTED_SURVEYED_NOTE), OMITTED_SURVEYED_NOTE);
  });
});

describe("Stocklist Auto routing to Dwellings / Blocks / Garages", () => {
  it("adds mixed rows onto the tab inferred from Archetype / Asset Type / Survey Design", () => {
    const plan = planStocklistRefresh(
      [],
      [
        { UPRN: "D1", Archetype: "House", Street: "High St" },
        { UPRN: "B1", Archetype: "Low-rise block", Street: "Quay St" },
        { UPRN: "B2", "Survey Design": "MTVH Blocks" },
        { UPRN: "G1", Archetype: "Garage" },
        { UPRN: "G2", "Asset Type": "Garage Sites" },
        { UPRN: "G3", asset_type: "Garages" },
      ],
      false,
      "auto"
    );
    assert.deepEqual(
      plan.added.map((a) => [a.uprn, a.kind]),
      [
        ["D1", "dwelling"],
        ["B1", "block"],
        ["B2", "block"],
        ["G1", "garage"],
        ["G2", "garage"],
        ["G3", "garage"],
      ]
    );
    assert.equal(plan.reclassified.length, 0);
  });

  it("routes Survey Type Blocks/Garages from an exported stocklist", () => {
    const plan = planStocklistRefresh(
      [],
      [
        { UPRN: "1", "Survey Type": "Condition Only" },
        { UPRN: "2", "Survey Type": "Blocks" },
        { UPRN: "3", "Survey Type": "Garages" },
      ],
      false
    );
    assert.deepEqual(
      plan.added.map((a) => a.kind),
      ["dwelling", "block", "garage"]
    );
  });

  it("does not treat the address Block column as a type hint", () => {
    const plan = planStocklistRefresh([], [{ UPRN: "D1", Block: "Harbour Court", Archetype: "Flat" }], false);
    assert.equal(plan.added[0].kind, "dwelling");
  });

  it("prefers the file’s block/garage classification when the UPRN is already on Dwellings", () => {
    const existing = [
      row({ uprn: "B1", kind: "dwelling" }),
      row({ uprn: "G1", kind: "dwelling" }),
      row({ uprn: "D1", kind: "dwelling" }),
    ];
    const plan = planStocklistRefresh(
      existing,
      [
        { UPRN: "B1", Archetype: "Block" },
        { UPRN: "G1", "Asset Type": "Garage" },
        { UPRN: "D1", Archetype: "House" },
      ],
      false,
      "auto"
    );
    assert.deepEqual(plan.added, []);
    assert.deepEqual(
      plan.reclassified.map((r) => [r.uprn, r.from, r.to]),
      [
        ["B1", "dwelling", "block"],
        ["G1", "dwelling", "garage"],
      ]
    );
    assert.deepEqual(
      plan.matched.map((m) => [m.uprn, m.kind]),
      [["D1", "dwelling"]]
    );
  });

  it("keeps an explicit Dwellings/Blocks/Garages target on that tab only", () => {
    const plan = planStocklistRefresh(
      [row({ uprn: "A", kind: "dwelling" })],
      [
        { UPRN: "A", Archetype: "Garage" },
        { UPRN: "B", Archetype: "Block" },
      ],
      false,
      "dwelling"
    );
    assert.equal(plan.matched[0].kind, "dwelling");
    assert.equal(plan.added[0].kind, "dwelling");
    assert.equal(plan.reclassified.length, 0);
  });

  it("formats added counts split D/B/G", () => {
    assert.equal(
      formatStockRefreshResult({
        addedByTab: { dwelling: 3, block: 2, garage: 1 },
        removedCount: 4,
      }),
      "Added 3 dwellings, 2 blocks, 1 garages · Removed (marked) 4"
    );
    assert.equal(kindForStockRow({ Archetype: "MTVH Blocks" }), "block");
    assert.equal(kindForStockRow({ Archetype: "MTVH Blocks" }, "dwelling"), "dwelling");
  });

  it("sends Block to Blocks and House/Flat/Bungalow to Dwellings so Summary counts both", () => {
    const plan = planStocklistRefresh(
      [],
      [
        { UPRN: "B1", Archetype: "Block", "Survey Design": "Leeds Blocks" },
        { UPRN: "H1", Archetype: "House", "Survey Design": "Leeds Blocks" },
        { UPRN: "F1", Archetype: "Flat", "Survey Type": "Blocks" },
        { UPRN: "U1", Archetype: "Bungalow" },
        { UPRN: "U2", "Dwelling Type": "Bung." },
        { UPRN: "M1", Archetype: "Maisonette" },
        { UPRN: "S1", Archetype: "Studio" },
        { UPRN: "C1", "Asset Type": "Commercial Unit" },
      ],
      false,
      "auto"
    );
    const kindByUprn = Object.fromEntries(plan.added.map((row) => [row.uprn, row.kind]));
    assert.equal(kindByUprn.B1, "block");
    assert.equal(kindByUprn.H1, "dwelling");
    assert.equal(kindByUprn.F1, "dwelling");
    assert.equal(kindByUprn.U1, "dwelling");
    assert.equal(kindByUprn.U2, "dwelling");
    assert.equal(kindByUprn.M1, "dwelling");
    assert.equal(kindByUprn.S1, "dwelling");
    assert.notEqual(kindByUprn.C1, "block");
    assert.equal(kindByUprn.C1, "dwelling");

    const assets = plan.added.map(
      (row) =>
        ({
          kind: row.kind,
          uprn: row.uprn,
          omitAsset: false,
          assetStatus: "No Visit",
          surveyType: "",
          external: "",
          epcRequired: false,
        }) as Asset
    );
    const proj = {
      typeConditionOnly: true,
      typeConditionEpc: false,
      typeBlocks: true,
      typeGarages: false,
      projectTargetValue: 75,
      projectTargetUnit: "percent",
    } as Project;
    const summary = buildSummary(proj, assets);
    const dwell = summary.find((stack) => stack.key === "dwellings");
    const blocks = summary.find((stack) => stack.key === "blocks");
    assert.equal(dwell?.tiles.find((tile) => tile.label === "Total Dwellings")?.value, "7");
    assert.equal(blocks?.tiles.find((tile) => tile.label === "Total Blocks")?.value, "1");
  });
});

describe("External-only flags", () => {
  it("treats Yes / True / Y / 1 as flagged", () => {
    assert.equal(isTruthyFlag("Yes"), true);
    assert.equal(isTruthyFlag("TRUE"), true);
    assert.equal(isTruthyFlag("y"), true);
    assert.equal(isTruthyFlag("1"), true);
    assert.equal(isTruthyFlag("no"), false);
  });

  it("collects flagged UPRNs from the named column", () => {
    const rows = [
      { UPRN: "1", External: "Yes" },
      { UPRN: "2", External: "0" },
      { UPRN: "3", External: "Y" },
    ];
    assert.deepEqual(flaggedUprnsFromRows(rows, "External"), ["1", "3"]);
  });
});

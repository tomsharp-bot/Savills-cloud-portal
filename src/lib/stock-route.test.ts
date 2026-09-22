import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Asset, AssetKind, Project } from "@prisma/client";
import { rowHasNonBlockResidentialType } from "./asset-status.js";
import { buildSummary } from "./summary.js";
import { formatStockRefreshResult, kindForStockRow, planStocklistRefresh } from "./stock-refresh.js";
import { countRoutedStock, dwellingMisrouteWarning, routeStockRow } from "./stock-route.js";

const LEEDS_DESIGN = "Leeds Blocks";

function assetFrom(kind: AssetKind, uprn: string): Asset {
  return {
    kind,
    uprn,
    omitAsset: false,
    assetStatus: "No Visit",
    surveyType: "",
    external: "",
    epcRequired: false,
  } as Asset;
}

function tile(summary: ReturnType<typeof buildSummary>, stackKey: string, label: string): string {
  const stack = summary.find((item) => item.key === stackKey);
  const found = stack?.tiles.find((item) => item.label === label);
  assert.ok(found, `${stackKey} / ${label}`);
  return found.value;
}

describe("Auto stock routing", () => {
  const cases: Array<{ label: string; row: Record<string, unknown>; kind: AssetKind }> = [
    { label: "Block", row: { Archetype: "Block" }, kind: "block" },
    { label: "Blocks", row: { Archetype: "Blocks" }, kind: "block" },
    { label: "Low-rise block", row: { Archetype: "Low-rise block" }, kind: "block" },
    { label: "programme MTVH Blocks", row: { "Survey Design": "MTVH Blocks" }, kind: "block" },
    { label: "programme Survey Type Blocks", row: { "Survey Type": "Blocks" }, kind: "block" },
    { label: "Garage", row: { Archetype: "Garage" }, kind: "garage" },
    { label: "Garages", row: { "Asset Type": "Garages" }, kind: "garage" },
    { label: "garage site", row: { Archetype: "garage site" }, kind: "garage" },
    { label: "Garage Site", row: { "Property Type": "Garage Site" }, kind: "garage" },
    { label: "Commercial", row: { Archetype: "Commercial" }, kind: "dwelling" },
    { label: "Commercial unit", row: { "Asset Type": "Commercial unit" }, kind: "dwelling" },
    { label: "house", row: { Archetype: "house" }, kind: "dwelling" },
    { label: "House", row: { Archetype: "House" }, kind: "dwelling" },
    { label: "houses", row: { Archetype: "houses" }, kind: "dwelling" },
    { label: "bungalow", row: { Archetype: "bungalow" }, kind: "dwelling" },
    { label: "Bungalow", row: { "Dwelling Type": "Bungalow" }, kind: "dwelling" },
    { label: "bung.", row: { Archetype: "bung." }, kind: "dwelling" },
    { label: "Bung.", row: { Archetype: "Bung." }, kind: "dwelling" },
    { label: "flat", row: { Archetype: "flat" }, kind: "dwelling" },
    { label: "Flat", row: { Archetype: "Flat" }, kind: "dwelling" },
    { label: "maisonette", row: { Archetype: "maisonette" }, kind: "dwelling" },
    { label: "Maisonette", row: { Archetype: "Maisonette" }, kind: "dwelling" },
    { label: "mais.", row: { Archetype: "mais." }, kind: "dwelling" },
    { label: "Mais.", row: { "Unit Type": "Mais." }, kind: "dwelling" },
    { label: "bedsit", row: { Archetype: "bedsit" }, kind: "dwelling" },
    { label: "Bedsit", row: { Archetype: "Bedsit" }, kind: "dwelling" },
    { label: "bed sit", row: { Archetype: "bed sit" }, kind: "dwelling" },
    { label: "bed-sit", row: { Archetype: "bed-sit" }, kind: "dwelling" },
    { label: "room", row: { Archetype: "room" }, kind: "dwelling" },
    { label: "Room", row: { Archetype: "Room" }, kind: "dwelling" },
    { label: "studio", row: { Archetype: "studio" }, kind: "dwelling" },
    { label: "Studio", row: { Archetype: "Studio" }, kind: "dwelling" },
    { label: "Cottage", row: { Archetype: "Cottage" }, kind: "dwelling" },
    { label: "Park Home", row: { "Property Type": "Park Home" }, kind: "dwelling" },
    { label: "blank type", row: { UPRN: "ONLY" }, kind: "dwelling" },
  ];

  for (const entry of cases) {
    it(`routes ${entry.label} to ${entry.kind}`, () => {
      assert.equal(routeStockRow(entry.row), entry.kind, entry.label);
      assert.equal(kindForStockRow(entry.row), routeStockRow(entry.row), entry.label);
    });
  }

  it("does not send commercial units to Blocks", () => {
    for (const row of [
      { "Asset Type": "Commercial Unit", "Survey Design": LEEDS_DESIGN },
      { Archetype: "Commercial", "Survey Type": "Blocks" },
      { "Unit Type": "Commercial unit", Archetype: "Shop" },
    ]) {
      assert.equal(routeStockRow(row), "dwelling");
      assert.notEqual(routeStockRow(row), "block");
    }
  });

  it("keeps homes and unknown types as dwellings when Survey Design says Blocks", () => {
    for (const archetype of [
      "House",
      "Flat",
      "Bungalow",
      "Bung.",
      "Maisonette",
      "Mais.",
      "Bedsit",
      "bed sit",
      "Room",
      "Studio",
      "Cottage",
      "Park Home",
      "Annexe",
    ]) {
      const row = { Archetype: archetype, "Survey Design": LEEDS_DESIGN, "Survey Type": "Blocks" };
      assert.equal(routeStockRow(row), "dwelling", archetype);
      assert.equal(kindForStockRow(row), "dwelling", archetype);
    }
  });

  it("still uses Survey Design when the row has no asset-type column", () => {
    assert.equal(routeStockRow({ "Survey Design": "MTVH Blocks" }), "block");
    assert.equal(routeStockRow({ "Survey Design": "MTVH Garage Sites" }), "garage");
  });

  it("keeps an explicit tab target even when the archetype disagrees", () => {
    assert.equal(routeStockRow({ Archetype: "House" }, "block"), "block");
    assert.equal(routeStockRow({ Archetype: "Block" }, "dwelling"), "dwelling");
    assert.equal(kindForStockRow({ Archetype: "Garage" }, "dwelling"), "dwelling");
  });

  it("ignores the address Block column", () => {
    assert.equal(routeStockRow({ Block: "Harbour Court", Archetype: "House", "Survey Design": LEEDS_DESIGN }), "dwelling");
    assert.equal(rowHasNonBlockResidentialType({ Block: "Harbour Court", "Survey Design": LEEDS_DESIGN }), false);
    assert.equal(rowHasNonBlockResidentialType({ Archetype: "House", "Survey Design": LEEDS_DESIGN }), true);
    assert.equal(rowHasNonBlockResidentialType({ Archetype: "Block" }), false);
    assert.equal(rowHasNonBlockResidentialType({ Archetype: "Cottage" }), false);
  });
});

describe("Summary totals match routed stock", () => {
  const file: Array<Record<string, unknown>> = [
    { UPRN: "B1", Archetype: "Block", "Survey Design": LEEDS_DESIGN },
    { UPRN: "B2", Archetype: "Blocks", "Survey Design": LEEDS_DESIGN },
    { UPRN: "B3", Archetype: "Low-rise block", "Survey Design": LEEDS_DESIGN },
    { UPRN: "G1", Archetype: "Garage", "Survey Design": LEEDS_DESIGN },
    { UPRN: "G2", "Asset Type": "Garages", "Survey Design": LEEDS_DESIGN },
    { UPRN: "G3", Archetype: "garage site", "Survey Design": LEEDS_DESIGN },
    { UPRN: "H1", Archetype: "House", "Survey Design": LEEDS_DESIGN },
    { UPRN: "H2", Archetype: "house", "Survey Type": "Blocks" },
    { UPRN: "F1", Archetype: "Flat", "Survey Design": LEEDS_DESIGN },
    { UPRN: "U1", Archetype: "Bungalow", "Survey Design": LEEDS_DESIGN },
    { UPRN: "U2", "Dwelling Type": "Bung.", "Survey Design": LEEDS_DESIGN },
    { UPRN: "M1", Archetype: "Maisonette", "Survey Design": LEEDS_DESIGN },
    { UPRN: "M2", "Unit Type": "Mais.", "Survey Design": LEEDS_DESIGN },
    { UPRN: "D1", Archetype: "Bedsit", "Survey Design": LEEDS_DESIGN },
    { UPRN: "D2", Archetype: "bed sit", "Survey Design": LEEDS_DESIGN },
    { UPRN: "R1", Archetype: "Room", "Survey Design": LEEDS_DESIGN },
    { UPRN: "S1", Archetype: "Studio", "Survey Design": LEEDS_DESIGN },
    { UPRN: "C1", Archetype: "Cottage", "Survey Design": LEEDS_DESIGN },
    { UPRN: "P1", "Property Type": "Park Home", "Survey Design": LEEDS_DESIGN },
    { UPRN: "X1", "Asset Type": "Commercial Unit", "Survey Design": LEEDS_DESIGN },
    { UPRN: "Z1", UPRN_NOTE: "no type column", "Survey Design": "not a type" },
  ];

  it("counts a mixed Leeds-style upload on the same tabs Summary uses", () => {
    const plan = planStocklistRefresh([], file, false, "auto");
    assert.equal(plan.error, undefined);
    const kindByUprn = Object.fromEntries(plan.added.map((row) => [row.uprn, row.kind]));
    for (const raw of file) {
      assert.equal(kindByUprn[String(raw.UPRN)], routeStockRow(raw), String(raw.UPRN));
    }

    const routed = countRoutedStock(file);
    const fromPlan = { dwelling: 0, block: 0, garage: 0 };
    for (const row of plan.added) fromPlan[row.kind] += 1;
    assert.deepEqual(fromPlan, routed);
    assert.ok(routed.dwelling > 0);
    assert.ok(routed.block > 0);
    assert.ok(routed.garage > 0);
    assert.equal(kindByUprn.X1, "dwelling");
    assert.notEqual(kindByUprn.X1, "block");

    const summary = buildSummary(
      {
        typeConditionOnly: true,
        typeConditionEpc: false,
        typeBlocks: true,
        typeGarages: true,
        typeCommercial: true,
        projectTargetValue: 75,
        projectTargetUnit: "percent",
      } as Project,
      plan.added.map((row) => assetFrom(row.kind, row.uprn))
    );
    assert.equal(tile(summary, "dwellings", "Total Dwellings"), String(routed.dwelling));
    assert.equal(tile(summary, "blocks", "Total Blocks"), String(routed.block));
    assert.equal(tile(summary, "garages", "Total Garages"), String(routed.garage));
    assert.notEqual(tile(summary, "dwellings", "Total Dwellings"), "0");
    assert.equal(tile(summary, "commercial", "Commercial Units"), "0");

    const addedByTab = { ...fromPlan };
    assert.equal(
      dwellingMisrouteWarning({
        rows: file,
        addedByTab,
        addedUprns: plan.added.map((row) => row.uprn),
        target: "auto",
      }),
      null
    );
    assert.equal(
      formatStockRefreshResult({
        addedByTab,
        removedCount: 0,
        rows: file,
        addedUprns: plan.added.map((row) => row.uprn),
        target: "auto",
      }).includes("Warning:"),
      false
    );
  });
});

describe("Dwelling miscount warning", () => {
  const leedsRows = [
    { UPRN: "H1", Archetype: "House", "Survey Design": LEEDS_DESIGN },
    { UPRN: "F1", Archetype: "Flat", "Survey Design": LEEDS_DESIGN },
    { UPRN: "U1", "Dwelling Type": "Bung.", "Survey Design": LEEDS_DESIGN },
    { UPRN: "B1", Archetype: "Block", "Survey Design": LEEDS_DESIGN },
  ];

  it("warns when inserted homes are missing and blocks were added", () => {
    const warning = dwellingMisrouteWarning({
      rows: leedsRows,
      addedByTab: { dwelling: 0, block: 300, garage: 0 },
      addedUprns: ["H1", "F1", "U1", "B1"],
      target: "auto",
    });
    assert.ok(warning);
    assert.match(warning, /0 dwellings were added/);
    assert.match(warning, /300 blocks were added/);
    assert.match(warning, /not counted on Dwellings/);
    const notice = formatStockRefreshResult({
      addedByTab: { dwelling: 0, block: 300, garage: 0 },
      removedCount: 0,
      rows: leedsRows,
      addedUprns: ["H1", "F1", "U1", "B1"],
      target: "auto",
    });
    assert.match(notice, /Added 0 dwellings, 300 blocks, 0 garages/);
    assert.match(notice, /Warning:/);
  });

  it("stays quiet when only new blocks were inserted and the homes were already on the project", () => {
    assert.equal(
      dwellingMisrouteWarning({
        rows: leedsRows,
        addedByTab: { dwelling: 0, block: 1, garage: 0 },
        addedUprns: ["B-NEW"],
        target: "auto",
      }),
      null
    );
  });

  it("stays quiet for an explicit Blocks upload", () => {
    assert.equal(
      dwellingMisrouteWarning({
        rows: leedsRows,
        addedByTab: { dwelling: 0, block: 4, garage: 0 },
        addedUprns: ["H1", "F1", "U1", "B1"],
        target: "block",
      }),
      null
    );
  });

  it("stays quiet when the file has blocks and garages but no residential type", () => {
    assert.equal(
      dwellingMisrouteWarning({
        rows: [
          { UPRN: "B1", Archetype: "Block" },
          { UPRN: "G1", Archetype: "Garage" },
          { UPRN: "C1", "Asset Type": "Commercial Unit" },
        ],
        addedByTab: { dwelling: 0, block: 2, garage: 0 },
        addedUprns: ["B1", "C1"],
        target: "auto",
      }),
      null
    );
  });
});

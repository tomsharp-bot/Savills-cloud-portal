import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Asset, Project } from "@prisma/client";
import { buildSummary } from "./summary.js";
import {
  OMITTED_SURVEYED_NOTE,
  POSTGRES_MAX_BIND_PARAMS,
  STOCK_FLASH_SAMPLE,
  STOCK_IMPORT_BATCH,
  STOCK_IMPORT_COLUMNS,
  STOCK_UPLOAD_MAX_BYTES,
  appendSurveyedNote,
  buildStockRefreshFlash,
  formatStockRefreshResult,
  kindForStockRow,
  mapStockAddress,
  planStocklistRefresh,
  siteCommentsToStore,
  stockCreateInput,
  surveyTypeForStockWrite,
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
    assert.equal(added.address.surveyType, undefined);
    assert.equal(added.address.epcRequired, false);
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

  it("reads Site Comments onto new and matched dwellings", () => {
    const plan = planStocklistRefresh(
      [row({ uprn: "A", siteComments: "Old note" })],
      [
        { UPRN: "A", "Site Comments": "  Gate code 1234  " },
        { UPRN: "B", Comments: "Ring the bell" },
        { UPRN: "C", Notes: "Side entrance" },
        { UPRN: "D", Site_Comments: "Underscored export header" },
        { UPRN: "E", Comment: "Short" },
        { UPRN: "F", "Site Comments": "   " },
        { UPRN: "G", Street: "High St" },
      ],
      false
    );
    assert.equal(plan.matched[0].address.siteComments, "Gate code 1234");
    const byUprn = Object.fromEntries(plan.added.map((item) => [item.uprn, item]));
    assert.equal(stockCreateInput("p", byUprn.B).siteComments, "Ring the bell");
    assert.equal(byUprn.C.address.siteComments, "Side entrance");
    assert.equal(byUprn.D.address.siteComments, "Underscored export header");
    assert.equal(mapStockAddress({ "Site Comment": "Singular" }).siteComments, "Singular");
    assert.equal(byUprn.E.address.siteComments, "Short");
    assert.equal(byUprn.F.address.siteComments, undefined);
    assert.equal(stockCreateInput("p", byUprn.F).siteComments, undefined);
    assert.equal(byUprn.G.address.siteComments, undefined);
    const moved = planStocklistRefresh(
      [row({ uprn: "R", kind: "dwelling" })],
      [{ UPRN: "R", Archetype: "Block", "Site Comments": "Block note" }],
      false,
      "auto"
    );
    assert.equal(moved.reclassified[0].address.siteComments, "Block note");
  });

  it("replaces a stored comment from the file and keeps the omitted-survey note", () => {
    assert.equal(siteCommentsToStore("Gate code 1234", "Old note"), "Gate code 1234");
    assert.equal(siteCommentsToStore("  ", "Old note"), "Old note");
    assert.equal(siteCommentsToStore(undefined, "Old note"), "Old note");
    assert.equal(
      siteCommentsToStore("Gate code 1234", `Old note · ${OMITTED_SURVEYED_NOTE}`),
      `Gate code 1234 · ${OMITTED_SURVEYED_NOTE}`
    );
    assert.equal(
      siteCommentsToStore(`Already noted · ${OMITTED_SURVEYED_NOTE}`, OMITTED_SURVEYED_NOTE),
      `Already noted · ${OMITTED_SURVEYED_NOTE}`
    );
    assert.equal(siteCommentsToStore("", "Kept", `Moved · ${OMITTED_SURVEYED_NOTE}`), "Kept");
    assert.equal(
      siteCommentsToStore("From the file", "", `Moved · ${OMITTED_SURVEYED_NOTE}`),
      `From the file · ${OMITTED_SURVEYED_NOTE}`
    );
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

describe("Large stocklists and partial imports", () => {
  it("does not collapse a zero-padded UPRN into the same asset as its numeric form", () => {
    const plan = planStocklistRefresh(
      [],
      [{ UPRN: 100000000001 }, { UPRN: "00042" }, { UPRN: "1.00000000001E+11" }],
      false
    );
    assert.equal(plan.uniqueUprn, 2);
    assert.equal(plan.duplicateUprn, 1);
    assert.equal(plan.blankUprn, 0);
    assert.deepEqual(
      plan.added.map((row) => row.uprn).sort(),
      ["00042", "100000000001"]
    );
  });

  it("plans every unique UPRN in a 44k stocklist", () => {
    const rows = Array.from({ length: 44000 }, (_, i) => ({
      UPRN: String(100000 + i),
      Archetype: i % 100 === 0 ? "Block" : i % 80 === 0 ? "Garage" : "House",
    }));
    const plan = planStocklistRefresh([], rows, false);
    assert.equal(plan.error, undefined);
    assert.equal(plan.fileRows, 44000);
    assert.equal(plan.uniqueUprn, 44000);
    assert.equal(plan.blankUprn, 0);
    assert.equal(plan.duplicateUprn, 0);
    assert.equal(plan.added.length, 44000);
    assert.equal(plan.fileByTab.dwelling + plan.fileByTab.block + plan.fileByTab.garage, 44000);
    assert.ok(plan.fileByTab.dwelling > 40000);
    assert.ok(plan.fileByTab.block > 0);
    assert.ok(plan.fileByTab.garage > 0);
  });

  it("reports duplicate and blank UPRNs so Summary is not compared to the raw row count", () => {
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 100; i++) rows.push({ UPRN: String(i % 10), Archetype: i === 0 ? "House" : "Block" });
    rows.push({ Archetype: "House", Street: "No key" });
    const plan = planStocklistRefresh([], rows, false);
    assert.equal(plan.fileRows, 101);
    assert.equal(plan.uniqueUprn, 10);
    assert.equal(plan.duplicateUprn, 90);
    assert.equal(plan.blankUprn, 1);
    assert.equal(plan.added.length, 10);
    assert.equal(plan.added.find((row) => row.uprn === "0")?.kind, "dwelling");
    assert.equal(plan.fileByTab.dwelling, 1);
    assert.equal(plan.fileByTab.block, 9);
    const msg = formatStockRefreshResult({
      addedByTab: plan.fileByTab,
      removedCount: 0,
      fileRows: plan.fileRows,
      uniqueUprn: plan.uniqueUprn,
      blankUprn: plan.blankUprn,
      duplicateUprn: plan.duplicateUprn,
      fileByTab: plan.fileByTab,
    });
    assert.match(msg, /90 duplicate UPRN row\(s\) skipped \(first row kept\)/);
    assert.match(msg, /10 unique UPRN\(s\) from 101 file row\(s\)/);
    assert.match(msg, /1 blank UPRN row\(s\) skipped/);
    assert.match(msg, /Summary counts one asset per UPRN/);
    assert.match(msg, /File has 1 dwellings, 9 blocks, 0 garages/);
  });

  it("keeps the loader flash small enough for a session cookie", () => {
    const added = Array.from({ length: 9515 }, (_, i) => String(100000 + i));
    const flash = buildStockRefreshFlash({
      projectId: "p",
      added,
      removed: [],
      addedByTab: { dwelling: 9515, block: 0, garage: 0 },
      alsoOmit: true,
      tab: "auto",
      stats: {
        fileRows: 44000,
        uniqueUprn: 9515,
        blankUprn: 0,
        duplicateUprn: 34485,
        fileByTab: { dwelling: 9515, block: 0, garage: 0 },
      },
    });
    assert.equal(flash.addedCount, 9515);
    assert.equal(flash.addedSample.length, STOCK_FLASH_SAMPLE);
    assert.equal(flash.removedSample.length, 0);
    assert.ok(!("added" in flash));
    assert.ok(JSON.stringify(flash).length < 4000);
  });

  it("keeps each insert batch under Postgres parameter limit and accepts a 64MB workbook", () => {
    assert.ok(STOCK_IMPORT_BATCH * STOCK_IMPORT_COLUMNS < POSTGRES_MAX_BIND_PARAMS);
    assert.equal(STOCK_UPLOAD_MAX_BYTES, 64 * 1024 * 1024);
    const input = stockCreateInput("p", {
      uprn: "1",
      kind: "dwelling",
      address: {
        number: "1",
        block: "Harbour",
        street: "High St",
        area: "North",
        city: "Leeds",
        postcode: "LS1 1AA",
        archetype: "House",
        yearBuilt: "1990",
        patch: "Patch 1",
        surveyor: "AS",
        surveyType: "Condition Only",
        epcRequired: true,
        residentName: "Sam",
        residentNumber: "07000",
        residentEmail: "sam@example.com",
        letterDate1: "01/02/26",
        letterDate2: "03/04/26",
        x1: "a",
        x2: "b",
        x3: "c",
      },
    });
    assert.ok(Object.keys(input).length <= STOCK_IMPORT_COLUMNS);
    assert.equal(input.surveyType, "");
    assert.equal(input.assetStatus, "No Visit");
    assert.equal(input.epcRequired, true);
  });
});

describe("EPC Req. column on stocklist refresh", () => {
  it("reads Yes, yes, Y, TRUE, and 1 as ticked", () => {
    for (const value of ["Yes", "yes", "Y", "TRUE", "1", true, 1]) {
      assert.equal(mapStockAddress({ "EPC Req": value }).epcRequired, true, String(value));
    }
  });

  it("reads No and 0 as not ticked", () => {
    for (const value of ["No", "0", false, 0]) {
      assert.equal(mapStockAddress({ "EPC Req": value }).epcRequired, false, String(value));
    }
  });

  it("leaves epcRequired unset when the cell is blank or unrecognised", () => {
    assert.equal(mapStockAddress({ "EPC Req": "" }).epcRequired, undefined);
    assert.equal(mapStockAddress({ "EPC Req": "   " }).epcRequired, undefined);
    assert.equal(mapStockAddress({ "EPC Req": "maybe" }).epcRequired, undefined);
    assert.equal(mapStockAddress({ UPRN: "1", Street: "High St" }).epcRequired, undefined);
    const created = stockCreateInput("p", {
      uprn: "1",
      kind: "dwelling",
      address: mapStockAddress({ UPRN: "1", "EPC Req": "" }),
    });
    assert.equal(Object.hasOwn(created, "epcRequired"), false);
  });

  it("accepts the dwellings export header EPC Req. and the other EPC Req aliases", () => {
    assert.equal(mapStockAddress({ "EPC Req.": "Yes" }).epcRequired, true);
    assert.equal(mapStockAddress({ "EPC_Req.": "yes" }).epcRequired, true);
    assert.equal(mapStockAddress({ "EPC Required": "Y" }).epcRequired, true);
    assert.equal(mapStockAddress({ "EPC Reqd": "1" }).epcRequired, true);
    assert.equal(mapStockAddress({ EPC: "TRUE" }).epcRequired, true);
  });

  it("lets an explicit EPC Req value win over Survey Type", () => {
    const yes = mapStockAddress({ "Survey Type": "Condition Only", "EPC Req": "Yes" });
    assert.equal(yes.surveyType, undefined);
    assert.equal(yes.epcRequired, true);
    const no = mapStockAddress({ "Survey Type": "Condition + EPC", "EPC Req.": "No" });
    assert.equal(no.surveyType, undefined);
    assert.equal(no.epcRequired, false);
    const blank = mapStockAddress({ "Survey Type": "Condition + EPC", "EPC Req": "" });
    assert.equal(blank.surveyType, undefined);
    assert.equal(blank.epcRequired, true);
    const fallback = mapStockAddress({ "Survey Type": "SCS Only" });
    assert.equal(fallback.epcRequired, false);
    assert.equal(fallback.surveyType, undefined);
  });

  it("puts the tick on added, matched, and reclassified assets", () => {
    const existing = [row({ uprn: "M", kind: "dwelling" }), row({ uprn: "R", kind: "dwelling" })];
    const plan = planStocklistRefresh(
      existing,
      [
        { UPRN: "N", "EPC Req": "Yes" },
        { UPRN: "M", "EPC Req.": "Yes" },
        { UPRN: "R", Archetype: "Block", "EPC Req": "Yes" },
      ],
      false,
      "auto"
    );
    const added = plan.added.find((item) => item.uprn === "N");
    const matched = plan.matched.find((item) => item.uprn === "M");
    const moved = plan.reclassified.find((item) => item.uprn === "R");
    assert.equal(added?.address.epcRequired, true);
    assert.equal(matched?.address.epcRequired, true);
    assert.equal(moved?.address.epcRequired, true);
    assert.equal(moved?.to, "block");
    assert.equal(stockCreateInput("p", added!).epcRequired, true);
    assert.equal(stockCreateInput("p", added!).surveyType, "");
  });

  it("does not copy an uploaded Survey Type onto a dwelling", () => {
    const plan = planStocklistRefresh(
      [],
      [
        { UPRN: "1", "Survey Type": "Condition + EPC" },
        { UPRN: "2", "Survey Type": "Blocks" },
        { UPRN: "3", "EPC Req": "No", "Survey Type": "Condition + EPC" },
      ],
      false
    );
    const byUprn = Object.fromEntries(plan.added.map((item) => [item.uprn, item]));
    assert.equal(byUprn["1"].kind, "dwelling");
    assert.equal(byUprn["1"].address.surveyType, undefined);
    assert.equal(byUprn["1"].address.epcRequired, true);
    const created = stockCreateInput("p", byUprn["1"]);
    assert.equal(created.surveyType, "");
    assert.equal(created.epcRequired, true);
    assert.equal(byUprn["2"].kind, "block");
    assert.equal(byUprn["2"].address.surveyType, "Blocks");
    assert.equal(stockCreateInput("p", byUprn["2"]).surveyType, "Blocks");
    assert.equal(byUprn["3"].address.epcRequired, false);
    assert.equal(stockCreateInput("p", byUprn["3"]).surveyType, "");
  });

  it("stores a derived Survey Type for added, matched, and reclassified dwellings", () => {
    assert.equal(
      surveyTypeForStockWrite({ kind: "dwelling", assetStatus: "No Visit", epcRequired: true, useKindDefault: true }),
      ""
    );
    assert.equal(
      surveyTypeForStockWrite({
        kind: "dwelling",
        assetStatus: "Full Survey",
        epcRequired: false,
        fileSurveyType: "Condition + EPC",
        useKindDefault: false,
      }),
      "SCS Only"
    );
    assert.equal(
      surveyTypeForStockWrite({
        kind: "dwelling",
        assetStatus: "Full Survey",
        epcRequired: true,
        fileSurveyType: "Condition Only",
        useKindDefault: false,
      }),
      "SCS + EPC"
    );
    assert.equal(
      surveyTypeForStockWrite({ kind: "dwelling", assetStatus: "Ext-Only", epcRequired: true, useKindDefault: true }),
      "External"
    );
    assert.equal(
      surveyTypeForStockWrite({ kind: "dwelling", assetStatus: "No Access", epcRequired: false, useKindDefault: true }),
      ""
    );
    assert.equal(
      surveyTypeForStockWrite({
        kind: "block",
        assetStatus: "Full Survey",
        epcRequired: true,
        fileSurveyType: "Blocks",
        useKindDefault: true,
      }),
      "Blocks"
    );
    assert.equal(
      surveyTypeForStockWrite({ kind: "garage", assetStatus: "No Visit", epcRequired: false, useKindDefault: false }),
      undefined
    );
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

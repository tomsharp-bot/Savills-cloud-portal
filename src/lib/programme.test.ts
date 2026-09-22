import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  boardFromClient,
  buildProgrammeTables,
  canonName,
  isHolidayLabel,
  parseSavedBoard,
  projectWeeksOnGrid,
  resolveProgramme,
  seededSurveyTypes,
  teamPoolExcludingAdmins,
  type ProgrammeProjectSource,
  type SavedProgrammeBoard,
} from "./programme.js";

function project(partial: Partial<ProgrammeProjectSource> & Pick<ProgrammeProjectSource, "id" | "name" | "stage">): ProgrammeProjectSource {
  return {
    projectManager: "Tom Sharp",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    typeConditionOnly: true,
    typeConditionEpc: false,
    typeBlocks: false,
    typeGarages: false,
    typeCommercial: false,
    typeOther: false,
    typeValidations: false,
    ...partial,
  };
}

describe("programme page controls", () => {
  it("exports Excel and shows Nr of Weeks on current projects", () => {
    const page = readFileSync(join(process.cwd(), "views/projects-programme.ejs"), "utf8");
    assert.match(page, /id="btnExcel">Export Excel/);
    assert.match(page, />Nr of Weeks</);
    assert.doesNotMatch(page, /Export PDF|btnPdf/);
    const script = readFileSync(join(process.cwd(), "public/js/programme.js"), "utf8");
    assert.match(script, /BHC Programme/);
    assert.match(script, /isAdminName/);
  });
});

describe("resolveProgramme", () => {
  it("starts from the offline draft when nothing is saved and Personnel is empty", () => {
    const board = resolveProgramme({});
    assert.equal(board.weeks[0], "2026-09-21");
    assert.equal(board.weeks.at(-1), "2027-12-27");
    assert.equal(board.rows.length, 44);
    assert.equal(board.rows[0].name, "Richard Moreing");
    assert.equal(board.rows[0].weeks[0], "LFHA 2026");
    const peter = board.rows.find((row) => row.name === "Peter May");
    assert.ok(peter);
    assert.equal(peter.weeks[5], "Holiday");
    assert.equal(isHolidayLabel(peter.weeks[5]), true);
    assert.deepEqual(
      board.admins.map((row) => row.name),
      ["Tom Sharp", "Admin 2", "Admin 3", "Admin 4"]
    );
    assert.equal(board.usingPersonnelAdmins, false);
    assert.equal(board.rows.find((row) => row.name === "Larry Field")?.flag, "F");
    assert.equal(board.pools.agency_not_on_project[0].name, "Bardya Amin");
    assert.equal(board.pools.team_not_live.length, 4);
    assert.deepEqual(board.ticks, {});
    assert.deepEqual(board.applied, {});
  });

  it("uses Personnel admins and keeps matching week cells", () => {
    const board = resolveProgramme({
      admins: [
        { name: "Phil Moon" },
        { name: "Tom Sharp" },
      ],
      surveyors: [{ name: "Alex Surveyor", agency: "Savills" }, { name: "peter may", agency: "E" }],
    });
    assert.equal(board.usingPersonnelAdmins, true);
    assert.deepEqual(
      board.admins.map((row) => row.name),
      ["Phil Moon", "Tom Sharp"]
    );
    assert.equal(board.admins.find((row) => row.name === "Tom Sharp")?.weeks.length, board.weeks.length);
    assert.ok(!board.admins.some((row) => row.name.startsWith("Admin ")));
    assert.equal(board.rows.at(-1)?.name, "Alex Surveyor");
    const peter = board.rows.find((row) => canonName(row.name) === "peter may");
    assert.equal(peter?.name, "peter may");
    assert.equal(peter?.weeks[5], "Holiday");
    assert.equal(peter?.flag, "E");
    assert.equal(board.rows.filter((row) => canonName(row.name) === "peter may").length, 1);
  });

  it("keeps a saved layout and appends new Personnel surveyors", () => {
    const saved: SavedProgrammeBoard = {
      version: 1,
      ticks: { "Peter May": false },
      applied: { "Peter May": false, "Richard Moreing": true },
      surveyorOrder: ["Richard Moreing", "Peter May"],
      adminOrder: ["Admin 2", "Tom Sharp"],
      cells: {
        "Richard Moreing": ["Onward"],
        "Tom Sharp": ["Holiday"],
      },
      flags: { "Peter May": "F" },
    };
    const board = resolveProgramme({
      saved,
      surveyors: [{ name: "Zoe New" }, { name: "Richard Moreing" }],
      admins: [{ name: "Tom Sharp" }, { name: "Zoe Admin" }],
    });
    assert.deepEqual(
      board.rows.map((row) => row.name),
      ["Richard Moreing", "Peter May", "Zoe New"]
    );
    assert.equal(board.rows[0].weeks[0], "Onward");
    assert.equal(board.rows[0].weeks[1], "");
    assert.equal(board.rows[1].flag, "F");
    assert.equal(board.applied["Peter May"], false);
    assert.equal(board.ticks["Peter May"], false);
    assert.deepEqual(
      board.admins.map((row) => row.name),
      ["Tom Sharp", "Zoe Admin"]
    );
    assert.equal(board.admins[0].weeks[0], "Holiday");
    assert.equal(isHolidayLabel("Festive Period"), true);
    assert.equal(isHolidayLabel("Onward"), false);
  });

  it("drops Personnel admins from the team pool without hard-coding names", () => {
    const board = resolveProgramme({
      admins: [
        { name: "Greg Kowalski" },
        { name: "Tom Sharp" },
        { name: "Carly Morgan" },
        { name: "Hazel Wilson", frozen: true },
      ],
    });
    assert.deepEqual(
      board.pools.team_not_live.map((person) => person.name),
      ["Alan Henderson", "Clive Gray"]
    );
    assert.equal(board.pools.agency_not_on_project[0].name, "Bardya Amin");
    assert.ok(board.rows.some((row) => row.name === "Tom Purnell"));
    assert.ok(board.admins.some((row) => row.name === "Greg Kowalski"));
    assert.ok(!board.admins.some((row) => row.name === "Hazel Wilson"));
    assert.equal(board.usingPersonnelAdmins, true);
    assert.deepEqual(
      teamPoolExcludingAdmins(
        [{ name: "Greg Kowalski" }, { name: "Tom Purnell" }, { name: "Alan Henderson" }],
        ["Tom Sharp", "greg kowalski"]
      ).map((person) => person.name),
      ["Tom Purnell", "Alan Henderson"]
    );
  });

  it("skips frozen Personnel when adding people", () => {
    const board = resolveProgramme({
      surveyors: [{ name: "Frozen Person", frozen: true }],
      admins: [{ name: "Frozen Admin", frozen: true }],
    });
    assert.equal(board.usingPersonnelAdmins, false);
    assert.ok(!board.rows.some((row) => row.name === "Frozen Person"));
    assert.equal(board.admins[0].name, "Tom Sharp");
  });
});

describe("boardFromClient", () => {
  it("normalises a client save and round-trips through the resolver", () => {
    const saved = boardFromClient({
      ticks: { "Peter May": false, "Nope": true },
      applied: { "Peter May": false },
      surveyors: [
        { name: "  Peter   May ", flag: "f", weeks: ["Holiday", "Onward"] },
        { name: "Peter May", flag: "E", weeks: ["ignored duplicate"] },
      ],
      admins: [{ name: "Phil Moon", flag: "agency", weeks: [] }],
    });
    assert.ok(saved);
    assert.deepEqual(saved.surveyorOrder, ["Peter May"]);
    assert.equal(saved.flags["Peter May"], "F");
    assert.equal(saved.cells["Peter May"][0], "Holiday");
    assert.equal(saved.cells["Peter May"][1], "Onward");
    assert.equal(saved.ticks["Peter May"], false);
    assert.equal(saved.ticks.Nope, undefined);
    assert.equal(saved.flags["Phil Moon"], "");
    const board = resolveProgramme({
      saved,
      surveyors: [],
      admins: [{ name: "Phil Moon" }],
    });
    assert.equal(board.rows[0].weeks[0], "Holiday");
    assert.equal(board.admins[0].name, "Phil Moon");
    assert.equal(parseSavedBoard(saved)?.surveyorOrder[0], "Peter May");
  });

  it("rejects an empty surveyor list so a bad save cannot wipe the draft", () => {
    assert.equal(boardFromClient({ surveyors: [], admins: [] }), null);
    assert.equal(boardFromClient(null), null);
    assert.equal(parseSavedBoard({ version: 2 }), null);
  });
});

describe("projectWeeksOnGrid", () => {
  it("counts distinct weeks on the main grid, including admin rows that are on the board", () => {
    const people = [
      { weeks: ["Onward", "Onward", ""], active: true },
      { weeks: ["Onward", "LFHA 2026", ""], active: true },
      { weeks: ["Onward", "Onward", "Onward"], active: false },
      { weeks: ["LFHA 2026", "LFHA 2026", "Holiday"], active: true },
    ];
    assert.equal(projectWeeksOnGrid("Onward", people), 2);
    assert.equal(projectWeeksOnGrid("lfha  2026", people), 2);
    assert.equal(projectWeeksOnGrid("Holiday", people), 1);
    assert.equal(projectWeeksOnGrid("Missing", people), 0);
    assert.equal(projectWeeksOnGrid("Onward", [{ weeks: ["Onward"], active: false }]), 0);
  });
});

describe("buildProgrammeTables", () => {
  it("splits live Project Progress rows and keeps survey-type edits", () => {
    const projects = [
      project({
        id: "c1",
        name: "Onward",
        stage: "current",
        projectManager: "Greg Kowalski",
        createdAt: new Date("2026-02-01"),
        typeConditionOnly: true,
        typeConditionEpc: true,
        typeBlocks: true,
      }),
      project({
        id: "c0",
        name: "LFHA 2026",
        stage: "current",
        projectManager: "Tom Sharp",
        createdAt: new Date("2026-01-01"),
      }),
      project({
        id: "u1",
        name: "MTVH",
        stage: "upcoming",
        projectManager: "Carly Morgan",
        typeConditionOnly: false,
        typeBlocks: true,
        typeValidations: true,
      }),
      ...["a", "b", "c", "d", "e", "f"].map((id, index) =>
        project({
          id,
          name: "Archive " + id,
          stage: "archive",
          projectManager: "Archive Lead " + id,
          updatedAt: new Date(Date.UTC(2026, 0, index + 1)),
        })
      ),
    ];
    const notes = new Map<string, string>([["c1", "SCS & EPCs"]]);
    const stock = new Map<string, number>([
      ["c1", 12880],
      ["u1", 4],
    ]);
    const tables = buildProgrammeTables(projects, stock, notes);
    assert.deepEqual(
      tables.current.map((row) => row.project),
      ["LFHA 2026", "Onward"]
    );
    assert.equal(tables.current[0].lead, "Tom Sharp");
    assert.equal(tables.current[0].numbers, "0");
    assert.equal(tables.current[0].surveyTypes, "Condition Only");
    assert.equal(tables.current[1].lead, "Greg Kowalski");
    assert.equal(tables.current[1].numbers, "12880");
    assert.equal(tables.current[1].surveyTypes, "SCS & EPCs");
    assert.equal(tables.upcoming.length, 1);
    assert.equal(tables.upcoming[0].project, "MTVH");
    assert.equal(tables.upcoming[0].lead, "Carly Morgan");
    assert.equal(tables.upcoming[0].numbers, "4");
    assert.equal(tables.upcoming[0].surveyTypes, "Blocks, Validations");
    assert.equal(tables.completed.length, 5);
    assert.deepEqual(
      tables.completed.map((row) => row.id),
      ["f", "e", "d", "c", "b"]
    );
    assert.equal(tables.completed[0].lead, "Archive Lead f");
    assert.equal(
      seededSurveyTypes(projects[0]),
      "Condition Only, Condition + EPC, Blocks"
    );
  });
});

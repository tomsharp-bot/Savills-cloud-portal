import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import {
  boardFromClient,
  buildProgrammeTables,
  canonName,
  isHolidayLabel,
  parseSavedBoard,
  approxSurveysOnGrid,
  programmeCellMatchesProject,
  jobTileColor,
  jobTileColorKey,
  programmeShortLabel,
  programmeVisibleWeeks,
  projectWeeksOnGrid,
  resolveProgramme,
  seededSurveyTypes,
  teamPoolExcludingAdmins,
  type ProgrammeProjectSource,
  type SavedProgrammeBoard,
} from "./programme.js";
import { programmeSeed } from "./programme-seed.js";

/** Tuesday of the week the offline draft was built for, after Monday 04:00 Europe/London. */
const DRAFT_WEEK = new Date("2026-09-22T11:00:00.000Z");

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
    assert.match(page, />Approx surveys</);
    assert.doesNotMatch(page, /Export PDF|btnPdf/);
    const script = readFileSync(join(process.cwd(), "public/js/programme.js"), "utf8");
    assert.match(script, /BHC Programme/);
    assert.match(script, /isAdminName/);
    assert.match(script, /approx-surveys/);
    assert.match(script, /SURVEYS_PER_WEEK = 40/);
    assert.match(script, /programmeCellMatches/);
    assert.match(script, /fillProjTable\("projUpcoming", P\.upcoming, \{ weeks: true \}\)/);
    assert.match(script, /if \(!canEdit \|\| !DATA\.saveUrl\) return Promise\.resolve\(false\)/);
    assert.match(script, /weeks: \(DATA\.weeks \|\| \[\]\)\.slice\(\)/);
    const upcoming = page.slice(page.indexOf('id="projUpcoming"'), page.indexOf('id="projCompleted"'));
    assert.match(upcoming, />Nr of Weeks</);
    assert.match(upcoming, />Approx surveys</);
    assert.match(page, /is-readonly/);
    assert.match(page, /Only Tom Sharp can move tiles/);
    assert.match(script, /A2Dominion 2026 - Ph4/);
    const palette = script.slice(script.indexOf("function collectPaletteProjects"), script.indexOf("function buildPalette"));
    assert.match(palette, /P\.current/);
    assert.match(palette, /P\.upcoming/);
    assert.doesNotMatch(palette, /completed|Holiday|OTHER WORK/);
    assert.match(script, /e\.key !== "Delete" && e\.key !== "Backspace"/);
    assert.doesNotMatch(script, /Moved /);
  });
});

describe("resolveProgramme", () => {
  it("starts from the offline draft when nothing is saved and Personnel is empty", () => {
    const board = resolveProgramme({ now: DRAFT_WEEK });
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
      now: DRAFT_WEEK,
      admins: [
        { name: "Phil Moon" },
        { name: "Tom Sharp" },
      ],
      surveyors: [{ name: "Alex Surveyor" }, { name: "peter may", agency: "E" }],
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
    assert.ok(peter);
    assert.equal(peter.flag, "E");
    assert.equal(board.pools.agency_not_on_project.some((person) => canonName(person.name) === "peter may"), false);
    assert.equal(board.pools.team_not_live.some((person) => canonName(person.name) === "peter may"), false);
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
      now: DRAFT_WEEK,
      saved,
      surveyors: [{ name: "Zoe New" }, { name: "Richard Moreing" }],
      admins: [{ name: "Tom Sharp" }, { name: "Zoe Admin" }],
    });
    assert.deepEqual(
      board.rows.map((row) => row.name),
      ["Richard Moreing", "Zoe New"]
    );
    assert.equal(board.rows[0].weeks[0], "Onward");
    assert.equal(board.rows[0].weeks[1], "");
    const peter = board.pools.agency_not_on_project.filter((person) => person.name === "Peter May");
    assert.equal(peter.length, 1);
    assert.equal(peter[0].flag, "F");
    assert.equal(board.pools.team_not_live.some((person) => person.name === "Peter May"), false);
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
      now: DRAFT_WEEK,
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

  it("puts each person in one section from their Personnel agency letter", () => {
    const board = resolveProgramme({
      surveyors: [
        { name: "Bardya Amin", agency: "Ele" },
        { name: "Nia Cole", agency: "Ele" },
        { name: "Alex Surveyor", agency: "Savills" },
        { name: "peter may", agency: "E" },
        { name: "Jeremy Hughes", agency: "F" },
        { name: "Sam Blank", agency: "  " },
        { name: "Alan Henderson", agency: "" },
      ],
    });
    function namesIn(list: { name: string }[], name: string) {
      return list.filter((person) => canonName(person.name) === canonName(name)).map((person) => person.name);
    }
    function places(name: string) {
      return {
        rows: namesIn(board.rows, name).length,
        agency: namesIn(board.pools.agency_not_on_project, name).length,
        team: namesIn(board.pools.team_not_live, name).length,
      };
    }
    assert.deepEqual(places("Bardya Amin"), { rows: 0, agency: 1, team: 0 });
    assert.equal(board.pools.agency_not_on_project.find((person) => person.name === "Bardya Amin")?.flag, "F");
    assert.deepEqual(places("Nia Cole"), { rows: 0, agency: 1, team: 0 });
    assert.equal(board.pools.agency_not_on_project.find((person) => person.name === "Nia Cole")?.flag, "Ele");
    assert.deepEqual(places("Alex Surveyor"), { rows: 0, agency: 1, team: 0 });
    assert.deepEqual(places("peter may"), { rows: 1, agency: 0, team: 0 });
    assert.equal(board.rows.find((row) => canonName(row.name) === "peter may")?.flag, "E");
    assert.deepEqual(places("Jeremy Hughes"), { rows: 0, agency: 1, team: 0 });
    assert.equal(board.pools.agency_not_on_project.find((person) => person.name === "Jeremy Hughes")?.flag, "F");
    assert.deepEqual(places("Sam Blank"), { rows: 1, agency: 0, team: 0 });
    assert.deepEqual(places("Alan Henderson"), { rows: 1, agency: 0, team: 0 });
    assert.deepEqual(places("Richard Moreing"), { rows: 1, agency: 0, team: 0 });
    assert.deepEqual(places("Clive Gray"), { rows: 0, agency: 0, team: 1 });
    const seen = new Set<string>();
    for (const person of [...board.rows, ...board.pools.agency_not_on_project, ...board.pools.team_not_live]) {
      const key = canonName(person.name);
      assert.equal(seen.has(key), false, key);
      seen.add(key);
    }

    const saved = resolveProgramme({
      now: DRAFT_WEEK,
      saved: {
        version: 1,
        ticks: { "Bardya Amin": false, "Richard Moreing": true, "Sam Blank": true },
        applied: { "Bardya Amin": false, "Richard Moreing": true, "Sam Blank": true },
        surveyorOrder: ["Richard Moreing", "Bardya Amin", "Peter May", "Sam Blank"],
        adminOrder: [],
        cells: { "Bardya Amin": ["Onward"], "Richard Moreing": ["LFHA 2026"] },
        flags: { "Bardya Amin": "", "Peter May": "F" },
      },
      surveyors: [
        { name: "Bardya Amin", agency: " ele " },
        { name: "Sam Blank" },
      ],
    });
    assert.equal(saved.rows.some((row) => row.name === "Bardya Amin"), false);
    assert.equal(saved.rows[0].name, "Richard Moreing");
    assert.equal(saved.rows[0].weeks[0], "LFHA 2026");
    assert.ok(saved.rows.some((row) => row.name === "Peter May"));
    assert.ok(saved.rows.some((row) => row.name === "Sam Blank"));
    assert.equal(saved.pools.agency_not_on_project.some((person) => canonName(person.name) === "peter may"), false);
    assert.equal(saved.pools.agency_not_on_project.some((person) => canonName(person.name) === "sam blank"), false);
    assert.equal(saved.pools.team_not_live.some((person) => person.name === "Bardya Amin"), false);
    assert.equal(saved.pools.agency_not_on_project.filter((person) => canonName(person.name) === "bardya amin").length, 1);
  });

  it("does not list one person in both the agency section and the normal surveyor section", () => {
    const script = readFileSync(join(process.cwd(), "public/js/programme.js"), "utf8");
    type FakeEl = {
      id: string;
      textContent: string;
      innerHTML: string;
      className: string;
      title: string;
      draggable: boolean;
      dataset: Record<string, string>;
      style: Record<string, string>;
      children: FakeEl[];
      classList: { add: () => void; remove: () => void; contains: () => boolean };
      appendChild: (child: FakeEl) => FakeEl;
      setAttribute: () => void;
      getAttribute: () => null;
      addEventListener: () => void;
      querySelector: () => null;
      querySelectorAll: () => never[];
      remove: () => void;
      closest: () => null;
    };
    const lists = new Map<string, FakeEl>();
    function fakeEl(id?: string): FakeEl {
      const node: FakeEl = {
        id: id || "",
        textContent: "",
        innerHTML: "",
        className: "",
        title: "",
        draggable: false,
        dataset: {},
        style: {},
        children: [],
        classList: { add() {}, remove() {}, contains: () => false },
        appendChild(child: FakeEl) {
          node.children.push(child);
          return child;
        },
        setAttribute() {},
        getAttribute: () => null,
        addEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        remove() {},
        closest: () => null,
      };
      if (id) lists.set(id, node);
      return node;
    }
    const dataEl = fakeEl("programme-data");
    dataEl.textContent = JSON.stringify({
      canEdit: false,
      weeks: ["2026-09-21"],
      rows: [
        { name: "Bardya Amin", flag: "", weeks: [""] },
        { name: "Nia Cole", flag: "Ele", weeks: [""] },
        { name: "Alex Surveyor", flag: "", weeks: [""] },
        { name: "Jeremy Hughes", flag: "F", weeks: [""] },
        { name: "Sam Blank", flag: "", weeks: [""] },
        { name: "Richard Moreing", flag: "", weeks: ["LFHA 2026"] },
      ],
      admins: [],
      pools: {
        agency_not_on_project: [
          { flag: "F", name: "Bardya Amin" },
          { flag: "Ele", name: "Nia Cole" },
          { flag: "F", name: "Jeremy Hughes" },
        ],
        team_not_live: [
          { flag: "", name: "Alan Henderson" },
          { flag: "", name: "Clive Gray" },
        ],
      },
      ticks: {
        "Bardya Amin": true,
        "Nia Cole": true,
        "Alex Surveyor": false,
        "Jeremy Hughes": true,
        "Sam Blank": true,
        "Richard Moreing": true,
      },
      applied: {
        "Bardya Amin": true,
        "Nia Cole": true,
        "Alex Surveyor": false,
        "Jeremy Hughes": true,
        "Sam Blank": true,
        "Richard Moreing": true,
      },
      projects: { current: [], upcoming: [], completed: [] },
      notes: {},
      adminNames: [],
    });
    const thead = fakeEl();
    const tbody = fakeEl();
    const document = {
      getElementById(id: string) {
        if (id === "programme-data") return dataEl;
        return lists.get(id) || fakeEl(id);
      },
      querySelector(sel: string) {
        if (sel === "#matrix thead") return thead;
        if (sel === "#matrix tbody") return tbody;
        return null;
      },
      querySelectorAll: () => [],
      createElement: () => fakeEl(),
      addEventListener() {},
    };
    vm.runInNewContext(script, { document, window: { addEventListener() {} } });
    function poolNames(id: string) {
      return (lists.get(id)?.children || []).map((li) => {
        const name = li.children.find((child) => child.className === "name");
        return name?.textContent || "";
      });
    }
    const onBoard = tbody.children
      .flatMap((row: FakeEl) => row.children)
      .filter((cell: FakeEl) => cell.className === "surveyor")
      .map((cell: FakeEl) => cell.textContent);
    assert.deepEqual(poolNames("agencyPool").filter(Boolean), []);
    assert.deepEqual(poolNames("teamPool"), ["Alan Henderson", "Clive Gray", "Alex Surveyor"]);
    assert.deepEqual(onBoard, ["Bardya Amin", "Nia Cole", "Jeremy Hughes", "Sam Blank", "Richard Moreing"]);
    function hasTick(id: string) {
      return (lists.get(id)?.children || []).every((li) =>
        li.children.some((child) => child.className === "active-hit pool-active-hit" && child.children.some((input) => input.className === "active-cb pool-active-cb"))
      );
    }
    assert.equal(hasTick("teamPool"), true);
    assert.match(script, /tick then hit Refresh to return to the main table/);
    assert.doesNotMatch(script, /if \(p\.fromGrid\) \{\s*var hit/);
  });

  it("keeps Shahid Hanif and Djibril Hanif on the main table when Personnel marks them as agency", () => {
    const board = resolveProgramme({
      now: DRAFT_WEEK,
      surveyors: [
        { name: "Shahid Hanif", agency: "E" },
        { name: "Djibril Hanif", agency: "E" },
        { name: "New Agency", agency: "Ele" },
        { name: "New Surveyor" },
      ],
    });
    for (const name of ["Shahid Hanif", "Djibril Hanif"]) {
      const rows = board.rows.filter((row) => row.name === name);
      assert.equal(rows.length, 1, name);
      assert.ok(rows[0].weeks.includes("Onward"), name);
      assert.equal(board.pools.agency_not_on_project.some((person) => person.name === name), false, name);
      assert.equal(board.pools.team_not_live.some((person) => person.name === name), false, name);
    }
    assert.equal(board.pools.agency_not_on_project.filter((person) => person.name === "New Agency").length, 1);
    assert.equal(board.rows.some((row) => row.name === "New Agency"), false);
    assert.equal(board.pools.team_not_live.some((person) => person.name === "New Agency"), false);
    assert.equal(board.rows.filter((row) => row.name === "New Surveyor").length, 1);
    assert.equal(board.pools.agency_not_on_project.some((person) => person.name === "New Surveyor"), false);
    assert.equal(board.pools.team_not_live.some((person) => person.name === "New Surveyor"), false);

    const dropped = resolveProgramme({
      now: DRAFT_WEEK,
      saved: {
        version: 1,
        ticks: {},
        applied: {},
        surveyorOrder: ["Richard Moreing"],
        adminOrder: [],
        cells: { "Richard Moreing": ["LFHA 2026"] },
        flags: {},
      },
      surveyors: [
        { name: "Shahid Hanif", agency: "E" },
        { name: "Djibril Hanif", agency: "E" },
      ],
    });
    assert.equal(dropped.rows.find((row) => row.name === "Shahid Hanif")?.weeks[0], "Onward");
    assert.equal(dropped.rows.find((row) => row.name === "Djibril Hanif")?.weeks[0], "Onward");
    assert.equal(dropped.pools.agency_not_on_project.some((person) => /hanif/i.test(person.name)), false);
    assert.equal(dropped.pools.team_not_live.some((person) => /hanif/i.test(person.name)), false);
  });

  it("puts an unticked person in one bottom table and brings them back when ticked", () => {
    const off = resolveProgramme({
      now: DRAFT_WEEK,
      saved: {
        version: 1,
        ticks: { "Shahid Hanif": false, "Richard Moreing": false },
        applied: { "Shahid Hanif": false, "Richard Moreing": false },
        surveyorOrder: ["Richard Moreing", "Shahid Hanif"],
        adminOrder: [],
        cells: {
          "Shahid Hanif": ["Onward", "Onward"],
          "Richard Moreing": ["LFHA 2026"],
        },
        flags: { "Shahid Hanif": "E" },
      },
      surveyors: [
        { name: "Shahid Hanif", agency: "E" },
        { name: "Richard Moreing" },
      ],
    });
    assert.equal(off.rows.some((row) => row.name === "Shahid Hanif"), false);
    assert.equal(off.rows.some((row) => row.name === "Richard Moreing"), false);
    const shahid = off.pools.agency_not_on_project.filter((person) => person.name === "Shahid Hanif");
    assert.equal(shahid.length, 1);
    assert.equal(shahid[0].weeks?.[0], "Onward");
    assert.equal(off.pools.team_not_live.some((person) => person.name === "Shahid Hanif"), false);
    const richard = off.pools.team_not_live.filter((person) => person.name === "Richard Moreing");
    assert.equal(richard.length, 1);
    assert.equal(richard[0].weeks?.[0], "LFHA 2026");
    assert.equal(off.pools.agency_not_on_project.some((person) => person.name === "Richard Moreing"), false);

    const back = resolveProgramme({
      now: DRAFT_WEEK,
      saved: {
        version: 1,
        ticks: { "Shahid Hanif": true, "Richard Moreing": true },
        applied: { "Shahid Hanif": true, "Richard Moreing": true },
        surveyorOrder: ["Richard Moreing", "Shahid Hanif"],
        adminOrder: [],
        cells: {
          "Shahid Hanif": ["Onward", "Onward"],
          "Richard Moreing": ["LFHA 2026"],
        },
        flags: { "Shahid Hanif": "E" },
      },
      surveyors: [
        { name: "Shahid Hanif", agency: "E" },
        { name: "Richard Moreing" },
      ],
    });
    assert.equal(back.rows.find((row) => row.name === "Shahid Hanif")?.weeks[0], "Onward");
    assert.equal(back.rows.find((row) => row.name === "Richard Moreing")?.weeks[0], "LFHA 2026");
    assert.equal(back.pools.agency_not_on_project.some((person) => person.name === "Shahid Hanif"), false);
    assert.equal(back.pools.team_not_live.some((person) => person.name === "Richard Moreing"), false);
  });

  it("skips frozen Personnel when adding people", () => {
    const board = resolveProgramme({
      now: DRAFT_WEEK,
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
      now: DRAFT_WEEK,
      saved,
      surveyors: [],
      admins: [{ name: "Phil Moon" }],
    });
    const peter = board.pools.agency_not_on_project.find((person) => person.name === "Peter May");
    assert.equal(peter?.weeks?.[0], "Holiday");
    assert.equal(peter?.weeks?.[1], "Onward");
    assert.equal(board.rows.some((row) => row.name === "Peter May"), false);
    assert.equal(board.admins[0].name, "Phil Moon");
    assert.equal(parseSavedBoard(saved)?.surveyorOrder[0], "Peter May");
  });

  it("rejects an empty surveyor list so a bad save cannot wipe the draft", () => {
    assert.equal(boardFromClient({ surveyors: [], admins: [] }), null);
    assert.equal(boardFromClient(null), null);
    assert.equal(parseSavedBoard({ version: 2 }), null);
  });
});

describe("programme week columns", () => {
  function assertConsecutiveMondays(weeks: string[]) {
    assert.equal(weeks.length, programmeSeed.weeks.length);
    for (let i = 1; i < weeks.length; i++) {
      const prev = Date.parse(`${weeks[i - 1]}T00:00:00Z`);
      const next = Date.parse(`${weeks[i]}T00:00:00Z`);
      assert.equal(next - prev, 7 * 24 * 60 * 60 * 1000);
    }
  }

  it("keeps the previous week as column one before Monday 04:00 London", () => {
    // Monday 28 Sep 2026 03:59 Europe/London (BST, UTC+1).
    const board = resolveProgramme({ now: new Date("2026-09-28T02:59:59.000Z") });
    assert.equal(board.weeks[0], "2026-09-21");
    assert.equal(board.weeks[1], "2026-09-28");
    assert.equal(board.weeks.at(-1), "2027-12-27");
    assertConsecutiveMondays(board.weeks);
    assert.deepEqual(board.weeks, programmeSeed.weeks);
    const paul = board.rows.find((row) => row.name === "Paul Lear");
    assert.equal(paul?.weeks[0], "Holiday");
    assert.equal(paul?.weeks[1], "Onward");
  });

  it("does not keep 21 September as column one once that Monday is before 04:00", () => {
    // Monday 21 Sep 2026 03:59 Europe/London. The draft's old first week has not opened yet.
    const board = resolveProgramme({ now: new Date("2026-09-21T02:59:00.000Z") });
    assert.equal(board.weeks[0], "2026-09-14");
    assert.equal(board.weeks[1], "2026-09-21");
    assertConsecutiveMondays(board.weeks);
    const paul = board.rows.find((row) => row.name === "Paul Lear");
    assert.equal(paul?.weeks[0], "");
    assert.equal(paul?.weeks[1], "Holiday");
  });

  it("uses the new week as column one from Monday 04:00 London", () => {
    // Monday 28 Sep 2026 04:00 Europe/London (BST, UTC+1).
    const board = resolveProgramme({ now: new Date("2026-09-28T03:00:00.000Z") });
    assert.equal(board.weeks[0], "2026-09-28");
    assert.equal(board.weeks[1], "2026-10-05");
    assert.equal(board.weeks.at(-1), "2028-01-03");
    assertConsecutiveMondays(board.weeks);
    assert.equal(board.weeks.length, programmeVisibleWeeks(DRAFT_WEEK).length);
    const paul = board.rows.find((row) => row.name === "Paul Lear");
    assert.equal(paul?.weeks[0], "Onward");
    const peter = board.rows.find((row) => row.name === "Peter May");
    assert.equal(peter?.weeks[4], "Holiday");
  });

  it("rolls forward at 04:00 Europe/London in winter as well as summer", () => {
    // Monday 4 Jan 2027 is GMT (UTC+0).
    const before = resolveProgramme({ now: new Date("2027-01-04T03:59:00.000Z") });
    const after = resolveProgramme({ now: new Date("2027-01-04T04:00:00.000Z") });
    assert.equal(before.weeks[0], "2026-12-28");
    assert.equal(after.weeks[0], "2027-01-04");
    assert.equal(before.weeks[1], after.weeks[0]);
    assert.equal(before.weeks.length, after.weeks.length);
    assertConsecutiveMondays(before.weeks);
    assertConsecutiveMondays(after.weeks);
    const richardBefore = before.rows.find((row) => row.name === "Richard Moreing");
    const richardAfter = after.rows.find((row) => row.name === "Richard Moreing");
    assert.equal(richardBefore?.weeks[0], "Festive Period");
    assert.equal(richardBefore?.weeks[2], "MTVH");
    assert.equal(richardAfter?.weeks[0], richardBefore?.weeks[1]);
    assert.equal(richardAfter?.weeks[1], "MTVH");
  });

  it("keeps a stamp on its calendar week and stores weeks that scroll off the left", () => {
    const windowNow = new Date("2026-09-28T03:00:00.000Z");
    const visible = programmeVisibleWeeks(windowNow);
    assert.equal(visible[0], "2026-09-28");
    const shown = resolveProgramme({ now: windowNow });
    const paulShown = shown.rows.find((row) => row.name === "Paul Lear");
    assert.ok(paulShown);
    const edited = paulShown.weeks.slice();
    edited[0] = "Edited";
    const saved = boardFromClient({
      weeks: visible,
      surveyors: [{ name: "Paul Lear", flag: "", weeks: edited }],
      admins: [{ name: "Tom Sharp", flag: "", weeks: visible.map(() => "") }],
    });
    assert.ok(saved);
    assert.equal(saved.weekOrigin, "2026-09-21");
    assert.equal(saved.cells["Paul Lear"][0], "Holiday");
    assert.equal(saved.cells["Paul Lear"][1], "Edited");
    const parsed = parseSavedBoard(saved);
    assert.equal(parsed?.weekOrigin, "2026-09-21");
    assert.equal(parsed?.cells["Paul Lear"][0], "Holiday");

    const afterSave = resolveProgramme({ saved, now: windowNow });
    assert.equal(afterSave.weeks[0], "2026-09-28");
    assert.equal(afterSave.rows.find((row) => row.name === "Paul Lear")?.weeks[0], "Edited");

    const earlier = resolveProgramme({ saved, now: DRAFT_WEEK });
    assert.equal(earlier.weeks[0], "2026-09-21");
    assert.equal(earlier.rows.find((row) => row.name === "Paul Lear")?.weeks[0], "Holiday");
    assert.equal(earlier.rows.find((row) => row.name === "Paul Lear")?.weeks[1], "Edited");

    const laterNow = new Date("2026-10-05T12:00:00.000Z");
    const laterVisible = programmeVisibleWeeks(laterNow);
    assert.equal(laterVisible[0], "2026-10-05");
    const laterShown = resolveProgramme({ saved, now: laterNow });
    const laterEdited = (laterShown.rows.find((row) => row.name === "Paul Lear")?.weeks || []).slice();
    laterEdited[0] = "Next";
    const second = boardFromClient(
      {
        weeks: laterVisible,
        surveyors: [{ name: "Paul Lear", flag: "", weeks: laterEdited }],
        admins: [{ name: "Tom Sharp", flag: "", weeks: laterVisible.map(() => "") }],
      },
      { previous: saved }
    );
    assert.ok(second);
    assert.equal(second.weekOrigin, "2026-09-21");
    assert.equal(second.cells["Paul Lear"][0], "Holiday");
    assert.equal(second.cells["Paul Lear"][1], "Edited");
    assert.equal(second.cells["Paul Lear"][2], "Next");
    const laterBoard = resolveProgramme({ saved: second, now: laterNow });
    assert.equal(laterBoard.weeks[0], "2026-10-05");
    assert.equal(laterBoard.rows.find((row) => row.name === "Paul Lear")?.weeks[0], "Next");
  });
});

describe("programmeShortLabel", () => {
  it("keeps short project names and shortens long Current/Upcoming names", () => {
    assert.equal(programmeShortLabel("Onward"), "Onward");
    assert.equal(programmeShortLabel("LFHA 2026"), "LFHA");
    assert.equal(programmeShortLabel("Vico 2026"), "Vico");
    assert.equal(programmeShortLabel("Cornwall 2026 Ph2"), "Cornwall");
    assert.equal(programmeShortLabel("A2Dominion 2026 - Ph4"), "A2D Ph4");
    assert.equal(programmeShortLabel("A2Dominion 2027 - Ph2"), "A2D Ph2");
    assert.equal(programmeShortLabel("  "), "");
  });
});

describe("projectWeeksOnGrid", () => {
  it("counts every tile on the main grid, including two people in the same week", () => {
    const people = [
      { weeks: ["Onward", "Onward", ""], active: true },
      { weeks: ["Onward", "LFHA 2026", ""], active: true },
      { weeks: ["Onward", "Onward", "Onward"], active: false },
      { weeks: ["LFHA 2026", "LFHA 2026", "Holiday"], active: true },
    ];
    assert.equal(projectWeeksOnGrid("Onward", people), 3);
    assert.equal(projectWeeksOnGrid("lfha  2026", people), 3);
    assert.equal(projectWeeksOnGrid("Holiday", people), 1);
    assert.equal(projectWeeksOnGrid("Missing", people), 0);
    assert.equal(projectWeeksOnGrid("Onward", [{ weeks: ["Onward"], active: false }]), 0);
    assert.equal(approxSurveysOnGrid("Onward", people), 120);
    assert.equal(approxSurveysOnGrid("Holiday", people), 40);
    assert.equal(approxSurveysOnGrid("Missing", people), 0);
  });

  it("counts short stamps and full names as the same project, one per tile", () => {
    const people = [
      { weeks: ["LFHA", "A2D Ph4", "Cornwall", "LFHA 2026"], active: true },
      { weeks: ["LFHA", "Vico", "A2Dominion 2026 – Ph 4", ""], active: true },
      { weeks: ["LFHA 2026", "LFHA", "LFHA", "LFHA"], active: false },
    ];
    const catalogue = ["LFHA 2026", "A2Dominion 2026 - Ph4", "Cornwall 2026 Ph2", "Vico", "Onward"];
    assert.equal(projectWeeksOnGrid("LFHA 2026", people, catalogue), 3);
    assert.equal(projectWeeksOnGrid("A2Dominion 2026 - Ph4", people, catalogue), 2);
    assert.equal(projectWeeksOnGrid("Cornwall 2026 Ph2", people, catalogue), 1);
    assert.equal(projectWeeksOnGrid("Vico", people, catalogue), 1);
    assert.equal(projectWeeksOnGrid("Onward", people, catalogue), 0);
    assert.equal(approxSurveysOnGrid("LFHA 2026", people, catalogue), 120);
    assert.equal(approxSurveysOnGrid("Vico", people, catalogue), 40);
    assert.equal(programmeCellMatchesProject("LFHA 2025", "LFHA 2026", catalogue), false);
    assert.equal(programmeCellMatchesProject("Saxon", "Saxon Weald Ph 4", ["Saxon Weald Ph 4"]), true);
    assert.equal(programmeCellMatchesProject("Vico", "Vico 2026", ["Vico", "Vico 2026"]), false);
    assert.equal(programmeCellMatchesProject("Vico 2026", "Vico", ["Vico", "Vico 2026"]), false);
    const shared = programmeShortLabel("Hello Project Alpha");
    assert.equal(shared, programmeShortLabel("Hello Project Beta"));
    const longNames = ["Hello Project Alpha", "Hello Project Beta"];
    assert.equal(programmeCellMatchesProject(shared, "Hello Project Alpha", longNames), false);
    assert.equal(programmeCellMatchesProject("Hello Project Alpha", "Hello Project Alpha", longNames), true);
  });

  it("counts a shorter week-cell name for the one project that adds a year or number", () => {
    const catalogue = ["MTVH 20126", "Onward 2026", "Leeds 2026", "Leeds North 2026"];
    assert.equal(programmeShortLabel("MTVH 20126"), "MTVH 20126");
    assert.equal(programmeShortLabel("Onward 2026"), "Onward 2026");
    assert.equal(programmeShortLabel("Leeds 2026"), "Leeds 2026");
    assert.equal(programmeCellMatchesProject("MTVH", "MTVH 20126", catalogue), true);
    assert.equal(programmeCellMatchesProject("MTVH", "MTVH 2026", ["MTVH 2026"]), true);
    assert.equal(programmeCellMatchesProject("Onward", "Onward 2026", catalogue), true);
    assert.equal(programmeCellMatchesProject("Onward 2026", "Onward", ["Onward"]), true);
    assert.equal(programmeCellMatchesProject("Leeds", "Leeds 2026", catalogue), true);
    assert.equal(programmeCellMatchesProject("Leeds", "Leeds North 2026", catalogue), false);
    assert.equal(programmeCellMatchesProject("North", "Leeds North 2026", catalogue), false);
    assert.equal(programmeCellMatchesProject("Onward", "Onward 2026", ["Onward 2026", "Onward 2027"]), false);
    assert.equal(programmeCellMatchesProject("Onward", "Onward 2027", ["Onward 2026", "Onward 2027"]), false);
    assert.equal(programmeCellMatchesProject("Holiday", "MTVH 20126", catalogue), false);
    assert.equal(programmeCellMatchesProject("LFHA 2025", "LFHA 2026", ["LFHA 2026"]), false);
    const people = [
      { weeks: ["MTVH", "Onward", "Leeds", "Leeds North"], active: true },
      { weeks: ["MTVH", "MTVH", "Onward 2026", "Leeds"], active: true },
      { weeks: ["MTVH", "Onward", "Leeds", "Holiday"], active: false },
    ];
    assert.equal(projectWeeksOnGrid("MTVH 20126", people, catalogue), 3);
    assert.equal(projectWeeksOnGrid("Onward 2026", people, catalogue), 2);
    assert.equal(projectWeeksOnGrid("Leeds 2026", people, catalogue), 2);
    assert.equal(projectWeeksOnGrid("Leeds North 2026", people, catalogue), 1);
    assert.equal(approxSurveysOnGrid("MTVH 20126", people, catalogue), 120);
    assert.equal(approxSurveysOnGrid("Leeds 2026", people, catalogue), 80);
  });

  it("uses the same stamp match in the browser script", () => {
    const script = readFileSync(join(process.cwd(), "public/js/programme.js"), "utf8");
    const start = script.indexOf("var SHORT_LABELS");
    const end = script.indexOf("function adminCanonSet");
    const context: { programmeCellMatches?: (cell: string, project: string, catalogue: string[]) => boolean } = {};
    vm.runInNewContext(script.slice(start, end), context);
    assert.equal(typeof context.programmeCellMatches, "function");
    const cases: { cell: string; project: string; catalogue: string[] }[] = [
      { cell: "LFHA", project: "LFHA 2026", catalogue: ["LFHA 2026", "Onward"] },
      { cell: "A2D Ph4", project: "A2Dominion 2026 - Ph4", catalogue: ["A2Dominion 2026 - Ph4", "A2Dominion 2027 - Ph2"] },
      { cell: "A2Dominion 2026 – Ph 4", project: "A2Dominion 2026 - Ph4", catalogue: ["A2Dominion 2026 - Ph4"] },
      { cell: "Cornwall", project: "Cornwall 2026 Ph2", catalogue: ["Cornwall 2026 Ph2"] },
      { cell: "Vico 2026", project: "Vico", catalogue: ["Vico"] },
      { cell: "LFHA", project: "LFHA 2026", catalogue: ["LFHA", "LFHA 2026"] },
      { cell: "LFHA 2025", project: "LFHA 2026", catalogue: ["LFHA 2026"] },
      { cell: "Holiday", project: "Onward", catalogue: ["Onward"] },
      { cell: "Onward", project: "Onward", catalogue: ["Onward", "LFHA 2026"] },
      { cell: "MTVH", project: "MTVH 20126", catalogue: ["MTVH 20126", "Onward 2026", "Leeds 2026"] },
      { cell: "MTVH", project: "MTVH 2026", catalogue: ["MTVH 2026"] },
      { cell: "Onward", project: "Onward 2026", catalogue: ["Onward 2026", "Leeds 2026"] },
      { cell: "Leeds", project: "Leeds 2026", catalogue: ["Leeds 2026", "Leeds North 2026"] },
      { cell: "Leeds", project: "Leeds North 2026", catalogue: ["Leeds 2026", "Leeds North 2026"] },
      { cell: "Onward", project: "Onward 2026", catalogue: ["Onward 2026", "Onward 2027"] },
    ];
    for (const row of cases) {
      assert.equal(
        context.programmeCellMatches!(row.cell, row.project, row.catalogue),
        programmeCellMatchesProject(row.cell, row.project, row.catalogue),
        `${row.cell} → ${row.project}`
      );
    }
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

describe("job tile colours", () => {
  const catalogue = ["LFHA 2026", "A2Dominion 2026 - Ph4", "Cornwall 2026 Ph2", "Vico 2026", "Onward", "MTVH", "BPHA 2026 ACQ"];

  function contrast(background: string, color: string): number {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = (hex: string) => rgb(hex).reduce((sum, v, i) => sum + [0.2126, 0.7152, 0.0722][i] * lin(v), 0);
    const hi = Math.max(lum(background), lum(color));
    const lo = Math.min(lum(background), lum(color));
    return (hi + 0.05) / (lo + 0.05);
  }

  it("uses one colour for a project on the stamp and on the grid, including its short name", () => {
    assert.deepEqual(jobTileColor("LFHA", catalogue), jobTileColor("LFHA 2026", catalogue));
    assert.deepEqual(jobTileColor("A2D Ph4", catalogue), jobTileColor("A2Dominion 2026 - Ph4", catalogue));
    assert.deepEqual(jobTileColor("Cornwall", catalogue), jobTileColor("Cornwall 2026 Ph2", catalogue));
    assert.equal(jobTileColorKey("LFHA", catalogue), "LFHA 2026");
    assert.equal(jobTileColorKey("LFHA 2026", catalogue), "LFHA 2026");
    const seen = new Map<string, string>();
    for (const name of catalogue) {
      const bg = jobTileColor(name, catalogue).background;
      assert.equal(seen.has(bg), false, `${name} shares ${bg} with ${seen.get(bg)}`);
      seen.set(bg, name);
      assert.ok(contrast(jobTileColor(name, catalogue).background, jobTileColor(name, catalogue).color) >= 4.5);
    }
  });

  it("keeps Holiday on the old clear fill with red text", () => {
    const holiday = jobTileColor("Holiday", catalogue);
    const festive = jobTileColor("Festive Period", catalogue);
    const other = jobTileColor("OTHER WORK", catalogue);
    assert.deepEqual(holiday, { background: "#eeeeee", color: "#c62828" });
    assert.deepEqual(festive, holiday);
    assert.notDeepEqual(holiday, other);
    assert.notDeepEqual(other, jobTileColor("MTVH", catalogue));
    assert.deepEqual(jobTileColor("Holiday", catalogue), jobTileColor("  Holiday  ", catalogue));
    assert.notDeepEqual(jobTileColor("Onward", catalogue), holiday);
    assert.deepEqual(jobTileColor("MTVH", ["MTVH 20126"]), jobTileColor("MTVH 20126", ["MTVH 20126"]));
    assert.deepEqual(jobTileColor("Onward", ["Onward 2026"]), jobTileColor("Onward 2026", ["Onward 2026"]));
    assert.deepEqual(jobTileColor("Leeds", ["Leeds 2026"]), jobTileColor("Leeds 2026", ["Leeds 2026"]));
    assert.notDeepEqual(jobTileColor("Leeds", ["Leeds 2026", "Leeds North 2026"]), jobTileColor("Leeds North 2026", ["Leeds 2026", "Leeds North 2026"]));
    assert.notDeepEqual(jobTileColor("Vico", ["Vico", "Vico 2026"]), jobTileColor("Vico 2026", ["Vico", "Vico 2026"]));
  });

  it("paints the top project tiles and the week cells with the same browser colours", () => {
    const script = readFileSync(join(process.cwd(), "public/js/programme.js"), "utf8");
    assert.match(script, /tile\.className = "palette-tile"/);
    assert.match(script, /jobTileColor\(name, catalogue\)/);
    assert.match(script, /jobTileColor\(val, collectPaletteProjects\(\)\)/);
    assert.doesNotMatch(script.slice(script.indexOf("function buildPalette"), script.indexOf("function fillPool")), /palette-tile " \+ st\.cls/);
    const matchPart = script.slice(script.indexOf("var SHORT_LABELS"), script.indexOf("function adminCanonSet"));
    const colorPart = script.slice(script.indexOf("function jobTileHash"), script.indexOf("function paintCell"));
    const context: {
      jobTileColor?: (text: string, catalogue?: string[]) => { background: string; color: string };
      jobTileColorKey?: (text: string, catalogue?: string[]) => string;
    } = {};
    vm.runInNewContext(`${matchPart}\n${colorPart}`, context);
    function sameTone(text: string) {
      const fromBrowser = context.jobTileColor!(text, catalogue);
      const fromServer = jobTileColor(text, catalogue);
      assert.equal(fromBrowser.background, fromServer.background, text);
      assert.equal(fromBrowser.color, fromServer.color, text);
    }
    sameTone("LFHA");
    sameTone("LFHA 2026");
    sameTone("Holiday");
    assert.equal(context.jobTileColorKey!("A2D Ph4", catalogue), jobTileColorKey("A2D Ph4", catalogue));
    assert.equal(context.jobTileColorKey!("Festive Period", catalogue), "Festive Period");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildProgrammeWorkbook,
  parseProgrammeExport,
  programmeContentDisposition,
  programmeExportFilename,
  weekColumnLabel,
} from "./programme-export.js";

const NOW = new Date("2026-09-22T15:00:00Z");

describe("programme Excel export", () => {
  it("names the file and workbook title BHC Programme DD-MM-YYYY", () => {
    assert.equal(programmeExportFilename(NOW), "BHC Programme 22-09-2026.xlsx");
    assert.equal(weekColumnLabel("2026-09-21"), "21 Sep 26");
    assert.match(programmeContentDisposition("BHC Programme 22-09-2026.xlsx"), /filename="BHC Programme 22-09-2026.xlsx"/);
    assert.match(
      programmeContentDisposition("BHC Programme 22-09-2026.xlsx"),
      /filename\*=UTF-8''BHC%20Programme%2022-09-2026.xlsx/
    );
  });

  it("exports the on-board programme, pools without admins, and current-project week counts", () => {
    const parsed = parseProgrammeExport({
      weeks: ["2026-09-21", "2026-09-28"],
      people: [
        { name: "Richard Moreing", flag: "", role: "surveyor", active: true, weeks: ["Onward", ""] },
        { name: "Peter May", flag: "F", role: "surveyor", active: false, weeks: ["Onward", "Onward"] },
        { name: "Greg Kowalski", flag: "", role: "admin", active: true, weeks: ["Onward", "LFHA 2026"] },
      ],
      agency: [{ name: "Bardya Amin", flag: "F" }],
      team: [
        { name: "Greg Kowalski", flag: "" },
        { name: "Alan Henderson", flag: "" },
      ],
      projects: [
        { project: "Onward", numbers: "12", surveyTypes: "Condition Only", lead: "Greg Kowalski" },
        { project: "LFHA 2026", numbers: "4", surveyTypes: "Blocks", lead: "Tom Sharp" },
        { project: "Only off the board", numbers: "1", surveyTypes: "", lead: "" },
      ],
    });
    assert.ok(parsed);
    const built = buildProgrammeWorkbook(parsed, NOW);
    assert.equal(built.filename, "BHC Programme 22-09-2026.xlsx");
    assert.equal(built.title, "BHC Programme 22-09-2026");

    const wb = XLSX.read(built.buffer, { type: "buffer" });
    assert.equal(wb.Props?.Title, "BHC Programme 22-09-2026");
    assert.deepEqual(wb.SheetNames, ["Programme", "Pools", "Current projects"]);

    const programme = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Programme, { header: 1, defval: "" });
    assert.equal(programme[0][0], "BHC Programme 22-09-2026");
    assert.deepEqual(programme[1].slice(0, 5), ["Active", "Role", "Surveyor", "F/E", "21 Sep 26"]);
    assert.equal(programme[1][5], "28 Sep 26");
    const names = programme.slice(2).map((row) => row[2]);
    assert.deepEqual(names, ["Richard Moreing", "Greg Kowalski"]);
    assert.equal(programme[3][1], "Admin");
    assert.equal(programme[3][5], "LFHA 2026");

    const pools = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Pools);
    assert.deepEqual(
      pools.map((row) => row.Name),
      ["Bardya Amin", "Alan Henderson"]
    );
    assert.equal(pools[1].Pool, "Team — not currently live");

    const projects = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets["Current projects"]);
    assert.equal(projects[0]["Nr of Weeks"], 1);
    assert.equal(projects[1]["Nr of Weeks"], 1);
    assert.equal(projects[2]["Nr of Weeks"], 0);
    assert.equal(projects[0].Stock, "12");
    assert.equal(projects[0]["Project manager"], "Greg Kowalski");
  });

  it("rejects a payload that is not an export object", () => {
    assert.equal(parseProgrammeExport(null), null);
    assert.equal(parseProgrammeExport([]), null);
    assert.equal(parseProgrammeExport("board"), null);
  });
});

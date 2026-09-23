import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  buildProgrammeWorkbook,
  parseProgrammeExport,
  programmeContentDisposition,
  programmeExportFilename,
  weekColumnLabel,
} from "./programme-export.js";

const NOW = new Date("2026-09-22T15:00:00Z");

function patternFill(cell: ExcelJS.Cell): string | undefined {
  const fill = cell.fill;
  if (fill && fill.type === "pattern") return fill.fgColor?.argb;
  return undefined;
}

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

  it("exports the on-board programme and current-project week counts", async () => {
    const parsed = parseProgrammeExport({
      weeks: ["2026-09-21", "2026-09-28"],
      people: [
        { name: "Richard Moreing", flag: "", role: "surveyor", active: true, weeks: ["Onward", "Holiday"] },
        { name: "Peter May", flag: "F", role: "surveyor", active: false, weeks: ["Onward", "Onward"] },
        { name: "Greg Kowalski", flag: "", role: "admin", active: true, weeks: ["Onward", "LFHA 2026"] },
        { name: "Ada Blank", flag: "F", role: "surveyor", active: true, weeks: ["", "Site North"] },
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
    const built = await buildProgrammeWorkbook(parsed, NOW);
    assert.equal(built.filename, "BHC Programme 22-09-2026.xlsx");
    assert.equal(built.title, "BHC Programme 22-09-2026");

    const xlsxWb = XLSX.read(built.buffer, { type: "buffer" });
    assert.equal(xlsxWb.Props?.Title, "BHC Programme 22-09-2026");
    assert.deepEqual(xlsxWb.SheetNames, ["Programme", "Current projects"]);
    assert.equal(
      xlsxWb.SheetNames.some((name) => /pool/i.test(name)),
      false
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(built.buffer as unknown as ExcelJS.Buffer);
    assert.equal(wb.title, "BHC Programme 22-09-2026");
    assert.deepEqual(
      wb.worksheets.map((sheet) => sheet.name),
      ["Programme", "Current projects"]
    );

    const programme = wb.getWorksheet("Programme");
    assert.ok(programme);
    assert.equal(programme.views[0]?.zoomScale, 80);
    assert.equal(programme.views[0]?.zoomScaleNormal, 80);
    assert.equal(programme.getCell("A1").value, "BHC Programme 22-09-2026");
    assert.equal(programme.getCell("A1").font?.name, "Aptos");
    assert.equal(programme.getCell("A1").font?.size, 10);

    assert.equal(programme.getCell("A2").value, "Active");
    assert.equal(programme.getCell("B2").value, "Surveyor");
    assert.equal(programme.getCell("C2").value, "F/E");
    assert.equal(programme.getCell("D2").value, "21 Sep 26");
    assert.equal(programme.getCell("E2").value, "28 Sep 26");
    assert.equal(patternFill(programme.getCell("A2")), "FF0B1F33");
    assert.equal(programme.getCell("A2").font?.color?.argb, "FFFFFFFF");
    assert.equal(programme.getCell("A2").font?.name, "Aptos");
    assert.equal(programme.getCell("A2").font?.size, 10);
    assert.equal(programme.getCell("D2").font?.bold, true);

    assert.equal(programme.getCell("B3").value, "Richard Moreing");
    assert.equal(patternFill(programme.getCell("B3")), "FFF7F9FB");
    assert.equal(programme.getCell("B3").font?.color?.argb, "FF0B1F33");
    assert.equal(programme.getCell("B3").font?.bold, true);
    assert.equal(patternFill(programme.getCell("A3")), "FFF0F3F6");
    assert.equal(programme.getCell("D3").value, "Onward");
    assert.equal(patternFill(programme.getCell("D3")), "FFD9EAD3");
    assert.equal(programme.getCell("D3").font?.color?.argb, "FF1E3D1A");
    assert.equal(programme.getCell("E3").value, "Holiday");
    assert.equal(patternFill(programme.getCell("E3")), "FFEEEEEE");
    assert.equal(programme.getCell("E3").font?.color?.argb, "FFC62828");
    assert.equal(programme.getCell("E3").font?.bold, true);

    assert.equal(programme.getCell("B4").value, "Greg Kowalski");
    assert.equal(patternFill(programme.getCell("B4")), "FFEEF3F8");
    assert.equal(programme.getCell("B4").font?.italic, true);
    assert.equal(programme.getCell("B4").font?.color?.argb, "FF5C6B7A");
    assert.equal(programme.getCell("A4").value, "Yes");
    assert.equal(patternFill(programme.getCell("A4")), "FFE8EEF5");
    assert.equal(programme.getCell("E4").value, "LFHA 2026");
    assert.equal(patternFill(programme.getCell("E4")), "FFFCE5CD");
    assert.equal(programme.getCell("E4").font?.color?.argb, "FF6B3F00");

    assert.equal(programme.getCell("B5").value, "Ada Blank");
    assert.equal(programme.getCell("C5").value, "F");
    assert.equal(programme.getCell("D5").value, "");
    assert.equal(patternFill(programme.getCell("D5")), "FFFFFFFF");
    assert.equal(patternFill(programme.getCell("B5")), "FFF7F9FB");
    const unknownFill = patternFill(programme.getCell("E5"));
    assert.ok(unknownFill && unknownFill !== "FFFFFFFF");
    for (const row of [3, 4, 5]) {
      for (let col = 1; col <= 5; col++) {
        const value = programme.getCell(row, col).value;
        assert.notEqual(value, "Role");
        assert.notEqual(value, "Admin");
        assert.notEqual(value, "Surveyor");
      }
    }

    const projects = wb.getWorksheet("Current projects");
    assert.ok(projects);
    assert.equal(projects.views[0]?.zoomScale, 80);
    assert.equal(projects.views[0]?.zoomScaleNormal, 80);
    assert.equal(projects.getCell("A1").value, "Project");
    assert.equal(patternFill(projects.getCell("A1")), "FFFAFBFC");
    assert.equal(projects.getCell("A1").font?.color?.argb, "FF0B1F33");
    assert.equal(projects.getCell("A2").value, "Onward");
    assert.equal(patternFill(projects.getCell("A2")), "FFD9EAD3");
    assert.equal(projects.getCell("A2").font?.color?.argb, "FF1E3D1A");
    assert.equal(projects.getCell("B2").value, "12");
    assert.equal(projects.getCell("D2").value, "Greg Kowalski");
    assert.equal(projects.getCell("D2").font?.color?.argb, "FF1A4B7C");
    assert.equal(projects.getCell("D2").font?.bold, true);
    assert.equal(projects.getCell("E1").value, "Nr of Weeks");
    assert.equal(projects.getCell("F1").value, "Approx surveys");
    assert.equal(projects.getCell("E2").value, 1);
    assert.equal(projects.getCell("F2").value, 40);
    assert.equal(projects.getCell("E3").value, 1);
    assert.equal(projects.getCell("F3").value, 40);
    assert.equal(projects.getCell("E4").value, 0);
    assert.equal(projects.getCell("F4").value, 0);
    assert.equal(projects.getCell("F2").font?.name, "Aptos");
    assert.equal(projects.getCell("F2").font?.size, 10);
    assert.equal(projects.getCell("C2").value, "Condition Only");

    for (const sheet of wb.worksheets) {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          assert.equal(cell.font?.name, "Aptos", `${sheet.name} ${cell.address}`);
          assert.equal(cell.font?.size, 10, `${sheet.name} ${cell.address}`);
        });
      });
    }

    const zip = await JSZip.loadAsync(built.buffer);
    const styles = await zip.file("xl/styles.xml")?.async("string");
    assert.ok(styles);
    const firstFont = styles.match(/<font>[\s\S]*?<\/font>/)?.[0] || "";
    assert.match(firstFont, /<name val="Aptos"\/>/);
    assert.match(firstFont, /<sz val="10"\/>/);
    assert.doesNotMatch(firstFont, /scheme/);
    assert.doesNotMatch(styles, /Calibri/);
    assert.doesNotMatch(styles, /Arial/);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    assert.match(sheetXml || "", /zoomScale="80"/);
    const projectsXml = await zip.file("xl/worksheets/sheet2.xml")?.async("string");
    assert.match(projectsXml || "", /zoomScale="80"/);
  });

  it("rejects a payload that is not an export object", () => {
    assert.equal(parseProgrammeExport(null), null);
    assert.equal(parseProgrammeExport([]), null);
    assert.equal(parseProgrammeExport("board"), null);
  });
});

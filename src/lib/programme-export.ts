import ExcelJS from "exceljs";
import JSZip from "jszip";
import { approxSurveysOnGrid, jobTileColor, projectWeeksOnGrid } from "./programme.js";

const MAX_WEEKS = 200;
const MAX_PEOPLE = 800;
const MAX_PROJECTS = 400;
const MAX_NAME = 120;
const MAX_CELL = 80;
const MAX_NOTE = 500;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const FONT_NAME = "Aptos";
const FONT_SIZE = 10;
const ZOOM = 80;

/** ARGB colours taken from public/css/programme.css and public/css/app.css. */
const NAVY = "FF0B1F33";
const WHITE = "FFFFFFFF";
const TEXT = "FF1C2430";
const MUTED = "FF5C6B7A";
const BLUE = "FF1A4B7C";
const BORDER = "FFD5DDE5";
const ACTIVE_BG = "FFF0F3F6";
const SURVEYOR_BG = "FFF7F9FB";
const ADMIN_SIDE_BG = "FFE8EEF5";
const ADMIN_NAME_BG = "FFEEF3F8";
const PROJ_HEADER_BG = "FFFAFBFC";

const GRID: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDER } },
  left: { style: "thin", color: { argb: BORDER } },
  bottom: { style: "thin", color: { argb: BORDER } },
  right: { style: "thin", color: { argb: BORDER } },
};

type Look = {
  bg: string;
  fg: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
};

const HEADER: Look = { bg: NAVY, fg: WHITE, bold: true, align: "center" };
const PROJ_HEADER: Look = { bg: PROJ_HEADER_BG, fg: NAVY, bold: true, align: "left" };
const PLAIN: Look = { bg: WHITE, fg: TEXT, align: "left" };
const PLAIN_BOLD: Look = { bg: WHITE, fg: TEXT, bold: true, align: "left" };
const LEAD: Look = { bg: WHITE, fg: BLUE, bold: true, align: "left" };

export type ProgrammeExportPerson = {
  name: string;
  flag: string;
  role: "surveyor" | "admin";
  active: boolean;
  weeks: string[];
};

export type ProgrammeExportPoolPerson = {
  name: string;
  flag: string;
};

export type ProgrammeExportProject = {
  project: string;
  numbers: string;
  surveyTypes: string;
  lead: string;
};

export type ProgrammeExportInput = {
  weeks: string[];
  people: ProgrammeExportPerson[];
  agency: ProgrammeExportPoolPerson[];
  team: ProgrammeExportPoolPerson[];
  projects: ProgrammeExportProject[];
  upcoming: ProgrammeExportProject[];
};

export type ProgrammeWorkbook = {
  filename: string;
  title: string;
  buffer: Buffer;
};

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function asActive(value: unknown): boolean {
  return !(value === false || value === "false" || value === 0 || value === "0");
}

function asRole(value: unknown): "surveyor" | "admin" {
  return String(value ?? "").trim().toLowerCase() === "admin" ? "admin" : "surveyor";
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function programmeExportStamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const dd = pick("day").padStart(2, "0");
  const mm = pick("month").padStart(2, "0");
  const yyyy = pick("year");
  return `BHC Programme ${dd}-${mm}-${yyyy}`;
}

export function programmeExportFilename(now = new Date()): string {
  return `${programmeExportStamp(now)}.xlsx`;
}

export function programmeContentDisposition(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function weekColumnLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "").trim());
  if (!match) return clean(iso, 40);
  const day = Number(match[3]);
  const month = MONTHS[Number(match[2]) - 1] || match[2];
  const year = match[1].slice(2);
  return `${String(day).padStart(2, "0")} ${month} ${year}`;
}

function personFrom(value: unknown, weekCount: number): ProgrammeExportPerson | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const name = clean(row.name, MAX_NAME);
  if (!name) return null;
  const weeks = asList(row.weeks)
    .slice(0, weekCount)
    .map((cell) => clean(cell, MAX_CELL));
  while (weeks.length < weekCount) weeks.push("");
  const flag = clean(row.flag, 8).toUpperCase();
  return {
    name,
    flag: flag === "F" || flag === "E" ? flag : "",
    role: asRole(row.role),
    active: asActive(row.active),
    weeks,
  };
}

function poolFrom(value: unknown): ProgrammeExportPoolPerson | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const name = clean(row.name, MAX_NAME);
  if (!name) return null;
  const flag = clean(row.flag, 8).toUpperCase();
  return { name, flag: flag === "F" || flag === "E" ? flag : "" };
}

function projectFrom(value: unknown): ProgrammeExportProject | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const project = clean(row.project, MAX_NAME);
  if (!project) return null;
  return {
    project,
    numbers: clean(row.numbers, 40),
    surveyTypes: clean(row.surveyTypes, MAX_NOTE),
    lead: clean(row.lead, MAX_NAME),
  };
}

export function parseProgrammeExport(body: unknown): ProgrammeExportInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  const weeks = asList(row.weeks).slice(0, MAX_WEEKS).map((week) => clean(week, 40));
  if (asList(row.weeks).length > MAX_WEEKS) return null;
  const rawPeople = asList(row.people);
  const rawProjects = asList(row.projects);
  const rawUpcoming = asList(row.upcoming);
  if (rawPeople.length > MAX_PEOPLE || rawProjects.length > MAX_PROJECTS || rawUpcoming.length > MAX_PROJECTS) {
    return null;
  }
  if (asList(row.agency).length > MAX_PEOPLE || asList(row.team).length > MAX_PEOPLE) return null;
  const people = rawPeople
    .map((person) => personFrom(person, weeks.length))
    .filter((person): person is ProgrammeExportPerson => Boolean(person));
  const seen = new Set<string>();
  const unique: ProgrammeExportPerson[] = [];
  for (const person of people) {
    const key = `${person.role}:${person.name.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(person);
  }
  return {
    weeks,
    people: unique,
    agency: asList(row.agency)
      .map(poolFrom)
      .filter((person): person is ProgrammeExportPoolPerson => Boolean(person)),
    team: asList(row.team)
      .map(poolFrom)
      .filter((person): person is ProgrammeExportPoolPerson => Boolean(person)),
    projects: rawProjects
      .map(projectFrom)
      .filter((project): project is ProgrammeExportProject => Boolean(project)),
    upcoming: rawUpcoming
      .map(projectFrom)
      .filter((project): project is ProgrammeExportProject => Boolean(project)),
  };
}

function argbFromHex(hex: string): string {
  return "FF" + hex.slice(1).toUpperCase();
}

function weekLook(value: string, catalogue: readonly string[]): Look {
  if (!value) return { bg: WHITE, fg: TEXT, align: "center" };
  const tone = jobTileColor(value, catalogue);
  return { bg: argbFromHex(tone.background), fg: argbFromHex(tone.color), bold: true, align: "center" };
}

function projectLook(name: string): Look {
  const tone = jobTileColor(name);
  return { bg: argbFromHex(tone.background), fg: argbFromHex(tone.color), bold: true, align: "left" };
}

function styleCell(cell: ExcelJS.Cell, look: Look, border: boolean): void {
  cell.font = {
    name: FONT_NAME,
    size: FONT_SIZE,
    bold: !!look.bold,
    italic: !!look.italic,
    color: { argb: look.fg },
  };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: look.bg },
  };
  cell.alignment = { vertical: "middle", horizontal: look.align ?? "left", wrapText: false };
  if (border) cell.border = GRID;
}

function writeRow(sheet: ExcelJS.Worksheet, values: (string | number)[], looks: Look[], border = true): void {
  const row = sheet.addRow(values);
  values.forEach((_, index) => styleCell(row.getCell(index + 1), looks[index], border));
}

function setWidths(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function addSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  return wb.addWorksheet(name, {
    views: [{ state: "normal", zoomScale: ZOOM, zoomScaleNormal: ZOOM }],
  });
}

/**
 * ExcelJS always records Calibri 11 as font 0 (the Normal style). Point that
 * slot at Aptos 10 and drop the theme scheme so Excel does not substitute Calibri.
 */
async function aptosNormalFont(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file("xl/styles.xml");
  if (!entry) return buffer;
  const xml = await entry.async("string");
  const patched = xml.replace(/<font>[\s\S]*?<\/font>/, (font) => {
    if (!font.includes("Calibri")) return font;
    return font
      .replace(/<sz val="11"\/>/, '<sz val="10"/>')
      .replace(/<name val="Calibri"\/>/, '<name val="Aptos"/>')
      .replace(/<scheme val="minor"\/>/, "");
  });
  zip.file("xl/styles.xml", patched);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function writeProjectSheet(
  wb: ExcelJS.Workbook,
  name: string,
  projects: readonly ProgrammeExportProject[],
  onBoard: readonly ProgrammeExportPerson[],
  catalogue: readonly string[]
): void {
  const sheet = addSheet(wb, name);
  const header = ["Project", "Stock", "Survey types", "Project manager", "Nr of Weeks", "Approx surveys"];
  writeRow(
    sheet,
    header,
    header.map(() => PROJ_HEADER)
  );
  for (const project of projects) {
    writeRow(
      sheet,
      [
        project.project,
        project.numbers,
        project.surveyTypes,
        project.lead,
        projectWeeksOnGrid(project.project, onBoard, catalogue),
        approxSurveysOnGrid(project.project, onBoard, catalogue),
      ],
      [projectLook(project.project), PLAIN_BOLD, PLAIN, LEAD, PLAIN_BOLD, PLAIN_BOLD]
    );
  }
  setWidths(sheet, [28, 12, 36, 22, 14, 16]);
}

export async function buildProgrammeWorkbook(input: ProgrammeExportInput, now = new Date()): Promise<ProgrammeWorkbook> {
  const title = programmeExportStamp(now);
  const filename = `${title}.xlsx`;
  const onBoard = input.people.filter((person) => person.active);
  const weekLabels = input.weeks.map(weekColumnLabel);
  const upcoming = input.upcoming ?? [];
  const catalogue = [...input.projects, ...upcoming].map((project) => project.project);
  // input.agency and input.team are still accepted by the parser; they are not written to a sheet.

  const wb = new ExcelJS.Workbook();
  wb.title = title;

  const programme = addSheet(wb, "Programme");
  writeRow(programme, [title], [{ bg: WHITE, fg: NAVY, bold: true, align: "left" }], false);
  const programmeHeader = ["Active", "Surveyor", "F/E", ...weekLabels];
  writeRow(
    programme,
    programmeHeader,
    programmeHeader.map(() => HEADER)
  );
  for (const person of onBoard) {
    const admin = person.role === "admin";
    const identity: Look[] = admin
      ? [
          { bg: ADMIN_SIDE_BG, fg: NAVY, align: "center" },
          { bg: ADMIN_NAME_BG, fg: MUTED, italic: true, align: "left" },
          { bg: ADMIN_SIDE_BG, fg: MUTED, bold: true, align: "center" },
        ]
      : [
          { bg: ACTIVE_BG, fg: NAVY, align: "center" },
          { bg: SURVEYOR_BG, fg: NAVY, bold: true, align: "left" },
          { bg: ACTIVE_BG, fg: MUTED, bold: true, align: "center" },
        ];
    writeRow(
      programme,
      ["Yes", person.name, person.flag, ...person.weeks],
      [...identity, ...person.weeks.map((week) => weekLook(week, catalogue))]
    );
  }
  setWidths(programme, [10, 24, 8, ...input.weeks.map(() => 14)]);

  writeProjectSheet(wb, "Current projects", input.projects, onBoard, catalogue);
  writeProjectSheet(wb, "Upcoming projects", upcoming, onBoard, catalogue);

  const raw = await wb.xlsx.writeBuffer();
  const buffer = await aptosNormalFont(Buffer.from(raw));
  return { filename, title, buffer };
}

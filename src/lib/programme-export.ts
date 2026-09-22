import * as XLSX from "xlsx";
import { projectWeeksOnGrid, teamPoolExcludingAdmins } from "./programme.js";

const MAX_WEEKS = 200;
const MAX_PEOPLE = 800;
const MAX_PROJECTS = 400;
const MAX_NAME = 120;
const MAX_CELL = 80;
const MAX_NOTE = 500;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  if (rawPeople.length > MAX_PEOPLE || rawProjects.length > MAX_PROJECTS) return null;
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
  };
}

export function buildProgrammeWorkbook(input: ProgrammeExportInput, now = new Date()): ProgrammeWorkbook {
  const title = programmeExportStamp(now);
  const filename = `${title}.xlsx`;
  const adminNames = input.people.filter((person) => person.role === "admin").map((person) => person.name);
  const team = teamPoolExcludingAdmins(input.team, adminNames);
  const onBoard = input.people.filter((person) => person.active);

  const programmeRows: (string | number)[][] = [
    [title],
    ["Active", "Role", "Surveyor", "F/E", ...input.weeks.map(weekColumnLabel)],
  ];
  for (const person of onBoard) {
    programmeRows.push([
      "Yes",
      person.role === "admin" ? "Admin" : "Surveyor",
      person.name,
      person.flag,
      ...person.weeks,
    ]);
  }

  const poolRows: (string | number)[][] = [["Pool", "Name", "F/E"]];
  for (const person of input.agency) poolRows.push(["Agency — not on a project", person.name, person.flag]);
  for (const person of team) poolRows.push(["Team — not currently live", person.name, person.flag]);

  const projectRows: (string | number)[][] = [
    ["Project", "Stock", "Survey types", "Project manager", "Nr of Weeks"],
  ];
  for (const project of input.projects) {
    projectRows.push([
      project.project,
      project.numbers,
      project.surveyTypes,
      project.lead,
      projectWeeksOnGrid(project.project, onBoard),
    ]);
  }

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: title };
  const programme = XLSX.utils.aoa_to_sheet(programmeRows);
  programme["!cols"] = [{ wch: 10 }, { wch: 12 }, { wch: 24 }, { wch: 8 }, ...input.weeks.map(() => ({ wch: 14 }))];
  const pools = XLSX.utils.aoa_to_sheet(poolRows);
  pools["!cols"] = [{ wch: 28 }, { wch: 24 }, { wch: 8 }];
  const projects = XLSX.utils.aoa_to_sheet(projectRows);
  projects["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 36 }, { wch: 22 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, programme, "Programme");
  XLSX.utils.book_append_sheet(wb, pools, "Pools");
  XLSX.utils.book_append_sheet(wb, projects, "Current projects");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { filename, title, buffer };
}

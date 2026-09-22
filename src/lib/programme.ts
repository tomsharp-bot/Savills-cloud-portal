import type { Project } from "@prisma/client";
import { recentArchived } from "./archive.js";
import { includedTypeLabels } from "./access.js";
import { programmeSeed } from "./programme-seed.js";

export const PROGRAMME_BOARD_ID = "main";

export type ProgrammePerson = {
  name: string;
  flag: string;
  weeks: string[];
};

export type ProgrammePoolPerson = {
  flag: string;
  name: string;
};

export type SavedProgrammeBoard = {
  version: 1;
  ticks: Record<string, boolean>;
  applied: Record<string, boolean>;
  surveyorOrder: string[];
  adminOrder: string[];
  cells: Record<string, string[]>;
  flags: Record<string, string>;
};

export type PersonnelRef = {
  name: string;
  agency?: string | null;
  frozen?: boolean;
};

export type ResolvedProgramme = {
  weeks: string[];
  rows: ProgrammePerson[];
  admins: ProgrammePerson[];
  pools: {
    agency_not_on_project: ProgrammePoolPerson[];
    team_not_live: ProgrammePoolPerson[];
  };
  ticks: Record<string, boolean>;
  applied: Record<string, boolean>;
  usingPersonnelAdmins: boolean;
};

export type ProgrammeProjectSource = Pick<
  Project,
  | "id"
  | "name"
  | "projectManager"
  | "stage"
  | "createdAt"
  | "updatedAt"
  | "typeConditionOnly"
  | "typeConditionEpc"
  | "typeBlocks"
  | "typeGarages"
  | "typeCommercial"
  | "typeOther"
  | "typeValidations"
>;

export type ProgrammeTableRow = {
  id: string;
  project: string;
  numbers: string;
  surveyTypes: string;
  lead: string;
};

export type ProgrammeTables = {
  current: ProgrammeTableRow[];
  upcoming: ProgrammeTableRow[];
  completed: ProgrammeTableRow[];
};

const WEEK_COUNT = programmeSeed.weeks.length;
const MAX_PEOPLE = 400;
const MAX_NAME = 120;
const MAX_CELL = 80;
const MAX_SURVEY_TYPES = 500;

export function canonName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function collapseName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function isHolidayLabel(value: string): boolean {
  return /holiday|festive|leave|annual leave|bank holiday/i.test(value);
}

export function seededSurveyTypes(
  project: Pick<
    Project,
    | "typeConditionOnly"
    | "typeConditionEpc"
    | "typeBlocks"
    | "typeGarages"
    | "typeCommercial"
    | "typeOther"
    | "typeValidations"
  >
): string {
  return includedTypeLabels(project).join(", ");
}

function padWeeks(weeks: readonly string[] | undefined): string[] {
  const out = (weeks || []).slice(0, WEEK_COUNT).map((value) => cleanCell(value));
  while (out.length < WEEK_COUNT) out.push("");
  return out;
}

function cleanCell(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CELL);
}

function normalizeFlag(flag: unknown): string {
  const value = String(flag ?? "").trim().toUpperCase();
  return value === "F" || value === "E" ? value : "";
}

function indexByCanon<T extends { name: string }>(people: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const person of people) {
    const key = canonName(person.name);
    if (key && !map.has(key)) map.set(key, person);
  }
  return map;
}

function displayName(raw: string, personnel: Map<string, PersonnelRef>): string {
  const hit = personnel.get(canonName(raw));
  return collapseName(hit ? hit.name : raw);
}

function uniqueOrder(names: readonly string[], personnel: Map<string, PersonnelRef>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = canonName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(displayName(name, personnel));
  }
  return out;
}

function hasCanon(names: readonly string[], name: string): boolean {
  const key = canonName(name);
  return names.some((item) => canonName(item) === key);
}

function lookupWeeks(name: string, cells: Record<string, string[]>, seedWeeks: Map<string, string[]>): string[] {
  if (Object.prototype.hasOwnProperty.call(cells, name)) return padWeeks(cells[name]);
  const key = canonName(name);
  for (const [cellName, weeks] of Object.entries(cells)) {
    if (canonName(cellName) === key) return padWeeks(weeks);
  }
  return padWeeks(seedWeeks.get(key));
}

function lookupFlag(
  name: string,
  flags: Record<string, string>,
  seedFlags: Map<string, string>,
  personnel: Map<string, PersonnelRef>
): string {
  if (Object.prototype.hasOwnProperty.call(flags, name)) return normalizeFlag(flags[name]);
  const key = canonName(name);
  for (const [flagName, flag] of Object.entries(flags)) {
    if (canonName(flagName) === key) return normalizeFlag(flag);
  }
  const seeded = seedFlags.get(key);
  if (seeded) return normalizeFlag(seeded);
  const agency = String(personnel.get(key)?.agency || "").trim().toUpperCase();
  return agency === "F" || agency === "E" ? agency : "";
}

function remapBools(source: Record<string, boolean> | undefined, names: readonly string[]): Record<string, boolean> {
  const byCanon = new Map<string, boolean>();
  for (const [name, value] of Object.entries(source || {})) {
    if (typeof value === "boolean") byCanon.set(canonName(name), value);
  }
  const out: Record<string, boolean> = {};
  for (const name of names) {
    const key = canonName(name);
    if (byCanon.has(key)) out[name] = Boolean(byCanon.get(key));
  }
  return out;
}

function activePersonnel(people: readonly PersonnelRef[]): PersonnelRef[] {
  return people.filter((person) => !person.frozen && canonName(person.name));
}

function seedMaps(): { weeks: Map<string, string[]>; flags: Map<string, string> } {
  const weeks = new Map<string, string[]>();
  const flags = new Map<string, string>();
  for (const person of [...programmeSeed.rows, ...programmeSeed.admins]) {
    const key = canonName(person.name);
    if (!key || weeks.has(key)) continue;
    weeks.set(key, person.weeks.slice());
    flags.set(key, person.flag || "");
  }
  return { weeks, flags };
}

export function parseSavedBoard(data: unknown): SavedProgrammeBoard | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Partial<SavedProgrammeBoard>;
  if (row.version !== 1) return null;
  if (!Array.isArray(row.surveyorOrder) || !Array.isArray(row.adminOrder)) return null;
  if (!row.cells || typeof row.cells !== "object" || Array.isArray(row.cells)) return null;
  if (!row.flags || typeof row.flags !== "object" || Array.isArray(row.flags)) return null;
  return {
    version: 1,
    ticks: boolMap(row.ticks),
    applied: boolMap(row.applied),
    surveyorOrder: row.surveyorOrder.map((name) => collapseName(String(name))).filter(Boolean),
    adminOrder: row.adminOrder.map((name) => collapseName(String(name))).filter(Boolean),
    cells: cellMap(row.cells),
    flags: flagMap(row.flags),
  };
}

function boolMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [name, flag] of Object.entries(value)) {
    const key = collapseName(name);
    if (key && typeof flag === "boolean") out[key] = flag;
  }
  return out;
}

function cellMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [name, weeks] of Object.entries(value as Record<string, unknown>)) {
    const key = collapseName(name);
    if (!key || !Array.isArray(weeks)) continue;
    out[key] = padWeeks(weeks.map((week) => String(week ?? "")));
  }
  return out;
}

function flagMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [name, flag] of Object.entries(value)) {
    const key = collapseName(name);
    if (key) out[key] = normalizeFlag(flag);
  }
  return out;
}

export function resolveProgramme(input: {
  saved?: SavedProgrammeBoard | null;
  surveyors?: readonly PersonnelRef[];
  admins?: readonly PersonnelRef[];
}): ResolvedProgramme {
  const saved = input.saved ?? null;
  const surveyors = activePersonnel(input.surveyors || []);
  const admins = activePersonnel(input.admins || []).sort((a, b) =>
    collapseName(a.name).localeCompare(collapseName(b.name), "en-GB")
  );
  const surveyorPersonnel = indexByCanon(surveyors);
  const adminPersonnel = indexByCanon(admins);
  const { weeks: seedWeeks, flags: seedFlags } = seedMaps();

  let surveyorOrder = uniqueOrder(
    saved ? saved.surveyorOrder : programmeSeed.rows.map((row) => row.name),
    surveyorPersonnel
  );
  const extraSurveyors = [...surveyors].sort((a, b) =>
    collapseName(a.name).localeCompare(collapseName(b.name), "en-GB")
  );
  for (const person of extraSurveyors) {
    if (!hasCanon(surveyorOrder, person.name)) surveyorOrder.push(collapseName(person.name));
  }

  let adminOrder: string[];
  const usingPersonnelAdmins = admins.length > 0;
  if (usingPersonnelAdmins) {
    const live = new Set(admins.map((person) => canonName(person.name)));
    const kept = (saved ? saved.adminOrder : []).filter((name) => live.has(canonName(name)));
    adminOrder = uniqueOrder(kept, adminPersonnel);
    for (const person of admins) {
      if (!hasCanon(adminOrder, person.name)) adminOrder.push(collapseName(person.name));
    }
  } else if (saved && saved.adminOrder.length) {
    adminOrder = uniqueOrder(saved.adminOrder, new Map());
  } else {
    adminOrder = uniqueOrder(
      programmeSeed.admins.map((row) => row.name),
      new Map()
    );
  }

  if (surveyorOrder.length > MAX_PEOPLE) surveyorOrder = surveyorOrder.slice(0, MAX_PEOPLE);
  if (adminOrder.length > MAX_PEOPLE) adminOrder = adminOrder.slice(0, MAX_PEOPLE);

  const cells = saved?.cells ?? {};
  const flags = saved?.flags ?? {};
  const rows = surveyorOrder.map((name) => ({
    name,
    flag: lookupFlag(name, flags, seedFlags, surveyorPersonnel),
    weeks: lookupWeeks(name, cells, seedWeeks),
  }));
  const adminRows = adminOrder.map((name) => ({
    name,
    flag: lookupFlag(name, flags, seedFlags, adminPersonnel),
    weeks: lookupWeeks(name, cells, seedWeeks),
  }));
  const everyone = [...rows.map((row) => row.name), ...adminRows.map((row) => row.name)];

  return {
    weeks: programmeSeed.weeks.slice(),
    rows,
    admins: adminRows,
    pools: {
      agency_not_on_project: programmeSeed.pools.agency_not_on_project.map((person) => ({
        flag: normalizeFlag(person.flag),
        name: collapseName(person.name),
      })),
      team_not_live: programmeSeed.pools.team_not_live.map((person) => ({
        flag: normalizeFlag(person.flag),
        name: collapseName(person.name),
      })),
    },
    ticks: remapBools(saved?.ticks, everyone),
    applied: remapBools(saved?.applied, everyone),
    usingPersonnelAdmins,
  };
}

type ClientPerson = { name?: unknown; flag?: unknown; weeks?: unknown };

export function boardFromClient(body: unknown): SavedProgrammeBoard | null {
  if (!body || typeof body !== "object") return null;
  const row = body as {
    ticks?: unknown;
    applied?: unknown;
    surveyors?: unknown;
    admins?: unknown;
  };
  if (!Array.isArray(row.surveyors) || !Array.isArray(row.admins)) return null;
  if (!row.surveyors.length || row.surveyors.length > MAX_PEOPLE || row.admins.length > MAX_PEOPLE) return null;

  const surveyors = dedupePeople(row.surveyors);
  const admins = dedupePeople(row.admins);
  if (!surveyors.length) return null;

  const cells: Record<string, string[]> = {};
  const flags: Record<string, string> = {};
  for (const person of [...surveyors, ...admins]) {
    cells[person.name] = person.weeks;
    flags[person.name] = person.flag;
  }
  const names = [...surveyors.map((person) => person.name), ...admins.map((person) => person.name)];
  return {
    version: 1,
    ticks: remapBools(boolMap(row.ticks), names),
    applied: remapBools(boolMap(row.applied), names),
    surveyorOrder: surveyors.map((person) => person.name),
    adminOrder: admins.map((person) => person.name),
    cells,
    flags,
  };
}

function dedupePeople(people: unknown[]): { name: string; flag: string; weeks: string[] }[] {
  const seen = new Set<string>();
  const out: { name: string; flag: string; weeks: string[] }[] = [];
  for (const item of people) {
    if (!item || typeof item !== "object") continue;
    const person = item as ClientPerson;
    const name = collapseName(String(person.name ?? "")).slice(0, MAX_NAME);
    const key = canonName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const weeks = Array.isArray(person.weeks) ? person.weeks.map((week) => cleanCell(week)) : [];
    out.push({ name, flag: normalizeFlag(person.flag), weeks: padWeeks(weeks) });
  }
  return out;
}

export function surveyTypesForSave(seeded: string, text: unknown): { text: string; clear: boolean } | null {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SURVEY_TYPES);
  return { text: cleaned, clear: cleaned === seeded.trim() };
}

function tableRow(
  project: ProgrammeProjectSource,
  stockCounts: ReadonlyMap<string, number>,
  notes: ReadonlyMap<string, string>
): ProgrammeTableRow {
  const seeded = seededSurveyTypes(project);
  return {
    id: project.id,
    project: project.name,
    numbers: String(stockCounts.get(project.id) ?? 0),
    surveyTypes: notes.has(project.id) ? String(notes.get(project.id) ?? "") : seeded,
    lead: project.projectManager || "",
  };
}

export function buildProgrammeTables(
  projects: readonly ProgrammeProjectSource[],
  stockCounts: ReadonlyMap<string, number>,
  notes: ReadonlyMap<string, string>
): ProgrammeTables {
  const byCreated = (a: ProgrammeProjectSource, b: ProgrammeProjectSource) =>
    a.createdAt.getTime() - b.createdAt.getTime();
  const current = projects.filter((project) => project.stage === "current").sort(byCreated);
  const upcoming = projects.filter((project) => project.stage === "upcoming").sort(byCreated);
  const completed = recentArchived(projects.filter((project) => project.stage === "archive"));
  return {
    current: current.map((project) => tableRow(project, stockCounts, notes)),
    upcoming: upcoming.map((project) => tableRow(project, stockCounts, notes)),
    completed: completed.map((project) => tableRow(project, stockCounts, notes)),
  };
}

export function programmeNotes(usingPersonnelAdmins: boolean): {
  surveyorOrder: string;
  adminNote: string;
  projectsCaption: string;
  dndNote: string;
} {
  return {
    surveyorOrder:
      "Surveyor order follows the programme draft, then any Personnel surveyors who are not already listed.",
    adminNote: usingPersonnelAdmins
      ? "Admin rows come from Personnel → Admins."
      : "Admin placeholder rows until Personnel has admins.",
    projectsCaption:
      "Current, Upcoming, and the last 5 Completed projects come from Project Progress. Project manager is the name stored on the project. Survey types start from that project's survey-type ticks and stay editable here.",
    dndNote:
      "Drag a project cell onto another surveyor/week to place it (1 week). Hold Shift while dropping to paint a run of weeks. Alt+drag paints across cells. Holiday and Festive stay red text.",
  };
}

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

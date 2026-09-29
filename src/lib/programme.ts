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
  /**
   * Monday of cells[name][0], as YYYY-MM-DD.
   * Older saves omit this and line up with the first week of the programme draft.
   */
  weekOrigin?: string;
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
/** Stored weeks can run back behind the visible grid. The cap stops a bad save from growing without bound. */
const MAX_STORED_WEEKS = 1200;
/** Column one becomes this Monday at 04:00 Europe/London. Earlier that morning, last week stays put. */
const LONDON_WEEK_ROLLOVER_MINUTES = 4 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function parseIsoDay(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function formatIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addIsoDays(iso: string, days: number): string {
  const date = parseIsoDay(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDay(date);
}

function daysBetweenIso(from: string, to: string): number | null {
  const start = parseIsoDay(from);
  const end = parseIsoDay(to);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

function isMondayIso(iso: string): boolean {
  const date = parseIsoDay(iso);
  return date != null && date.getUTCDay() === 1;
}

function weekIndexFrom(origin: string, week: string): number | null {
  const days = daysBetweenIso(origin, week);
  if (days == null || days % 7 !== 0) return null;
  return days / 7;
}

function seedWeekOrigin(): string {
  return programmeSeed.weeks[0];
}

function canonicalWeekOrigin(value: unknown): string {
  const iso = String(value ?? "").trim();
  return isMondayIso(iso) ? iso : seedWeekOrigin();
}

function londonClock(now: Date): { iso: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const bag = new Map(parts.map((part) => [part.type, part.value]));
  const year = bag.get("year") || "1970";
  const month = (bag.get("month") || "01").padStart(2, "0");
  const day = (bag.get("day") || "01").padStart(2, "0");
  let hour = Number(bag.get("hour"));
  const minute = Number(bag.get("minute"));
  if (hour === 24) hour = 0;
  return { iso: `${year}-${month}-${day}`, minutes: hour * 60 + minute };
}

/**
 * Monday that opens the programme grid at `now`.
 * The first column moves on by itself at Monday 04:00 Europe/London.
 * Before 04:00 on Monday, the previous week is still column one.
 */
export function programmeWeekCommencing(now: Date): string {
  const clock = londonClock(now);
  const date = parseIsoDay(clock.iso);
  const daysSinceMonday = date ? (date.getUTCDay() + 6) % 7 : 0;
  let monday = addIsoDays(clock.iso, -daysSinceMonday);
  if (daysSinceMonday === 0 && clock.minutes < LONDON_WEEK_ROLLOVER_MINUTES) {
    monday = addIsoDays(monday, -7);
  }
  return monday;
}

/** Week headings on the grid. The column count matches the programme draft. */
export function programmeVisibleWeeks(now: Date = new Date()): string[] {
  const start = programmeWeekCommencing(now);
  const weeks: string[] = [];
  for (let i = 0; i < WEEK_COUNT; i++) weeks.push(addIsoDays(start, i * 7));
  return weeks;
}

function projectOntoWeeks(stored: readonly string[], origin: string, visible: readonly string[]): string[] {
  return visible.map((week) => {
    const index = weekIndexFrom(origin, week);
    if (index == null || index < 0 || index >= stored.length) return "";
    return stored[index] || "";
  });
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

function lookupStoredCells(name: string, cells: Record<string, string[]>): string[] | undefined {
  if (Object.prototype.hasOwnProperty.call(cells, name)) return cells[name];
  const key = canonName(name);
  for (const [cellName, weeks] of Object.entries(cells)) {
    if (canonName(cellName) === key) return weeks;
  }
  return undefined;
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
    weekOrigin: canonicalWeekOrigin(row.weekOrigin),
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
    out[key] = weeks.slice(0, MAX_STORED_WEEKS).map((week) => cleanCell(week));
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
  /** When the grid is being read. Column one is the London week in force at this instant. */
  now?: Date;
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
  const visibleWeeks = programmeVisibleWeeks(input.now ?? new Date());
  const savedOrigin = canonicalWeekOrigin(saved?.weekOrigin);
  const weeksFor = (name: string): string[] => {
    const stored = lookupStoredCells(name, cells);
    if (stored) return projectOntoWeeks(stored, savedOrigin, visibleWeeks);
    return projectOntoWeeks(seedWeeks.get(canonName(name)) || [], seedWeekOrigin(), visibleWeeks);
  };
  const rows = surveyorOrder.map((name) => ({
    name,
    flag: lookupFlag(name, flags, seedFlags, surveyorPersonnel),
    weeks: weeksFor(name),
  }));
  const adminRows = adminOrder.map((name) => ({
    name,
    flag: lookupFlag(name, flags, seedFlags, adminPersonnel),
    weeks: weeksFor(name),
  }));
  const everyone = [...rows.map((row) => row.name), ...adminRows.map((row) => row.name)];
  const adminNamesForPool = [
    ...(input.admins || []).map((person) => person.name),
    ...adminRows.map((person) => person.name),
  ];

  return {
    weeks: visibleWeeks,
    rows,
    admins: adminRows,
    pools: {
      agency_not_on_project: programmeSeed.pools.agency_not_on_project.map((person) => ({
        flag: normalizeFlag(person.flag),
        name: collapseName(person.name),
      })),
      team_not_live: teamPoolExcludingAdmins(
        programmeSeed.pools.team_not_live.map((person) => ({
          flag: normalizeFlag(person.flag),
          name: collapseName(person.name),
        })),
        adminNamesForPool
      ),
    },
    ticks: remapBools(saved?.ticks, everyone),
    applied: remapBools(saved?.applied, everyone),
    usingPersonnelAdmins,
  };
}

type ClientPerson = { name?: unknown; flag?: unknown; weeks?: unknown };

export function boardFromClient(
  body: unknown,
  options?: { previous?: SavedProgrammeBoard | null }
): SavedProgrammeBoard | null {
  if (!body || typeof body !== "object") return null;
  const row = body as {
    ticks?: unknown;
    applied?: unknown;
    surveyors?: unknown;
    admins?: unknown;
    weeks?: unknown;
  };
  if (!Array.isArray(row.surveyors) || !Array.isArray(row.admins)) return null;
  if (!row.surveyors.length || row.surveyors.length > MAX_PEOPLE || row.admins.length > MAX_PEOPLE) return null;

  const surveyors = dedupePeople(row.surveyors);
  const admins = dedupePeople(row.admins);
  if (!surveyors.length) return null;

  const people = [...surveyors, ...admins];
  const flags: Record<string, string> = {};
  for (const person of people) flags[person.name] = person.flag;
  const stored =
    row.weeks === undefined ? legacyCells(people) : mergedCells(people, row.weeks, options?.previous ?? null);
  if (!stored) return null;

  const names = people.map((person) => person.name);
  return {
    version: 1,
    weekOrigin: stored.origin,
    ticks: remapBools(boolMap(row.ticks), names),
    applied: remapBools(boolMap(row.applied), names),
    surveyorOrder: surveyors.map((person) => person.name),
    adminOrder: admins.map((person) => person.name),
    cells: stored.values,
    flags,
  };
}

function legacyCells(people: { name: string; weeks: string[] }[]): { origin: string; values: Record<string, string[]> } {
  const values: Record<string, string[]> = {};
  for (const person of people) values[person.name] = padWeeks(person.weeks);
  return { origin: seedWeekOrigin(), values };
}

function readClientWeeks(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > WEEK_COUNT) return null;
  const weeks: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const iso = String(value[i] ?? "").trim();
    if (!isMondayIso(iso)) return null;
    if (i > 0 && iso !== addIsoDays(weeks[i - 1], 7)) return null;
    weeks.push(iso);
  }
  return weeks;
}

function valuesForWindow(values: readonly string[], count: number): string[] {
  const out = values.slice(0, count);
  while (out.length < count) out.push("");
  return out;
}

function retargetCells(cells: readonly string[], fromOrigin: string, toOrigin: string): string[] | null {
  const shift = weekIndexFrom(toOrigin, fromOrigin);
  if (shift == null || shift < 0 || shift + cells.length > MAX_STORED_WEEKS) return null;
  return Array.from({ length: shift }, () => "").concat(cells);
}

function writeWindow(
  cells: readonly string[],
  origin: string,
  weeks: readonly string[],
  values: readonly string[]
): string[] | null {
  const out = cells.slice();
  for (let i = 0; i < weeks.length; i++) {
    const index = weekIndexFrom(origin, weeks[i]);
    if (index == null || index < 0 || index >= MAX_STORED_WEEKS) return null;
    while (out.length <= index) {
      if (out.length >= MAX_STORED_WEEKS) return null;
      out.push("");
    }
    out[index] = values[i] || "";
  }
  return out;
}

function baseTimeline(
  name: string,
  previous: SavedProgrammeBoard | null,
  previousOrigin: string,
  seeded: Map<string, string[]>
): { origin: string; cells: string[] } {
  if (previous) {
    const stored = lookupStoredCells(name, previous.cells);
    if (stored) return { origin: previousOrigin, cells: stored };
  }
  const fromSeed = seeded.get(canonName(name));
  if (fromSeed) return { origin: seedWeekOrigin(), cells: fromSeed.slice() };
  return { origin: previousOrigin, cells: [] };
}

/**
 * Keep stamps on the calendar week they were placed on.
 * The client sends the weeks it is showing; weeks outside that window stay as stored.
 */
function mergedCells(
  people: { name: string; weeks: string[] }[],
  weeksValue: unknown,
  previous: SavedProgrammeBoard | null
): { origin: string; values: Record<string, string[]> } | null {
  const window = readClientWeeks(weeksValue);
  if (!window) return null;
  const previousOrigin = canonicalWeekOrigin(previous?.weekOrigin);
  const seeded = seedMaps().weeks;
  const bases = people.map((person) => baseTimeline(person.name, previous, previousOrigin, seeded));
  let origin = previousOrigin;
  for (const base of bases) {
    if (!base.cells.length) continue;
    const compared = weekIndexFrom(base.origin, origin);
    if (compared != null && compared > 0) origin = base.origin;
  }
  const windowShift = weekIndexFrom(origin, window[0]);
  if (windowShift == null) return null;
  if (windowShift < 0) origin = window[0];

  const values: Record<string, string[]> = {};
  for (let i = 0; i < people.length; i++) {
    const shifted = retargetCells(bases[i].cells, bases[i].origin, origin);
    if (!shifted) return null;
    const written = writeWindow(shifted, origin, window, valuesForWindow(people[i].weeks, window.length));
    if (!written) return null;
    values[people[i].name] = written;
  }
  return { origin, values };
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
    const weeks = Array.isArray(person.weeks)
      ? person.weeks.slice(0, MAX_STORED_WEEKS).map((week) => cleanCell(week))
      : [];
    out.push({ name, flag: normalizeFlag(person.flag), weeks });
  }
  return out;
}

/** Drop team-pool people whose name matches a Personnel admin. Names are not hard-coded. */
export function teamPoolExcludingAdmins<T extends { name: string }>(
  people: readonly T[],
  adminNames: readonly string[]
): T[] {
  const blocked = new Set(adminNames.map((name) => canonName(name)).filter(Boolean));
  if (!blocked.size) return people.slice();
  return people.filter((person) => !blocked.has(canonName(person.name)));
}

/**
 * Distinct week columns where an on-board person has this project.
 * People with active === false are off the main grid and do not count.
 * Missing active means on the board, matching the programme tick default.
 * Two people assigned in the same week count as one tile.
 * A tile matches the project by full name or by the short stamp
 * ({@link programmeCellMatchesProject}). `catalogue` is the Current and
 * Upcoming names, so two different projects that share a stamp are not merged.
 */
export function projectWeeksOnGrid(
  projectName: string,
  people: readonly { weeks?: readonly string[]; active?: boolean }[],
  catalogue?: readonly string[]
): number {
  if (!programmeCanon(projectName)) return 0;
  const names = catalogue && catalogue.length ? catalogue : [projectName];
  const hit = new Set<number>();
  for (const person of people) {
    if (person.active === false) continue;
    const weeks = person.weeks || [];
    for (let i = 0; i < weeks.length; i++) {
      if (programmeCellMatchesProject(weeks[i] || "", projectName, names)) hit.add(i);
    }
  }
  return hit.size;
}

/** One occupied week column on the main grid stands for about this many surveys. */
export const APPROX_SURVEYS_PER_WEEK = 40;

const PROGRAMME_SHORT_LABELS: Record<string, string> = {
  "Festive Period": "Festive",
  "Cornwall 2026 Ph2": "Cornwall",
  "BPHA 2026 ACQ": "BPHA ACQ",
  "LFHA 2026": "LFHA",
  "Vico 2026": "Vico",
  "OTHER WORK": "Other",
  "Awaiting Start": "Awaiting",
  "A2Dominion 2026 - Ph4": "A2D Ph4",
  "Saxon Weald Ph 4": "Saxon",
  "Radius Ph1": "Radius",
};

/** Visible programme stamp. The stored project name stays the full Project Progress name. */
export function programmeShortLabel(name: string): string {
  const value = String(name || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  const known = PROGRAMME_SHORT_LABELS[value];
  if (known) return known;
  if (value.length <= 12) return value;
  const phaseMatch = /\bPh(?:ase)?\s*(\d+)\b/i.exec(value);
  const phase = phaseMatch ? `Ph${phaseMatch[1]}` : "";
  const client = value
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\bPh(?:ase)?\s*\d+\b/gi, " ")
    .replace(/[-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^A2Dominion\b/i, "A2D");
  const head = client.split(" ").filter(Boolean)[0] || "";
  let label = phase ? `${head} ${phase}`.trim() : client;
  if (label.length > 12) {
    label = phase && head ? `${head.slice(0, Math.max(1, 11 - phase.length))} ${phase}`.trim() : `${label.slice(0, 11)}…`;
  }
  return label || `${value.slice(0, 11)}…`;
}

/**
 * Grid text compared with a Project Progress name.
 * Case, repeated spaces, en-dash/em-dash, and "Ph 4" vs "Ph4" do not matter.
 */
export function programmeCanon(name: string): string {
  return canonName(
    String(name || "")
      .replace(/[\u2013\u2014\u2212]/g, "-")
      .replace(/\bPh(?:ase)?\s+(\d+)\b/gi, "Ph$1")
  );
}

function programmeStampKey(name: string): string {
  return canonName(programmeShortLabel(String(name || "").replace(/[\u2013\u2014\u2212]/g, "-")));
}

/**
 * True when a main-grid cell is this project.
 *
 * Exact names match first. Otherwise the cell counts when it is the project's
 * short stamp, or when the cell's short stamp is the project's full name
 * (`LFHA` ↔ `LFHA 2026`, `A2D Ph4` ↔ `A2Dominion 2026 - Ph4`, `Cornwall` ↔
 * `Cornwall 2026 Ph2`). If another Current/Upcoming project already owns that
 * text exactly, or more than one project shares the stamp, the alias is not used.
 */
export function programmeCellMatchesProject(
  cell: string,
  projectName: string,
  catalogue?: readonly string[]
): boolean {
  const cellKey = programmeCanon(cell);
  const projectKey = programmeCanon(projectName);
  if (!cellKey || !projectKey) return false;
  if (cellKey === projectKey) return true;

  const names = (catalogue && catalogue.length ? catalogue : [projectName]).filter((name) => programmeCanon(name));
  if (names.some((name) => programmeCanon(name) === cellKey)) return false;

  const cellStamp = programmeStampKey(cell);
  const projectStamp = programmeStampKey(projectName);

  if (cellKey === projectStamp) {
    const claimants = names.filter((name) => programmeCanon(name) === cellKey || programmeStampKey(name) === cellKey);
    return claimants.length === 1 && programmeCanon(claimants[0]) === projectKey;
  }

  if (cellStamp && cellStamp !== cellKey && cellStamp === projectKey) {
    const claimants = names.filter((name) => programmeCanon(name) === cellStamp);
    return claimants.length === 1 && programmeCanon(claimants[0]) === projectKey;
  }

  return false;
}

/** Approx surveys = distinct on-grid week columns for the project × 40. */
export function approxSurveysOnGrid(
  projectName: string,
  people: readonly { weeks?: readonly string[]; active?: boolean }[],
  catalogue?: readonly string[]
): number {
  return projectWeeksOnGrid(projectName, people, catalogue) * APPROX_SURVEYS_PER_WEEK;
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
      "Top stamps are Current and Upcoming projects only. Drag a stamp onto a week, or drag an existing grid tile across cells to copy it. Click a tile and press Delete or Backspace to clear it. Shift+drop still paints a run of weeks.",
  };
}

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

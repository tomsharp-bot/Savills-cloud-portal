/**
 * Colin handover Category Lists roster for HHSRS Reporter.
 * Call rules, templates, extras, and reference codes live here.
 * The names shown and stored are portal Project.name values; resolveHhsrsProject
 * maps these roster settings onto that name.
 */

export type RatingScheme = "NEW" | "OLD";

export type ProjectExtras = {
  calls: boolean;
  survey_date: boolean;
  vulnerabilities: boolean;
  cause: boolean;
  onward: boolean;
  work_order: boolean;
  online_form: boolean;
};

export type ReporterProjectDemo = {
  name: string;
  template: string;
  ratingScheme: RatingScheme;
  extras: ProjectExtras;
  to: string[];
  cc: string[];
  /** Optional. Generate email fills Bcc only when a project has addresses here. */
  bcc?: string[];
  hint: string;
};

/** Demo counts and archive seed. Not shown as rule text on Project overview. */
export type ReporterRosterProject = ReporterProjectDemo & {
  demoCompleted: number;
  demoWaiting: number;
  seedArchived: boolean;
};

const NONE: ProjectExtras = {
  calls: false,
  survey_date: false,
  vulnerabilities: false,
  cause: false,
  onward: false,
  work_order: false,
  online_form: false,
};

/**
 * Names, templates, and hints from the approved offline mock
 * (Colin handover Category Lists / HHSRS Log.xlsx).
 * "D&M" is spelled out as damp and mould in user-facing hints.
 */
export const HHSRS_PROJECT_ROSTER: ReporterRosterProject[] = [
  {
    name: "Test Housing",
    template: "Standard",
    ratingScheme: "NEW",
    extras: { ...NONE },
    to: ["cfarrell@savillshousing.co.uk"],
    cc: [],
    hint: "Test Housing: dummy project for testing. Not a client.",
    demoCompleted: 0,
    demoWaiting: 0,
    seedArchived: false,
  },
  {
    name: "Gateway 2026",
    template: "Standard",
    ratingScheme: "NEW",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Gateway 2026: NEW ratings; email only.",
    demoCompleted: 6,
    demoWaiting: 0,
    seedArchived: false,
  },
  {
    name: "Onward 2026",
    template: "Onward",
    ratingScheme: "OLD",
    extras: { ...NONE, calls: true, survey_date: true, onward: true },
    to: [],
    cc: [],
    hint: "Onward: call in all Cat 1; include call reference in email; survey date + CAT1 subject.",
    demoCompleted: 18,
    demoWaiting: 2,
    seedArchived: false,
  },
  {
    name: "Vico 2026 8k",
    template: "Vico Homes",
    ratingScheme: "OLD",
    extras: { ...NONE, calls: true, vulnerabilities: true, cause: true },
    to: [],
    cc: [],
    hint: "Vico: mod DMC emailed with cause + vulnerabilities; Cat 1 Emerg ring / Significant do not.",
    demoCompleted: 11,
    demoWaiting: 2,
    seedArchived: false,
  },
  {
    name: "Bristol Council 2026 Ph2",
    template: "Bristol",
    ratingScheme: "NEW",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Bristol Council 2026 Ph2: NEW ratings; email only.",
    demoCompleted: 4,
    demoWaiting: 0,
    seedArchived: false,
  },
  {
    name: "A2D 2026 Phase 4",
    template: "A2Dominion",
    ratingScheme: "NEW",
    extras: { ...NONE, calls: true, work_order: true },
    to: [],
    cc: [],
    hint: "A2D: all severes phoned then emailed with WO; CO alarm severes email only.",
    demoCompleted: 9,
    demoWaiting: 1,
    seedArchived: false,
  },
  {
    name: "Cornwall 2026 Ph2",
    template: "Cornwall",
    ratingScheme: "OLD",
    extras: { ...NONE, online_form: true },
    to: [],
    cc: [],
    hint: "Cornwall: any damp and mould needs Tom's separate online form.",
    demoCompleted: 7,
    demoWaiting: 1,
    seedArchived: false,
  },
  {
    name: "BPHA 2026 ACQ",
    template: "BPHA",
    ratingScheme: "NEW",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "BPHA 2026 ACQ: NEW ratings; email only.",
    demoCompleted: 5,
    demoWaiting: 1,
    seedArchived: false,
  },
  {
    name: "Saxon Weald 2026 Phase 4",
    template: "Standard",
    ratingScheme: "OLD",
    extras: { ...NONE, calls: true },
    to: [],
    cc: [],
    hint: "Saxon Weald: all damp and mould phoned; email only if Severe, with call reference.",
    demoCompleted: 3,
    demoWaiting: 0,
    seedArchived: false,
  },
  {
    name: "Project Caterpillar 2026",
    template: "Standard",
    ratingScheme: "NEW",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Pending — recording system / call / email TBC.",
    demoCompleted: 0,
    demoWaiting: 0,
    seedArchived: false,
  },
  {
    name: "MTVH Pilot 2026",
    template: "Standard",
    ratingScheme: "NEW",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "MTVH Pilot: Cat 1 Emergency ring; Significant do not.",
    demoCompleted: 9,
    demoWaiting: 1,
    seedArchived: false,
  },
  {
    name: "MTVH Phase 1 2026",
    template: "Standard",
    ratingScheme: "NEW",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "MTVH Phase 1 — Pending (not live yet).",
    demoCompleted: 0,
    demoWaiting: 0,
    seedArchived: false,
  },
  {
    name: "LFHA (Leeds)",
    template: "LFHA",
    ratingScheme: "NEW",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "LFHA: email template supplied; call requirements TBC.",
    demoCompleted: 2,
    demoWaiting: 0,
    seedArchived: false,
  },
  {
    name: "Saxon Weald 2025 Phase 3",
    template: "Standard",
    ratingScheme: "OLD",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Complete — archived from Colin list.",
    demoCompleted: 42,
    demoWaiting: 0,
    seedArchived: true,
  },
  {
    name: "Bristol Council 2025",
    template: "Bristol",
    ratingScheme: "OLD",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Complete — archived from Colin list.",
    demoCompleted: 31,
    demoWaiting: 0,
    seedArchived: true,
  },
  {
    name: "Flagship 2026",
    template: "Standard",
    ratingScheme: "OLD",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Complete — archived from Colin list.",
    demoCompleted: 28,
    demoWaiting: 0,
    seedArchived: true,
  },
  {
    name: "Southern Housing 2026 Blks",
    template: "Standard",
    ratingScheme: "OLD",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Complete — archived from Colin list.",
    demoCompleted: 19,
    demoWaiting: 0,
    seedArchived: true,
  },
  {
    name: "BPHA 2026 Blocks x4",
    template: "BPHA",
    ratingScheme: "OLD",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Complete — archived from Colin list.",
    demoCompleted: 22,
    demoWaiting: 0,
    seedArchived: true,
  },
  {
    name: "Luton 2026 Appts",
    template: "Standard",
    ratingScheme: "OLD",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Complete — archived from Colin list.",
    demoCompleted: 15,
    demoWaiting: 0,
    seedArchived: true,
  },
  {
    name: "Radius 2025 Phase 1",
    template: "Standard",
    ratingScheme: "OLD",
    extras: { ...NONE },
    to: [],
    cc: [],
    hint: "Complete — archived from Colin list.",
    demoCompleted: 17,
    demoWaiting: 0,
    seedArchived: true,
  },
];

/** Roster entries that are not archived. Settings only; the office dropdown uses portal Project.name. */
export const REPORTER_DEMO_PROJECTS: ReporterProjectDemo[] = HHSRS_PROJECT_ROSTER.filter(
  (project) => !project.seedArchived
).map(({ demoCompleted: _completed, demoWaiting: _waiting, seedArchived: _archived, ...project }) => project);

export const RATING_OPTIONS: Record<RatingScheme, string[]> = {
  NEW: ["Low", "Medium", "High", "High – emergency risk", "High – severe risk"],
  OLD: ["Slight", "Moderate", "Severe", "Severe – emergency risk", "Severe"],
};

function findRoster(name: string): ReporterProjectDemo | null {
  const hit =
    HHSRS_PROJECT_ROSTER.find((project) => project.name.toLowerCase() === name.toLowerCase()) || null;
  if (!hit) return null;
  const { demoCompleted: _completed, demoWaiting: _waiting, seedArchived: _archived, ...project } = hit;
  return project;
}

/**
 * Project Progress display name → Colin / HHSRS roster name.
 * Waiting rows and email rules resolve through this map (approved offline mock).
 */
export const PP_HHSRS_ALIAS: Record<string, string> = {
  Onward: "Onward 2026",
  "Vico 2026": "Vico 2026 8k",
  "Cornwall 2026 Ph2": "Cornwall 2026 Ph2",
  "A2D Ph4": "A2D 2026 Phase 4",
  "BPHA 2026 ACQ": "BPHA 2026 ACQ",
  "LFHA 2026": "LFHA (Leeds)",
  "Southern Blocks": "Southern Housing 2026 Blks",
  Flagship: "Flagship 2026",
  "Radius Ph1": "Radius 2025 Phase 1",
  "Saxon Weald Ph 4": "Saxon Weald 2026 Phase 4",
  "Bristol Ph2": "Bristol Council 2025",
  MTVH: "MTVH Pilot 2026",
};

/** Roster key for a Project Progress name. Unknown names stay as typed. */
export function hhsrsKey(ppName: string): string {
  const raw = (ppName || "").trim();
  if (!raw) return "";
  if (PP_HHSRS_ALIAS[raw]) return PP_HHSRS_ALIAS[raw];
  const found = Object.keys(PP_HHSRS_ALIAS).find((key) => key.toLowerCase() === raw.toLowerCase());
  return found ? PP_HHSRS_ALIAS[found] : raw;
}

/**
 * Project Progress name that should own a stored HHSRS / Colin project name.
 * Returns the stored name when none of the live Progress names match.
 */
export function progressNameForCase(caseName: string, progressNames: readonly string[]): string {
  const raw = (caseName || "").trim();
  if (!raw) return "";
  const exact = progressNames.find((name) => name.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const resolved = resolveHhsrsProject(raw).name;
  const viaResolver = progressNames.find((name) => name.toLowerCase() === resolved.toLowerCase());
  if (viaResolver) return viaResolver;
  const aliased = progressNames.find((name) => hhsrsKey(name).toLowerCase() === raw.toLowerCase());
  if (aliased) return aliased;
  return raw;
}

/**
 * LFHA (Leeds) roster names. Live Project Progress uses "Leeds Fed HA 2026",
 * which does not start with LFHA and does not contain "(Leeds)".
 */
export function isLfhaRosterName(name: string): boolean {
  const lower = String(name || "").trim().toLowerCase();
  return lower.startsWith("lfha") || lower.startsWith("leeds fed") || lower.includes("(leeds)");
}

/** Match a live submission or Project Progress name to the closest roster config. */
export function matchDemoProject(projectName: string): ReporterProjectDemo | null {
  const raw = (projectName || "").trim();
  if (!raw) return null;
  const aliased = hhsrsKey(raw);
  if (aliased && aliased.toLowerCase() !== raw.toLowerCase()) {
    const viaAlias = findRoster(aliased);
    if (viaAlias) return viaAlias;
  }
  const exact = findRoster(raw);
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower.startsWith("onward")) return findRoster("Onward 2026");
  if (/^vico\b/i.test(raw)) return findRoster("Vico 2026 8k");
  if (lower.startsWith("cornwall")) return findRoster("Cornwall 2026 Ph2");
  if (lower.startsWith("bpha")) return findRoster("BPHA 2026 ACQ");
  if (lower.startsWith("mtvh") || lower.includes("mtvh") || lower.includes("metropolitan")) {
    return findRoster("MTVH Pilot 2026");
  }
  if (lower.startsWith("gateway")) return findRoster("Gateway 2026");
  if (lower.startsWith("bristol")) return findRoster("Bristol Council 2026 Ph2");
  if (lower.startsWith("a2d") || /^a2\s*dominion\b/.test(lower)) return findRoster("A2D 2026 Phase 4");
  if (lower.startsWith("saxon")) return findRoster("Saxon Weald 2026 Phase 4");
  if (isLfhaRosterName(raw)) return findRoster("LFHA (Leeds)");
  return null;
}

export const SITE_FORM_PUBLIC_URL = "https://savillscloudportal.co.uk/HHSRS-site-form";

/**
 * Roster labels that are not a portal Project.name.
 * The office list and stored keys use the portal name. These labels still
 * resolve onto that project so an older submission is not left behind.
 */
export const HHSRS_PORTAL_NAME_ALIASES: Record<string, string> = {
  lfha: "Leeds Fed HA 2026",
  "lfha 2026": "Leeds Fed HA 2026",
  "lfha (leeds)": "Leeds Fed HA 2026",
  "leeds federation": "Leeds Fed HA 2026",
  "leeds federation (leeds)": "Leeds Fed HA 2026",
  "mtvh pilot 2026": "MTVH 2026",
  "mtvh phase 1 2026": "MTVH 2026",
  "vico 2026 8k": "Vico 2026",
};

/** Live names whose casing should survive a differently cased submission. */
const PORTAL_NAME_CANONICAL = ["Leeds Fed HA 2026", "MTVH 2026", "Vico 2026", "Onward 2026", "Test Housing"];

/** Reference prefix carried by a roster entry. Letter fallback covers the rest. */
const ROSTER_REFERENCE_CODE: Record<string, string> = {
  "Test Housing": "TEST",
  "Onward 2026": "ONW",
  "Vico 2026 8k": "VICO",
  "A2D 2026 Phase 4": "A2D",
  "Cornwall 2026 Ph2": "CORN",
  "BPHA 2026 ACQ": "BPHA",
  "Saxon Weald 2026 Phase 4": "SAXW",
  "Saxon Weald 2025 Phase 3": "SAXW",
  "MTVH Pilot 2026": "MTVH",
  "MTVH Phase 1 2026": "MTVH",
  "LFHA (Leeds)": "LFHA",
};

export type ResolvedHhsrsProject = {
  /** Portal Project.name to show and store. Empty when the input is blank. */
  name: string;
  /** Call rules, template, extras, and hint. Null when the name matches no roster entry. */
  roster: ReporterProjectDemo | null;
  /** Issue reference prefix, such as MTVH or LFHA. */
  code: string;
};

function lettersCode(name: string): string {
  const letters = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  return letters || "HHSR";
}

/**
 * One resolver for every HHSRS surface.
 * The name is the portal Project.name. Roster settings (calls, template, extras,
 * reference code) are mapped onto that name and are not shown as the project.
 */
export function resolveHhsrsProject(projectName: string): ResolvedHhsrsProject {
  const raw = String(projectName || "").trim();
  if (!raw) return { name: "", roster: null, code: "HHSR" };
  const lower = raw.toLowerCase();
  const aliased = HHSRS_PORTAL_NAME_ALIASES[lower];
  const canonical = PORTAL_NAME_CANONICAL.find((name) => name.toLowerCase() === lower);
  const name = aliased || canonical || raw;
  const roster = matchDemoProject(raw) || matchDemoProject(name);
  const code = (roster && ROSTER_REFERENCE_CODE[roster.name]) || lettersCode(raw);
  return { name, roster, code };
}

/** Settings for one portal project, keyed by that project's own name. */
export function hhsrsProjectSettings(portalName: string): ReporterProjectDemo {
  const roster = resolveHhsrsProject(portalName).roster;
  return {
    name: portalName,
    template: roster?.template || "Standard",
    ratingScheme: roster?.ratingScheme || "NEW",
    extras: roster ? { ...roster.extras } : { ...NONE },
    to: roster ? [...roster.to] : [],
    cc: roster ? [...roster.cc] : [],
    bcc: roster?.bcc ? [...roster.bcc] : undefined,
    hint: roster?.hint || "",
  };
}

/**
 * Portal name to select when a case may still carry a roster label.
 * Exact portal names win. Otherwise the shared resolver, then the older alias.
 */
export function portalNameInList(stored: string, portalNames: readonly string[]): string {
  const raw = String(stored || "").trim();
  if (!raw) return "";
  const exact = portalNames.find((name) => name.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const resolved = resolveHhsrsProject(raw).name;
  const via = portalNames.find((name) => name.toLowerCase() === resolved.toLowerCase());
  if (via) return via;
  return progressNameForCase(raw, portalNames);
}

/** Stored submission names that belong to the portal project the office picked. */
export function portalProjectMatchNames(selected: string, storedNames: readonly string[]): string[] {
  const key = resolveHhsrsProject(selected).name;
  if (!key) return [];
  const names = new Set<string>([key]);
  for (const stored of storedNames) {
    const raw = String(stored || "").trim();
    if (!raw) continue;
    if (raw === key || resolveHhsrsProject(raw).name === key) names.add(raw);
  }
  return [...names];
}

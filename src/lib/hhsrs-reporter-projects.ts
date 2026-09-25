/**
 * Colin handover Category Lists roster for HHSRS Reporter.
 * Used by Review and create (rules / hints) and Project overview (names + demo counts)
 * until live project settings are wired.
 */

export type RatingScheme = "NEW" | "OLD";

export type ProjectExtras = {
  calls: boolean;
  survey_date: boolean;
  vulnerabilities: boolean;
  cause: boolean;
  escalation: boolean;
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
  escalation: false,
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
    extras: { ...NONE, calls: true, vulnerabilities: true, cause: true, escalation: true },
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

/** Active programmes for the Review and create project dropdown. */
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
  const aliased = progressNames.find((name) => hhsrsKey(name).toLowerCase() === raw.toLowerCase());
  if (aliased) return aliased;
  return raw;
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
  if (lower.startsWith("mtvh") || lower.includes("mtvh")) return findRoster("MTVH Pilot 2026");
  if (lower.startsWith("gateway")) return findRoster("Gateway 2026");
  if (lower.startsWith("bristol")) return findRoster("Bristol Council 2026 Ph2");
  if (lower.startsWith("a2d")) return findRoster("A2D 2026 Phase 4");
  if (lower.startsWith("saxon")) return findRoster("Saxon Weald 2026 Phase 4");
  if (lower.startsWith("lfha") || lower.includes("(leeds)")) return findRoster("LFHA (Leeds)");
  return null;
}

export const SITE_FORM_PUBLIC_URL = "https://savillscloudportal.co.uk/HHSRS-site-form";

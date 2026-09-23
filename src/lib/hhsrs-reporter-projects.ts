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
    to: ["hhsrs@gatewayhousing.org.uk"],
    cc: ["gwheeler@savills.com"],
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
    to: ["hhsrs@onward.co.uk"],
    cc: ["gwheeler@savills.com", "tsharp@savillshousing.co.uk"],
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
    to: ["hhsrs@vicohomes.co.uk"],
    cc: ["gwheeler@savills.com"],
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
    to: ["hhsrs@bristol.gov.uk"],
    cc: ["gwheeler@savills.com"],
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
    to: ["hhsrs@a2dominion.co.uk"],
    cc: ["gwheeler@savills.com"],
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
    to: ["hhsrs@cornwallhousing.co.uk"],
    cc: ["tsharp@savillshousing.co.uk"],
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
    to: ["hhsrs@bpha.org.uk"],
    cc: ["gwheeler@savills.com"],
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
    to: ["hhsrs@saxonweald.com"],
    cc: ["gwheeler@savills.com"],
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
    cc: ["gwheeler@savills.com"],
    hint: "Pending — recording system / call / email TBC.",
    demoCompleted: 0,
    demoWaiting: 0,
    seedArchived: false,
  },
  {
    name: "MTVH Pilot 2026",
    template: "Standard",
    ratingScheme: "NEW",
    extras: { ...NONE, calls: true },
    to: ["HHSRS@MTVH.co.uk"],
    cc: ["gwheeler@savills.com", "tsharp@savillshousing.co.uk"],
    hint: "MTVH Pilot: Cat 1 Emergency ring; Significant do not.",
    demoCompleted: 9,
    demoWaiting: 1,
    seedArchived: false,
  },
  {
    name: "MTVH Phase 1 2026",
    template: "Standard",
    ratingScheme: "NEW",
    extras: { ...NONE, calls: true },
    to: ["HHSRS@MTVH.co.uk"],
    cc: ["gwheeler@savills.com", "tsharp@savillshousing.co.uk"],
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
    to: ["hhsrs@lfha.co.uk"],
    cc: ["gwheeler@savills.com"],
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
  return REPORTER_DEMO_PROJECTS.find((project) => project.name === name) || null;
}

/** Match a live submission projectName to the closest roster config. */
export function matchDemoProject(projectName: string): ReporterProjectDemo | null {
  const raw = (projectName || "").trim();
  if (!raw) return null;
  const exact = REPORTER_DEMO_PROJECTS.find((project) => project.name.toLowerCase() === raw.toLowerCase());
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

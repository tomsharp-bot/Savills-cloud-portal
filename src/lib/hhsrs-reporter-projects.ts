/**
 * Demo / stub project rules for the Review and create UI shell.
 * Mirrors the offline mock (project_settings.py / templates.py extras).
 * Full Admin project settings remain deferred.
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

export const REPORTER_DEMO_PROJECTS: ReporterProjectDemo[] = [
  {
    name: "Onward 2026",
    template: "Onward",
    ratingScheme: "OLD",
    extras: { ...NONE, calls: true, survey_date: true, onward: true },
    to: ["hhsrs@onward.co.uk"],
    cc: ["gwheeler@savills.com", "tsharp@savillshousing.co.uk"],
    hint: "Onward: call reference + survey date + CAT1 subject fields.",
  },
  {
    name: "Vico Homes",
    template: "Vico Homes",
    ratingScheme: "OLD",
    extras: { ...NONE, vulnerabilities: true, cause: true, escalation: true },
    to: ["hhsrs@vicohomes.co.uk"],
    cc: ["gwheeler@savills.com"],
    hint: "Vico: vulnerabilities, suspected cause and escalation when reported.",
  },
  {
    name: "Cornwall 2026",
    template: "Cornwall",
    ratingScheme: "NEW",
    extras: { ...NONE, online_form: true },
    to: ["hhsrs@cornwallhousing.co.uk"],
    cc: ["tsharp@savillshousing.co.uk"],
    hint: "Cornwall: damp/mould may need Tom’s separate online form.",
  },
  {
    name: "BPHA 2026",
    template: "BPHA",
    ratingScheme: "NEW",
    extras: { ...NONE },
    to: ["hhsrs@bpha.org.uk"],
    cc: ["gwheeler@savills.com"],
    hint: "BPHA: standard email wording; Low / Medium / High ratings.",
  },
  {
    name: "MTVH",
    template: "Standard",
    ratingScheme: "NEW",
    extras: { ...NONE, calls: true },
    to: ["HHSRS@MTVH.co.uk"],
    cc: ["gwheeler@savills.com", "tsharp@savillshousing.co.uk"],
    hint: "MTVH: call reference when used; High-scheme ratings.",
  },
];

export const RATING_OPTIONS: Record<RatingScheme, string[]> = {
  NEW: ["Low", "Medium", "High", "High – emergency risk", "High – severe risk"],
  OLD: ["Slight", "Moderate", "Severe", "Severe – emergency risk", "Severe"],
};

/** Match a live submission projectName to the closest demo/stub config. */
export function matchDemoProject(projectName: string): ReporterProjectDemo | null {
  const raw = (projectName || "").trim();
  if (!raw) return null;
  const exact = REPORTER_DEMO_PROJECTS.find((p) => p.name.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower.startsWith("onward")) {
    return REPORTER_DEMO_PROJECTS.find((p) => p.name === "Onward 2026") || null;
  }
  if (/^vico\b/i.test(raw)) {
    return REPORTER_DEMO_PROJECTS.find((p) => p.name === "Vico Homes") || null;
  }
  if (lower.startsWith("cornwall")) {
    return REPORTER_DEMO_PROJECTS.find((p) => p.name === "Cornwall 2026") || null;
  }
  if (lower.startsWith("bpha")) {
    return REPORTER_DEMO_PROJECTS.find((p) => p.name === "BPHA 2026") || null;
  }
  if (lower.startsWith("mtvh") || lower.includes("mtvh")) {
    return REPORTER_DEMO_PROJECTS.find((p) => p.name === "MTVH") || null;
  }
  return null;
}

export const SITE_FORM_PUBLIC_URL = "https://savillscloudportal.co.uk/HHSRS-site-form";

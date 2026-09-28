/**
 * Office-edited To / Cc / Bcc for HHSRS Reporter projects.
 * A saved row wins, including a saved empty To. No row falls back to the roster lists in code.
 *
 * The row key is the live Project.name a submission stores. Roster labels such as
 * "LFHA (Leeds)" are not keys. Leeds Fed HA 2026 still uses the LFHA roster for
 * the email template; the address row is "Leeds Fed HA 2026".
 */
import { prisma } from "./prisma.js";
import { matchDemoProject, type ReporterProjectDemo } from "./hhsrs-reporter-projects.js";
import { emailRecipientsFromProject } from "./hhsrs-reporter.js";
import { isValidEmailAddress } from "./hhsrs-send.js";
import { formatAccessDay } from "./hhsrs-site-access.js";

/** Dummy project. Its seeded address row must stay editable even when it is not a live Project. */
export const TEST_HOUSING_PROJECT = "Test Housing";

/**
 * Roster labels that are not the Project.name stored on a submission.
 * Lookup and Admin save both run through resolveClientEmailProject.
 */
const ROSTER_TO_LIVE_NAME: Record<string, string> = {
  lfha: "Leeds Fed HA 2026",
  "lfha 2026": "Leeds Fed HA 2026",
  "lfha (leeds)": "Leeds Fed HA 2026",
  "leeds federation": "Leeds Fed HA 2026",
  "leeds federation (leeds)": "Leeds Fed HA 2026",
  "mtvh pilot 2026": "MTVH 2026",
  "mtvh phase 1 2026": "MTVH 2026",
  "vico 2026 8k": "Vico 2026",
};

/** Live names whose casing must survive a differently cased submission. */
const LIVE_NAME_CANONICAL = [
  "Leeds Fed HA 2026",
  "MTVH 2026",
  "Vico 2026",
  "Onward 2026",
  TEST_HOUSING_PROJECT,
];

export type ResolvedClientEmailProject = {
  /** HhsrsClientEmail.projectName. The live Project.name submissions use. */
  key: string;
  /** Roster email settings (template lists). Null when the name matches no roster. */
  roster: ReporterProjectDemo | null;
};

/**
 * One resolver for Admin save and for Generate / Send / Send and log / Find & resend.
 * "Leeds Fed HA 2026" stays that key and still picks up LFHA roster settings.
 * "MTVH 2026" and "Vico 2026" stay those keys, not "MTVH Pilot 2026" or "Vico 2026 8k".
 */
export function resolveClientEmailProject(projectName: string): ResolvedClientEmailProject {
  const raw = String(projectName || "").trim();
  if (!raw) return { key: "", roster: null };
  const lower = raw.toLowerCase();
  const aliased = ROSTER_TO_LIVE_NAME[lower];
  const canonical = LIVE_NAME_CANONICAL.find((name) => name.toLowerCase() === lower);
  const key = aliased || canonical || raw;
  return { key, roster: matchDemoProject(raw) || matchDemoProject(key) };
}

export type ClientEmailDraft = { to: string; cc: string; bcc: string };

export type ClientEmailRow = {
  projectName: string;
  toAddresses: string;
  ccAddresses: string;
  bccAddresses: string;
  changedAt: Date;
  changedByName: string;
};

export type ClientEmailFlash = {
  projectName: string;
  saved: boolean;
  error: string;
  toText: string;
  ccText: string;
  bccText: string;
};

export type ClientEmailCard = {
  projectName: string;
  toId: string;
  ccId: string;
  bccId: string;
  toText: string;
  ccText: string;
  bccText: string;
  changedLine: string;
  saved: boolean;
  error: string;
  open: boolean;
};

export function clientEmailInputId(projectName: string, field: "to" | "cc" | "bcc"): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `hhsrs-addr-${slug}-${field}`;
}

export function clientEmailChangedLine(changedAt: Date, changedByName: string): string {
  const day = formatAccessDay(changedAt);
  const name = changedByName.trim();
  return name ? `Last changed ${day} by ${name}` : `Last changed ${day}`;
}

/** One address per line, or comma / semicolon separated. Drops blanks and repeats. */
export function parseAddressBox(raw: string): { ok: true; addresses: string[] } | { ok: false; error: string } {
  const parts = String(raw || "")
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const part of parts) {
    if (!isValidEmailAddress(part)) return { ok: false, error: `Not a valid address: ${part}.` };
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(part);
  }
  return { ok: true, addresses };
}

function storedLines(value: string): string[] {
  return String(value || "")
    .split(/\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function boxFromList(values: readonly string[] | null | undefined): string {
  return (values || []).map((value) => value.trim()).filter(Boolean).join("\n");
}

/** Saved row wins. No row uses the roster lists for that same resolved project. */
export function recipientsFromStoredOrCode(
  projectName: string,
  row: { toAddresses: string; ccAddresses: string; bccAddresses: string } | null | undefined
): ClientEmailDraft {
  const { roster } = resolveClientEmailProject(projectName);
  if (!row) return emailRecipientsFromProject(roster);
  return emailRecipientsFromProject({
    to: storedLines(row.toAddresses),
    cc: storedLines(row.ccAddresses),
    bcc: storedLines(row.bccAddresses),
  });
}

export function buildClientEmailCards(
  projects: readonly { name: string; to: readonly string[]; cc: readonly string[]; bcc?: readonly string[] }[],
  rows: readonly ClientEmailRow[],
  flash: ClientEmailFlash | null
): ClientEmailCard[] {
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return ordered.map((project) => {
    const row = rows.find((item) => item.projectName === project.name) || null;
    const posted = flash && flash.projectName === project.name ? flash : null;
    const showingError = Boolean(posted && !posted.saved && posted.error);
    return {
      projectName: project.name,
      toId: clientEmailInputId(project.name, "to"),
      ccId: clientEmailInputId(project.name, "cc"),
      bccId: clientEmailInputId(project.name, "bcc"),
      toText: showingError && posted ? posted.toText : row ? row.toAddresses : boxFromList(project.to),
      ccText: showingError && posted ? posted.ccText : row ? row.ccAddresses : boxFromList(project.cc),
      bccText: showingError && posted ? posted.bccText : row ? row.bccAddresses : boxFromList(project.bcc),
      changedLine: row ? clientEmailChangedLine(row.changedAt, row.changedByName) : "",
      saved: Boolean(posted?.saved),
      error: showingError && posted ? posted.error : "",
      open: Boolean(posted && (posted.saved || showingError)),
    };
  });
}

export function unmatchedClientEmailError(
  projects: readonly { name: string }[],
  flash: ClientEmailFlash | null
): string {
  if (!flash || flash.saved || !flash.error) return "";
  if (projects.some((project) => project.name === flash.projectName)) return "";
  return flash.error;
}

/** When the send form has no addresses yet, use the stored (or code) lists. */
export function sendBodyWithClientRecipients(
  body: Record<string, unknown>,
  stored: ClientEmailDraft
): Record<string, unknown> {
  const to = String(body.to ?? "").trim();
  const cc = String(body.cc ?? "").trim();
  const bcc = String(body.bcc ?? "").trim();
  if (to || cc || bcc) return body;
  return { ...body, to: stored.to, cc: stored.cc, bcc: stored.bcc };
}

export async function loadClientEmailRows(): Promise<ClientEmailRow[]> {
  return prisma.hhsrsClientEmail.findMany({ orderBy: { projectName: "asc" } });
}

/** Current HHSRS projects, by the Project.name a submission stores, plus Test Housing. */
export async function loadClientEmailProjects(): Promise<
  { name: string; to: readonly string[]; cc: readonly string[]; bcc?: readonly string[] }[]
> {
  const rows = await prisma.project.findMany({
    where: { stage: "current" },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const names = rows.map((row) => row.name.trim()).filter(Boolean);
  if (!names.some((name) => name.toLowerCase() === TEST_HOUSING_PROJECT.toLowerCase())) {
    names.push(TEST_HOUSING_PROJECT);
  }
  return names.map((name) => {
    const { roster } = resolveClientEmailProject(name);
    return { name, to: roster?.to ?? [], cc: roster?.cc ?? [], bcc: roster?.bcc };
  });
}

export async function loadClientEmailCards(flash: ClientEmailFlash | null): Promise<ClientEmailCard[]> {
  const [projects, rows] = await Promise.all([loadClientEmailProjects(), loadClientEmailRows()]);
  return buildClientEmailCards(projects, rows, flash);
}

export async function clientRecipientsForProject(projectName: string): Promise<ClientEmailDraft> {
  const { key } = resolveClientEmailProject(projectName);
  if (!key) return { to: "", cc: "", bcc: "" };
  const row = await prisma.hhsrsClientEmail.findUnique({ where: { projectName: key } });
  return recipientsFromStoredOrCode(projectName, row);
}

export async function saveClientEmail(input: {
  projectName: string;
  toRaw: string;
  ccRaw: string;
  bccRaw: string;
  changedByName: string;
}): Promise<{ ok: true; projectName: string } | { ok: false; error: string }> {
  const posted = String(input.projectName || "").trim();
  const projects = await loadClientEmailProjects();
  const project = projects.find((item) => item.name.toLowerCase() === posted.toLowerCase());
  if (!project) return { ok: false, error: "Unknown project." };
  const projectName = project.name;

  const to = parseAddressBox(input.toRaw);
  if (!to.ok) return to;
  const cc = parseAddressBox(input.ccRaw);
  if (!cc.ok) return cc;
  const bcc = parseAddressBox(input.bccRaw);
  if (!bcc.ok) return bcc;

  const data = {
    toAddresses: to.addresses.join("\n"),
    ccAddresses: cc.addresses.join("\n"),
    bccAddresses: bcc.addresses.join("\n"),
    changedAt: new Date(),
    changedByName: input.changedByName.trim(),
  };
  await prisma.hhsrsClientEmail.upsert({
    where: { projectName },
    create: { projectName, ...data },
    update: data,
  });
  return { ok: true, projectName };
}

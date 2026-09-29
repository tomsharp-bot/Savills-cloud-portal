/**
 * Office-edited To / Cc / Bcc for HHSRS Reporter projects.
 * A saved row wins, including a saved empty To. No row falls back to the roster lists in code.
 *
 * The row key is the live Project.name a submission stores. Roster labels such as
 * "LFHA (Leeds)" are not keys. Leeds Fed HA 2026 still uses the LFHA roster for
 * the email template; the address row is "Leeds Fed HA 2026".
 */
import { prisma } from "./prisma.js";
import { resolveHhsrsProject, type ReporterProjectDemo } from "./hhsrs-reporter-projects.js";
import { loadPortalProjectNames } from "./hhsrs-portal-projects.js";
import { emailRecipientsFromProject } from "./hhsrs-reporter.js";
import { isValidEmailAddress } from "./hhsrs-send.js";

export type ResolvedClientEmailProject = {
  /** HhsrsClientEmail.projectName. The portal Project.name submissions use. */
  key: string;
  /** Roster email settings (template lists). Null when the name matches no roster. */
  roster: ReporterProjectDemo | null;
};

/** Address-row key for a submission. Same resolver as templates, calls, and reference codes. */
export function resolveClientEmailProject(projectName: string): ResolvedClientEmailProject {
  const resolved = resolveHhsrsProject(projectName);
  return { key: resolved.name, roster: resolved.roster };
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

function formatLondonDay(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function clientEmailChangedLine(changedAt: Date, changedByName: string): string {
  const day = formatLondonDay(changedAt);
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

/** Current portal projects, the same names the site form dropdown uses. */
export async function loadClientEmailProjects(): Promise<
  { name: string; to: readonly string[]; cc: readonly string[]; bcc?: readonly string[] }[]
> {
  const names = await loadPortalProjectNames();
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

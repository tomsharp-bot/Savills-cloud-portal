/**
 * Person-initiated HHSRS portal send.
 * Nothing here sends on a schedule. Callers must be a signed-in Reporter action.
 * The mailbox password is never read, returned, or logged by this module.
 */
import { randomUUID } from "node:crypto";

export const DEFAULT_ALLOW_DOMAIN = "savillshousing.co.uk";
export const TEST_MODE_BANNER = "Test mode: only Savills addresses can receive emails.";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const SEND_FAILED_MESSAGE = "Email not sent. Try again.";
export const SENT_COPY_WARNING = "Sent. Mailbox Sent folder copy failed.";

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type AllowList = "*" | string[];

export type SendCheckInput = {
  hasReporterAccess: boolean;
  passwordSet: boolean;
  alreadySent: boolean;
  checked: boolean;
  to: string;
  cc: string;
  bcc: string;
  allowDomainsRaw: string | undefined;
  totalBytes: number;
  maxBytes?: number;
};

export type SendCheckOk = {
  ok: true;
  to: string[];
  cc: string[];
  bcc: string[];
};

export type SendCheckFail = { ok: false; error: string };

export function smtpPasswordSet(): boolean {
  return Boolean(process.env.HHSRS_SMTP_PASSWORD);
}

export function fromNameFromEnv(): string {
  const value = (process.env.HHSRS_FROM_NAME || "").trim();
  return value || "Savills HHSRS";
}

export function fromAddressFromEnv(): string {
  const value = (process.env.HHSRS_SMTP_USER || "").trim();
  return value || "hhsrs@savillshousing.co.uk";
}

export function formatFromLine(name = fromNameFromEnv(), address = fromAddressFromEnv()): string {
  return `${name} <${address}>`;
}

export function parseAllowDomains(raw: string | undefined): AllowList {
  if (raw === undefined || raw.trim() === "") return [DEFAULT_ALLOW_DOMAIN];
  const value = raw.trim();
  if (value === "*") return "*";
  const domains = value
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase().replace(/^@/, "").replace(/^\.+/, "").replace(/\.+$/, ""))
    .filter(Boolean);
  return domains.length ? domains : [DEFAULT_ALLOW_DOMAIN];
}

export function allowDomainsFromEnv(): AllowList {
  return parseAllowDomains(process.env.HHSRS_SEND_ALLOW_DOMAINS);
}

export function publicSendSettings(sent: boolean) {
  const allow = allowDomainsFromEnv();
  const fromName = fromNameFromEnv();
  const fromAddress = fromAddressFromEnv();
  return {
    configured: smtpPasswordSet(),
    fromName,
    fromAddress,
    fromLine: formatFromLine(fromName, fromAddress),
    testMode: allow !== "*",
    testBanner: TEST_MODE_BANNER,
    maxBytes: MAX_ATTACHMENT_BYTES,
    sent,
  };
}

export function splitAddresses(raw: string): string[] {
  return String(raw || "")
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isValidEmailAddress(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function emailDomain(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) return "";
  return address.slice(at + 1).toLowerCase().replace(/\.$/, "");
}

export function domainIsAllowed(domain: string, allow: AllowList): boolean {
  if (allow === "*") return true;
  const host = domain.toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  return allow.some((item) => host === item || host.endsWith("." + item));
}

export function isTickChecked(value: unknown): boolean {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "on" || text === "yes";
}

export function checkSendRequest(input: SendCheckInput): SendCheckOk | SendCheckFail {
  if (!input.hasReporterAccess) return { ok: false, error: "Not allowed." };
  if (!input.passwordSet) return { ok: false, error: "Sending not set up yet." };
  if (input.alreadySent) return { ok: false, error: "Already sent. Can't be sent again." };
  if (!input.checked) return { ok: false, error: "Tick the box first." };

  const to = splitAddresses(input.to);
  const cc = splitAddresses(input.cc);
  const bcc = splitAddresses(input.bcc);
  if (!to.length) return { ok: false, error: "Add a To address." };

  const invalid = [...to, ...cc, ...bcc].find((address) => !isValidEmailAddress(address));
  if (invalid) return { ok: false, error: `Not a valid address: ${invalid}.` };

  const allow = parseAllowDomains(input.allowDomainsRaw);
  const blocked = [...to, ...cc, ...bcc].find((address) => !domainIsAllowed(emailDomain(address), allow));
  if (blocked) return { ok: false, error: `Not sent. ${blocked} is not allowed.` };

  const maxBytes = input.maxBytes ?? MAX_ATTACHMENT_BYTES;
  if (input.totalBytes > maxBytes) return { ok: false, error: "Photos are over 20 MB." };
  return { ok: true, to, cc, bcc };
}

export function checkAttachments(
  knownNames: readonly string[],
  requested: readonly string[],
  sizeOf: (name: string) => number | null,
  maxBytes = MAX_ATTACHMENT_BYTES
): { ok: true; names: string[]; totalBytes: number } | SendCheckFail {
  const known = new Set(knownNames);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of requested) {
    const name = String(raw || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (!known.has(name)) return { ok: false, error: "Photo not on this case." };
    names.push(name);
  }
  let totalBytes = 0;
  for (const name of names) {
    const size = sizeOf(name);
    if (size == null || size < 0 || !Number.isFinite(size)) {
      return { ok: false, error: "A photo is missing. Not sent." };
    }
    totalBytes += size;
    if (totalBytes > maxBytes) return { ok: false, error: "Photos are over 20 MB." };
  }
  return { ok: true, names, totalBytes };
}

export function redactSecrets(text: string, secret?: string): string {
  let out = String(text || "").replace(/(pass(word)?|auth)[=:]\s*\S+/gi, "$1=[redacted]");
  const hidden = secret ?? process.env.HHSRS_SMTP_PASSWORD ?? "";
  if (hidden && hidden.length >= 3 && out.includes(hidden)) {
    out = out.split(hidden).join("[redacted]");
  }
  return out.slice(0, 500);
}

export function logSendFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err || "send failed");
  console.error("HHSRS email not sent:", redactSecrets(message));
}

export function formatSentClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatSentDay(date: Date): string {
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function sentBannerText(sentBy: string, sentAt: Date): string {
  return `✓ Sent by ${sentBy} · ${formatSentClock(sentAt)} · from HHSRS`;
}

export type SendCommit = {
  sentAt: Date;
  sentBy: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  photoNames: string[];
  messageId: string;
  sentCopySaved: boolean;
  sentCopyError: string;
};

export type SentEmailRecord = SendCommit & {
  id: string;
  submissionId: string;
};

export class PortalSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalSendError";
  }
}

export type OutboundAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type OutboundEmail = {
  fromName: string;
  fromAddress: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  messageId: string;
  attachments: OutboundAttachment[];
};

export type DeliverInput = {
  submissionId: string;
  sentBy: string;
  hasReporterAccess: boolean;
  passwordSet: boolean;
  alreadySent: boolean;
  checked: boolean;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  photoNames: string[];
  attachments: OutboundAttachment[];
  allowDomainsRaw: string | undefined;
  totalBytes: number;
  fromName?: string;
  fromAddress?: string;
  sentAt?: Date;
};

export type DeliverResult =
  | { ok: true; record: SentEmailRecord; warning: string }
  | { ok: false; error: string };

export async function deliverPortalEmail(
  input: DeliverInput,
  deps: {
    sendMail: (mail: OutboundEmail) => Promise<{ messageId: string; raw: Buffer }>;
    appendToSent: (raw: Buffer) => Promise<void>;
    exclusive: (run: () => Promise<SendCommit>) => Promise<SentEmailRecord>;
  }
): Promise<DeliverResult> {
  const check = checkSendRequest({
    hasReporterAccess: input.hasReporterAccess,
    passwordSet: input.passwordSet,
    alreadySent: input.alreadySent,
    checked: input.checked,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    allowDomainsRaw: input.allowDomainsRaw,
    totalBytes: input.totalBytes,
  });
  if (!check.ok) return check;

  const fromName = input.fromName || fromNameFromEnv();
  const fromAddress = input.fromAddress || fromAddressFromEnv();
  const sentAt = input.sentAt || new Date();
  const body = String(input.body || "").replace(/\s+$/, "");
  const subject = String(input.subject || "").trim();

  try {
    const record = await deps.exclusive(async () => {
      const messageId = `<${randomUUID()}@${emailDomain(fromAddress) || DEFAULT_ALLOW_DOMAIN}>`;
      const mail: OutboundEmail = {
        fromName,
        fromAddress,
        to: check.to,
        cc: check.cc,
        bcc: check.bcc,
        subject,
        text: body,
        messageId,
        attachments: input.attachments,
      };
      const sent = await deps.sendMail(mail);
      let sentCopySaved = false;
      let sentCopyError = "";
      try {
        await deps.appendToSent(sent.raw);
        sentCopySaved = true;
      } catch (err) {
        sentCopyError = redactSecrets(err instanceof Error ? err.message : String(err || "Sent copy failed"));
        console.error("HHSRS sent-folder copy failed:", sentCopyError);
      }
      return {
        sentAt,
        sentBy: input.sentBy,
        from: formatFromLine(fromName, fromAddress),
        to: check.to.join("; "),
        cc: check.cc.join("; "),
        bcc: check.bcc.join("; "),
        subject,
        body,
        photoNames: input.photoNames,
        messageId: sent.messageId || messageId,
        sentCopySaved,
        sentCopyError,
      };
    });
    return {
      ok: true,
      record,
      warning: record.sentCopySaved ? "" : SENT_COPY_WARNING,
    };
  } catch (err) {
    if (err instanceof PortalSendError) return { ok: false, error: err.message };
    logSendFailure(err);
    return { ok: false, error: SEND_FAILED_MESSAGE };
  }
}

export type MainLogEntryView = {
  caseLine: string;
  emailLine: string;
  emailSent: boolean;
  fromLine: string;
  markedByLine: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  photoLabel: string;
  photoNames: string[];
  copyWarning: string;
};

export function buildMainLogEntry(input: {
  uprn: string;
  address: string;
  projectName: string;
  sent: Pick<
    SentEmailRecord,
    "sentAt" | "sentBy" | "from" | "to" | "cc" | "bcc" | "subject" | "body" | "photoNames" | "sentCopySaved"
  > | null;
  markedBy: string;
  markedAt: Date | null;
}): MainLogEntryView {
  const sent = input.sent;
  const markedAt = input.markedAt;
  const names = sent ? sent.photoNames.map(String) : [];
  return {
    caseLine: `UPRN ${input.uprn || "—"} · ${input.address || "—"} · ${input.projectName || "—"}`,
    emailLine: sent
      ? `Sent from HHSRS by ${sent.sentBy} at ${formatSentClock(sent.sentAt)} · ${formatSentDay(sent.sentAt)}`
      : "Not sent from the portal",
    emailSent: Boolean(sent),
    fromLine: sent?.from || formatFromLine(),
    markedByLine: markedAt
      ? `${input.markedBy || "—"} · ${formatSentDay(markedAt)} · ${formatSentClock(markedAt)}`
      : input.markedBy || "—",
    to: sent?.to || "",
    cc: sent?.cc || "",
    bcc: sent?.bcc || "",
    subject: sent?.subject || "",
    body: sent?.body || "",
    photoLabel: `Photos sent (${names.length})`,
    photoNames: names,
    copyWarning: sent && !sent.sentCopySaved ? SENT_COPY_WARNING : "",
  };
}

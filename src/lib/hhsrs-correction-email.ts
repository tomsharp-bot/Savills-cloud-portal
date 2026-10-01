/**
 * Wording for an HHSRS correction email.
 * The subject stays the previous subject with a CORRECTION: prefix.
 * The opening line is fixed. The reason stays on the Main Log.
 * Bold is HTML <b>, applied to a bullet value that differs from the previous email.
 */
import { correctionSubject, type CorrectionReason } from "./hhsrs-find.js";
import { isHhsrsCategory, isHhsrsSiteFormRating } from "./hhsrs-categories.js";
import { escapeHtml, stripTrailingSignature } from "./hhsrs-signature.js";

/** First line of a correction. Do not add the reason or the old "this corrects" sentence. */
export const CORRECTION_OPENING_LINE =
  "Please disregard our previous email, due to an error. See correct details below.";

/** Second line, only when the attached photo set differs from the previous email. */
export const CORRECTION_PHOTO_LINE = "The photo was incorrect.";

export type CorrectionCopyInput = {
  previousBody: string;
  nextBody: string;
  previousTo: string;
  nextTo: string;
  previousPhotos: readonly string[];
  nextPhotos: readonly string[];
  reason: string;
  note: string;
};

export type PreparedCorrectionEmail = {
  text: string;
  /** Escaped message HTML, with <br> and <b>. The signature is added later. */
  messageHtml: string;
};

type Run = { text: string; bold?: boolean };
type Line = { runs: Run[] };
type Bullet = { label: string; value: string };

function normalizeNewlines(value: string): string {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

const OPENING_LINE = /^Please disregard our previous email\b/i;
const PHOTO_LINE = /^The photo was incorrect\.\n*/;

/** True when a photo was removed or a different photo was added. Order does not matter. */
export function correctionPhotoSetChanged(
  previous: readonly string[] | null | undefined,
  next: readonly string[] | null | undefined
): boolean {
  const names = (list: readonly string[] | null | undefined) => {
    const set = new Set<string>();
    for (const name of list || []) {
      const trimmed = String(name || "").trim();
      if (trimmed) set.add(trimmed);
    }
    return set;
  };
  const before = names(previous);
  const after = names(next);
  if (before.size !== after.size) return true;
  for (const name of before) {
    if (!after.has(name)) return true;
  }
  return false;
}

function dropLeadingPhotoLine(text: string): string {
  const match = text.match(PHOTO_LINE);
  if (!match) return text;
  return text.slice(match[0].length).replace(/^\n+/, "");
}

function withoutOpening(text: string): string {
  const greeting = text.match(/^(Hi all,)\n+/i);
  const rest = greeting ? text.slice(greeting[0].length).replace(/^\n+/, "") : text;
  if (!OPENING_LINE.test(rest)) return text;
  const blank = rest.search(/\n\s*\n/);
  const after = dropLeadingPhotoLine(blank === -1 ? "" : rest.slice(blank).replace(/^\n\s*\n/, "").replace(/^\n+/, ""));
  if (!greeting) return after;
  return after ? `${greeting[1]}\n\n${after}` : greeting[1];
}

/** Drop a previous correction opening so a later correction does not stack it. */
export function stripCorrectionIntro(body: string): string {
  const text = normalizeNewlines(body);
  const lead = text.match(/^(Please disregard our previous email\b[^\n]*)\n*/i);
  if (lead) return withoutOpening(dropLeadingPhotoLine(text.slice(lead[0].length).replace(/^\n+/, "")));
  return withoutOpening(text);
}

function bulletsIn(body: string): Bullet[] {
  const seen = new Set<string>();
  const found: Bullet[] = [];
  for (const line of normalizeNewlines(body).split("\n")) {
    const match = line.match(/^•\s*([^:]+):\s*(.*)$/);
    if (!match) continue;
    const label = match[1].trim();
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ label, value: match[2].trim() });
  }
  return found;
}

function contentLine(line: string, changedKeys: ReadonlySet<string>): Line {
  const match = line.match(/^(\s*•\s*)([^:]+)(:\s*)([\s\S]*)$/);
  if (!match) return { runs: [{ text: line }] };
  const label = match[2].trim();
  if (!changedKeys.has(label.toLowerCase())) return { runs: [{ text: line }] };
  const rawValue = match[4];
  const value = rawValue.trim();
  if (!value) return { runs: [{ text: line }] };
  const start = rawValue.indexOf(value);
  if (start < 0) return { runs: [{ text: line }] };
  return {
    runs: [
      { text: match[1] + match[2] + match[3] + rawValue.slice(0, start) },
      { text: value, bold: true },
      { text: rawValue.slice(start + value.length) },
    ],
  };
}

function runsToText(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join("");
}

function renderRuns(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      const safe = escapeHtml(run.text);
      return run.bold ? `<b>${safe}</b>` : safe;
    })
    .join("");
}

/**
 * Fixed opening, then the edited body. Changed bullet values are bold in the HTML.
 * The reason and any office note stay on the Main Log. They are not copied into the email.
 */
export function prepareCorrectionEmail(input: CorrectionCopyInput): PreparedCorrectionEmail {
  const previousBody = stripCorrectionIntro(input.previousBody);
  const nextBody = stripCorrectionIntro(input.nextBody);
  const previousBullets = bulletsIn(previousBody);
  const nextBullets = bulletsIn(nextBody);
  const previousByKey = new Map(previousBullets.map((item) => [item.label.toLowerCase(), item.value]));
  const previousHadBullets = previousBullets.length > 0;
  const changedKeys = new Set<string>();

  for (const bullet of nextBullets) {
    const key = bullet.label.toLowerCase();
    const before = previousByKey.get(key);
    const knownChange = before !== undefined && before !== bullet.value;
    const added = before === undefined && previousHadBullets && Boolean(bullet.value);
    if (knownChange || added) changedKeys.add(key);
  }

  const greeting = nextBody.match(/^(Hi all,)\n+([\s\S]*)$/i);
  const lines: Line[] = [{ runs: [{ text: CORRECTION_OPENING_LINE }] }];
  if (correctionPhotoSetChanged(input.previousPhotos, input.nextPhotos)) {
    lines.push({ runs: [{ text: "" }] }, { runs: [{ text: CORRECTION_PHOTO_LINE }] });
  }
  lines.push({ runs: [{ text: "" }] });
  const pushRest = (rest: string) => {
    if (!rest) return;
    for (const line of rest.split("\n")) lines.push(contentLine(line, changedKeys));
  };
  if (greeting) {
    lines.push({ runs: [{ text: greeting[1] }] }, { runs: [{ text: "" }] });
    pushRest(greeting[2].replace(/^\n+/, ""));
  } else if (nextBody) {
    pushRest(nextBody);
  }

  const text = lines
    .map((line) => runsToText(line.runs))
    .join("\n")
    .replace(/\s+$/, "");
  const messageHtml = lines.map((line) => renderRuns(line.runs)).join("<br>\n");
  return { text, messageHtml };
}

/** Fields the Amend screen can change. Hazard and rating stay on the set lists. */
export type AmendmentFields = {
  address: string;
  uprn: string;
  hazard: string;
  rating: string;
  notes: string;
  surveyDate: string;
};

export type AmendmentExtra = { label: string; value: string };

export type ParsedSentEmail = {
  fields: AmendmentFields;
  extras: AmendmentExtra[];
  prose: string[];
};

const FIELD_KEYS: Record<string, keyof AmendmentFields> = {
  address: "address",
  uprn: "uprn",
  hazard: "hazard",
  "hazard category": "hazard",
  rating: "rating",
  "hazard rating": "rating",
  "site notes": "notes",
  comments: "notes",
  "survey date": "surveyDate",
};

const FIELD_LABELS: { key: keyof AmendmentFields; label: string }[] = [
  { key: "address", label: "Address" },
  { key: "uprn", label: "UPRN" },
  { key: "hazard", label: "Hazard" },
  { key: "rating", label: "Rating" },
  { key: "notes", label: "Site notes" },
  { key: "surveyDate", label: "Survey date" },
];

/** Bullet order and labels for a rebuilt client email. The change note keeps FIELD_LABELS. */
const EMAIL_BODY_FIELDS: { key: keyof AmendmentFields; label: string }[] = [
  { key: "uprn", label: "UPRN" },
  { key: "address", label: "Address" },
  { key: "surveyDate", label: "Survey date" },
  { key: "hazard", label: "Hazard category" },
  { key: "notes", label: "Comments" },
  { key: "rating", label: "Hazard rating" },
];

function emptyFields(): AmendmentFields {
  return { address: "", uprn: "", hazard: "", rating: "", notes: "", surveyDate: "" };
}

function tidy(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** Read the newest sent email. A previous correction opening is ignored. */
export function parseSentEmail(body: string): ParsedSentEmail {
  const stripped = stripTrailingSignature(stripCorrectionIntro(body));
  const fields = emptyFields();
  const extras: AmendmentExtra[] = [];
  const prose: string[] = [];
  const seen = new Set<string>();
  for (const line of stripped.split("\n")) {
    const match = line.match(/^•\s*([^:]+):\s*(.*)$/);
    if (!match) {
      const plain = line.trim();
      if (!plain || /^hi all,$/i.test(plain) || /^hhsrs notification$/i.test(plain) || OPENING_LINE.test(plain)) continue;
      prose.push(plain);
      continue;
    }
    const label = match[1].trim();
    const value = match[2].trim();
    const key = label.toLowerCase();
    const fieldKey = FIELD_KEYS[key];
    if (fieldKey && !seen.has(key)) {
      seen.add(key);
      fields[fieldKey] = value;
      continue;
    }
    extras.push({ label, value });
  }
  return { fields, extras, prose };
}

export function readAmendmentFields(body: Record<string, unknown>): AmendmentFields {
  return {
    address: tidy(String(body.address ?? "")),
    uprn: tidy(String(body.uprn ?? "")),
    hazard: tidy(String(body.hazard ?? "")),
    rating: tidy(String(body.rating ?? "")),
    notes: tidy(String(body.notes ?? "")),
    surveyDate: tidy(String(body.surveyDate ?? "")),
  };
}

/** Keep a legacy value that is already on the sent email. New picks must be from the set lists. */
export function amendmentListError(previous: AmendmentFields, next: AmendmentFields): string {
  if (next.hazard !== previous.hazard && !isHhsrsCategory(next.hazard)) {
    return "Choose a hazard from the list.";
  }
  if (next.rating !== previous.rating && !isHhsrsSiteFormRating(next.rating)) {
    return "Choose a rating from the list.";
  }
  return "";
}

export function amendmentChangeNote(previous: AmendmentFields, next: AmendmentFields, amendment: string): string {
  const typed = tidy(amendment);
  const parts = FIELD_LABELS.filter(({ key }) => previous[key] !== next[key]).map(
    ({ key, label }) => `${label}: ${previous[key] || "—"} → ${next[key] || "—"}`
  );
  const summary = parts.join("; ");
  if (typed && summary) return `${typed} — ${summary}`;
  return typed || summary;
}

function correctionSubjectForAddress(previousSubject: string, previousAddress: string, nextAddress: string): string {
  let subject = correctionSubject(previousSubject);
  const oldHead = previousAddress.split(",")[0].trim();
  const newHead = nextAddress.split(",")[0].trim();
  if (oldHead && newHead && oldHead !== newHead && subject.includes(oldHead)) {
    subject = subject.replace(oldHead, newHead);
  }
  return subject;
}

function includeField(previous: string, next: string): boolean {
  return Boolean(previous.trim() || next.trim());
}

export type BuiltAmendmentEmail = {
  subject: string;
  text: string;
  messageHtml: string;
  reason: CorrectionReason;
  note: string;
  next: AmendmentFields;
};

/**
 * Correction email for Amend & resend.
 * Subject starts with CORRECTION. The opening line is fixed, then the updated lines.
 * Values that differ from the email we started from are bold.
 */
export function buildAmendmentEmail(input: {
  previousBody: string;
  previousSubject: string;
  next: AmendmentFields;
  amendment: string;
  previousPhotos?: readonly string[];
  nextPhotos?: readonly string[];
}): BuiltAmendmentEmail {
  const parsed = parseSentEmail(input.previousBody);
  const previous = parsed.fields;
  const next = {
    address: tidy(input.next.address),
    uprn: tidy(input.next.uprn),
    hazard: tidy(input.next.hazard),
    rating: tidy(input.next.rating),
    notes: tidy(input.next.notes),
    surveyDate: tidy(input.next.surveyDate),
  };
  const amendment = tidy(input.amendment);
  const intro = CORRECTION_OPENING_LINE;
  const photoLine = correctionPhotoSetChanged(input.previousPhotos, input.nextPhotos);
  const textLines = [intro];
  if (photoLine) textLines.push("", CORRECTION_PHOTO_LINE);
  textLines.push("", "HHSRS notification", "");
  for (const line of parsed.prose) textLines.push(line, "");
  const htmlBits = [`<p>${escapeHtml(intro)}</p>`];
  if (photoLine) htmlBits.push(`<p><b>${escapeHtml(CORRECTION_PHOTO_LINE)}</b></p>`);
  htmlBits.push(`<p>HHSRS notification</p>`);
  for (const line of parsed.prose) htmlBits.push(`<p>${escapeHtml(line)}</p>`);
  const bullets: string[] = [];
  const htmlItems: string[] = [];
  for (const { key, label } of EMAIL_BODY_FIELDS) {
    if (!includeField(previous[key], next[key])) continue;
    const value = next[key];
    bullets.push(`• ${label}: ${value}`);
    const shown = previous[key] === value ? escapeHtml(value) : `<b>${escapeHtml(value)}</b>`;
    htmlItems.push(`<li>${escapeHtml(label)}: ${shown}</li>`);
  }
  for (const extra of parsed.extras) {
    bullets.push(`• ${extra.label}: ${extra.value}`);
    htmlItems.push(`<li>${escapeHtml(extra.label)}: ${escapeHtml(extra.value)}</li>`);
  }
  if (bullets.length) {
    textLines.push(...bullets);
    htmlBits.push(`<ul>${htmlItems.join("")}</ul>`);
  }
  const addressChanged = previous.address !== next.address;
  const otherChanged = FIELD_LABELS.some(({ key }) => key !== "address" && previous[key] !== next[key]);
  let reason: CorrectionReason = "Other";
  if (addressChanged && !otherChanged) reason = "Wrong address";
  else if (addressChanged || otherChanged) reason = "Wrong details";
  const note = amendmentChangeNote(previous, next, amendment) || "Correction";
  return {
    subject: correctionSubjectForAddress(input.previousSubject, previous.address, next.address),
    text: textLines.join("\n").replace(/\s+$/, ""),
    messageHtml: htmlBits.join(""),
    reason,
    note,
    next,
  };
}

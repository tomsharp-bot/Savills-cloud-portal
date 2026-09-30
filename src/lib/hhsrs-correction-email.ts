/**
 * Wording for an HHSRS correction email.
 * The subject stays the previous subject with a CORRECTION: prefix.
 * The reason code stays on the Main Log and is not copied into the email.
 * Bold is HTML <b>, applied to the new value in the opening and on its bullet.
 */
import { correctionSubject, type CorrectionReason } from "./hhsrs-find.js";
import { isHhsrsCategory, isHhsrsSiteFormRating } from "./hhsrs-categories.js";
import { escapeHtml, stripTrailingSignature } from "./hhsrs-signature.js";

/** Spoken name for a bullet label. Address uses the approved "property address". */
const FIELD_PHRASES: Record<string, string> = {
  address: "property address",
  uprn: "UPRN",
  hazard: "hazard",
  rating: "rating",
  "site notes": "site notes",
  "survey date": "survey date",
  cause: "cause",
  vulnerabilities: "vulnerabilities",
  escalation: "escalation",
  "work order": "work order",
  "client call reference": "client call reference",
  "onward call reference": "onward call reference",
  "why the call reference is blank": "reason the call reference is blank",
  call: "call",
  "onward call": "onward call",
};

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

function phraseFor(label: string): string {
  const key = label.trim().toLowerCase();
  return FIELD_PHRASES[key] || key;
}

function normalizeNewlines(value: string): string {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

/** Drop a previous correction opening so a later correction does not stack it. */
export function stripCorrectionIntro(body: string): string {
  const text = normalizeNewlines(body);
  const greeting = text.match(/^(Hi all,)\n+/i);
  const rest = greeting ? text.slice(greeting[0].length).replace(/^\n+/, "") : text;
  if (!/^Please disregard our previous email[.,]/i.test(rest)) return text;
  const blank = rest.search(/\n\s*\n/);
  const after = blank === -1 ? "" : rest.slice(blank).replace(/^\n\s*\n/, "").replace(/^\n+/, "");
  if (!greeting) return after;
  return after ? `${greeting[1]}\n\n${after}` : greeting[1];
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

function addresses(raw: string): string[] {
  return String(raw || "")
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sameAddresses(left: string, right: string): boolean {
  const a = addresses(left).map((item) => item.toLowerCase());
  const b = addresses(right).map((item) => item.toLowerCase());
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function photoKey(names: readonly string[]): string {
  return [...names]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort()
    .join("\0");
}

function valueClause(phrase: string, value: string): Run[] {
  const stop = /[.!?]$/.test(value) ? "" : ".";
  return [
    { text: `This corrects the ${phrase}, which is now ` },
    { text: value, bold: true },
    { text: stop },
  ];
}

function otherClause(note: string): Run[] {
  let text = String(note || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  if (!/[.!?]$/.test(text)) text += ".";
  if (/^this corrects\b/i.test(text)) {
    return [{ text: text.charAt(0).toUpperCase() + text.slice(1) }];
  }
  return [{ text: `This corrects the following: ${text}` }];
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
 * Opening plus the edited body. Changed bullet values are bold in the HTML.
 * Photos use the approved sentence and are not named. An Other note is included
 * in the same tone, without adding "was wrong".
 */
export function prepareCorrectionEmail(input: CorrectionCopyInput): PreparedCorrectionEmail {
  const previousBody = stripCorrectionIntro(input.previousBody);
  const nextBody = stripCorrectionIntro(input.nextBody);
  const previousBullets = bulletsIn(previousBody);
  const nextBullets = bulletsIn(nextBody);
  const previousByKey = new Map(previousBullets.map((item) => [item.label.toLowerCase(), item.value]));
  const previousHadBullets = previousBullets.length > 0;
  const changedKeys = new Set<string>();
  const clauses: Run[][] = [];

  for (const bullet of nextBullets) {
    const key = bullet.label.toLowerCase();
    const before = previousByKey.get(key);
    const knownChange = before !== undefined && before !== bullet.value;
    const added = before === undefined && previousHadBullets && Boolean(bullet.value);
    if (!knownChange && !added) continue;
    if (!bullet.value) {
      clauses.push([{ text: `This corrects the ${phraseFor(bullet.label)}.` }]);
      continue;
    }
    changedKeys.add(key);
    clauses.push(valueClause(phraseFor(bullet.label), bullet.value));
  }

  const nextRecipient = addresses(input.nextTo).join("; ");
  const hadPreviousRecipient = addresses(input.previousTo).length > 0;
  const recipientChanged =
    Boolean(nextRecipient) &&
    !sameAddresses(input.previousTo, input.nextTo) &&
    (hadPreviousRecipient || input.reason === "Wrong recipient");
  if (recipientChanged) clauses.push(valueClause("recipient", nextRecipient));

  const photosChanged = photoKey(input.previousPhotos) !== photoKey(input.nextPhotos);
  if (photosChanged || input.reason === "Missing photo") {
    clauses.push([{ text: "The correct photos are now attached.", bold: true }]);
  }

  if (input.reason === "Other") {
    const extra = otherClause(input.note);
    if (extra.length) clauses.push(extra);
  }

  const intro: Run[] = [{ text: "Please disregard our previous email." }];
  for (const clause of clauses) {
    intro.push({ text: " " }, ...clause);
  }

  const greeting = nextBody.match(/^(Hi all,)\n+([\s\S]*)$/i);
  const lines: Line[] = [];
  const pushRest = (rest: string) => {
    if (!rest) return;
    for (const line of rest.split("\n")) lines.push(contentLine(line, changedKeys));
  };
  if (greeting) {
    lines.push({ runs: [{ text: greeting[1] }] }, { runs: [{ text: "" }] }, { runs: intro }, { runs: [{ text: "" }] });
    pushRest(greeting[2].replace(/^\n+/, ""));
  } else {
    lines.push({ runs: intro });
    if (nextBody) {
      lines.push({ runs: [{ text: "" }] });
      pushRest(nextBody);
    }
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
  rating: "rating",
  "site notes": "notes",
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
      if (!plain || /^hi all,$/i.test(plain) || /^please disregard our previous email[.,]/i.test(plain)) continue;
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
 * Subject starts with CORRECTION. The body asks the client to disregard the previous email,
 * then shows the updated lines. Values that differ from the email we started from are bold.
 */
export function buildAmendmentEmail(input: {
  previousBody: string;
  previousSubject: string;
  next: AmendmentFields;
  amendment: string;
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
  const intro = amendment
    ? `Please disregard our previous email, due to an error. See correct details below. ${amendment}`
    : "Please disregard our previous email, due to an error. See correct details below.";
  const textLines = ["Hi all,", "", intro, ""];
  for (const line of parsed.prose) textLines.push(line, "");
  const htmlBits = [`<p>Hi all,</p>`, `<p>${escapeHtml(intro)}</p>`];
  for (const line of parsed.prose) htmlBits.push(`<p>${escapeHtml(line)}</p>`);
  const bullets: string[] = [];
  const htmlItems: string[] = [];
  for (const { key, label } of FIELD_LABELS) {
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

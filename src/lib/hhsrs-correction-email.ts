/**
 * Wording for an HHSRS correction email.
 * The subject stays the previous subject with a CORRECTION: prefix.
 * The reason code stays on the Main Log and is not copied into the email.
 * Bold is HTML <b>, applied to the new value in the opening and on its bullet.
 */
import { escapeHtml } from "./hhsrs-signature.js";

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
  if (!/^Please disregard our previous email\./i.test(rest)) return text;
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

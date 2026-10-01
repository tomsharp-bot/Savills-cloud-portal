/**
 * View details: the original surveyor entry beside the email that was sent.
 * A correction, when one was sent, sits under that email. The surveyor side stays as entered.
 */
import { correctionSubject, MISSING_EMAIL_BODY } from "./hhsrs-find.js";
import { formatHhsrsSurveyDate } from "./hhsrs-site-form.js";
import { escapeHtml, stripTrailingSignature } from "./hhsrs-signature.js";

export type ViewDetailsPhoto = { name: string; url: string };

export type ViewDetailsParty = { label: string; value: string };

/** Mailbox shown on a sent card. Display only; the send still uses its own From line. */
export const CORRECTION_FROM_ADDRESS = "hhsrs@savillshousing.co.uk";

/**
 * From, the To stored on that send, and Cc only when that send already has one.
 * A blank stored To stays blank. This does not look up a project client address.
 */
export function correctionParties(input: { to?: string | null; cc?: string | null }): ViewDetailsParty[] {
  const parties: ViewDetailsParty[] = [
    { label: "From", value: CORRECTION_FROM_ADDRESS },
    { label: "To", value: String(input.to || "").trim() },
  ];
  const cc = String(input.cc || "").trim();
  if (cc) parties.push({ label: "Cc", value: cc });
  return parties;
}

export type ViewDetailsEmail = {
  subject: string;
  copyHtml: string;
  photos: ViewDetailsPhoto[];
  parties: ViewDetailsParty[];
};

export type ViewDetailsModel = {
  projectName: string;
  address: string;
  uprn: string;
  surveyDate: string;
  surveyorName: string;
  hazard: string;
  rating: string;
  description: string;
  photos: ViewDetailsPhoto[];
  intro: string;
  sent: ViewDetailsEmail | null;
  corrections: ViewDetailsEmail[];
};

type SentLike = {
  kind?: string;
  subject: string;
  body: string;
  photoNames: readonly string[];
  to?: string;
  cc?: string;
};

export function surveyorAddress(fullAddress: string, postcode: string): string {
  const line = String(fullAddress || "").trim();
  const pc = String(postcode || "").trim();
  if (!pc) return line;
  if (line.toLowerCase().includes(pc.toLowerCase())) return line;
  return line ? `${line}, ${pc}` : pc;
}

export function shortStreet(address: string): string {
  return String(address || "").split(",")[0].trim();
}

export function viewDetailsIntro(projectName: string, address: string, sent: boolean, correctionCount: number): string {
  const street = shortStreet(address);
  const head = [String(projectName || "").trim(), street].filter(Boolean).join(" · ");
  const tail = sent
    ? correctionCount > 0
      ? "Original surveyor entry beside the email that was sent, with the correction underneath."
      : "Original surveyor entry beside the email that was sent."
    : "Original surveyor entry. Not sent from the portal.";
  return head ? `${head}. ${tail}` : tail;
}

function bulletKey(label: string): string {
  return label.trim().toLowerCase();
}

export function bulletValues(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of stripTrailingSignature(body).split("\n")) {
    const match = line.match(/^•\s*([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = bulletKey(match[1]);
    if (!map.has(key)) map.set(key, match[2].trim());
  }
  return map;
}

/** Labels whose value on the correction differs from the original email. */
export function changedBulletKeys(originalBody: string, correctionBody: string): Set<string> {
  const before = bulletValues(originalBody);
  const after = bulletValues(correctionBody);
  const changed = new Set<string>();
  for (const [key, value] of after) {
    if (before.get(key) !== value) changed.add(key);
  }
  return changed;
}

export function emailCopyHtml(body: string, changed: ReadonlySet<string> = new Set()): string {
  const text = stripTrailingSignature(body).trim();
  if (!text) return `<p>${escapeHtml(MISSING_EMAIL_BODY)}</p>`;
  const parts: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    parts.push(`<ul>${list.join("")}</ul>`);
    list = [];
  };
  for (const line of text.split("\n")) {
    const bullet = line.match(/^•\s*([^:]+):\s*(.*)$/);
    if (bullet) {
      const label = bullet[1].trim();
      const value = bullet[2].trim();
      const klass = changed.has(bulletKey(label)) ? ` class="changed"` : "";
      list.push(`<li${klass}>${escapeHtml(label)}: ${escapeHtml(value)}</li>`);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    parts.push(`<p>${escapeHtml(line)}</p>`);
  }
  flush();
  return parts.join("");
}

export function emailPhotoViews(
  submissionId: string,
  names: readonly string[],
  photoPaths: unknown,
  reporterBase: string
): ViewDetailsPhoto[] {
  const paths = Array.isArray(photoPaths) ? photoPaths.map((item) => String(item)) : [];
  const photos: ViewDetailsPhoto[] = [];
  for (const name of names) {
    const trimmed = String(name || "").trim();
    if (!trimmed) continue;
    const stored = paths.find((path) => path.split("/").filter(Boolean).pop() === trimmed);
    if (!stored) continue;
    photos.push({
      name: trimmed,
      url: `${reporterBase}/${encodeURIComponent(submissionId)}/photos/${encodeURIComponent(trimmed)}`,
    });
  }
  return photos;
}

export function buildViewDetails(input: {
  projectName: string;
  fullAddress: string;
  postcode: string;
  uprn: string;
  surveyDate: string;
  surveyorName: string;
  hazard: string;
  rating: string;
  description: string;
  submissionId: string;
  photoPaths: unknown;
  surveyorPhotos: readonly ViewDetailsPhoto[];
  emails: readonly SentLike[];
  reporterBase: string;
}): ViewDetailsModel {
  const address = surveyorAddress(input.fullAddress, input.postcode);
  const original = input.emails.find((email) => (email.kind || "original") !== "correction") || null;
  const corrections = input.emails.filter((email) => email.kind === "correction");
  const toEmail = (
    email: SentLike,
    changed: ReadonlySet<string>,
    subject: string,
    parties: ViewDetailsParty[]
  ): ViewDetailsEmail => ({
    subject,
    copyHtml: emailCopyHtml(email.body, changed),
    photos: emailPhotoViews(input.submissionId, email.photoNames, input.photoPaths, input.reporterBase),
    parties,
  });
  return {
    projectName: String(input.projectName || "").trim(),
    address,
    uprn: String(input.uprn || "").trim(),
    surveyDate: formatHhsrsSurveyDate(input.surveyDate),
    surveyorName: String(input.surveyorName || "").trim(),
    hazard: String(input.hazard || "").trim(),
    rating: String(input.rating || "").trim(),
    description: String(input.description || "").trim(),
    photos: [...input.surveyorPhotos],
    intro: viewDetailsIntro(input.projectName, address, Boolean(original), corrections.length),
    sent: original
      ? toEmail(
          original,
          new Set(),
          String(original.subject || "").trim(),
          correctionParties({ to: original.to, cc: original.cc })
        )
      : null,
    corrections: corrections.map((email) =>
      toEmail(
        email,
        changedBulletKeys(original?.body || "", email.body),
        correctionSubject(email.subject),
        correctionParties({ to: email.to, cc: email.cc })
      )
    ),
  };
}

/**
 * Savills HHSRS email signature.
 * The wording is fixed and has no personal name.
 * It ends at the print line. There is no NOTICE and no company-registration footer.
 * The logo is an inline image, not a case photo.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const SIGNATURE_EMAIL = "HHSRS@savillshousing.co.uk";
export const SIGNATURE_EMAIL_URL = "mailto:HHSRS@savillshousing.co.uk";
export const SIGNATURE_WEB = "www.savills.co.uk";
export const SIGNATURE_WEB_URL = "https://www.savills.co.uk";
export const SIGNATURE_TEAM = "HHSRS Reporting Team";
export const SIGNATURE_ADDRESS = "Savills, 33 Margaret Street, London, W1G 0JD";
export const SIGNATURE_LOGO_CID = "savills-logo@savillshousing.co.uk";
export const SIGNATURE_LOGO_FILENAME = "savills-logo.png";
/** Same square as the approved email crop. Do not stretch it. */
export const SIGNATURE_LOGO_PX = 53;
export const SIGNATURE_LOGO_PUBLIC_PATH = "/img/savills-logo.png";
/** Short, plain. Shown when the signed-in person has no name on file. */
export const MISSING_SENDER_NAME_WARNING = "No name found for the signature.";

const LEAF = "\u{1F33F}";
const PRINT_LINE = `${LEAF} Before printing, think about the environment`;

export type PersonnelName = {
  name?: string | null;
  email?: string | null;
};

export type SenderSignature = {
  firstName: string;
  fullName: string;
  missing: boolean;
};

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tidyName(value: string | null | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * The signature name comes from the signed-in login (first name and surname).
 * Personnel is the surveyor list, used only when that login has neither name.
 * Match a surveyor by email, the same case-insensitive way sign-in matches email.
 */
export function resolveSenderSignature(input: {
  firstName?: string | null;
  surname?: string | null;
  email?: string | null;
  personnel?: readonly PersonnelName[];
}): SenderSignature {
  const first = tidyName(input.firstName);
  const surname = tidyName(input.surname);
  if (first || surname) {
    const fullName = [first, surname].filter(Boolean).join(" ");
    return {
      firstName: first || fullName.split(" ")[0] || "",
      fullName,
      missing: false,
    };
  }
  const email = tidyName(input.email).toLowerCase();
  const hit = email
    ? (input.personnel || []).find((person) => tidyName(person.email).toLowerCase() === email)
    : undefined;
  const fromPersonnel = tidyName(hit?.name);
  if (!fromPersonnel) return { firstName: "", fullName: "", missing: true };
  return {
    firstName: fromPersonnel.split(" ")[0] || "",
    fullName: fromPersonnel,
    missing: false,
  };
}

/** Rebuild the on-screen signature from the name already stored on the send. */
export function signatureFromLoggedSender(sentBy: string | null | undefined): SenderSignature {
  const fullName = tidyName(sentBy);
  if (!fullName) return { firstName: "", fullName: "", missing: true };
  return { firstName: fullName.split(" ")[0] || "", fullName, missing: false };
}

function signatureLogoPath(): string {
  const candidates = [
    path.join(process.cwd(), "public/img/savills-logo.png"),
    path.join(process.cwd(), "dist/public/img/savills-logo.png"),
  ];
  const found = candidates.find((item) => existsSync(item));
  if (!found) throw new Error("Savills signature logo is missing.");
  return found;
}

let cachedLogo: Buffer | null = null;

export function signatureLogoBytes(): Buffer {
  if (!cachedLogo) cachedLogo = readFileSync(signatureLogoPath());
  return cachedLogo;
}

export function signatureLogoAttachment(): {
  filename: string;
  content: Buffer;
  contentType: "image/png";
  cid: string;
  contentDisposition: "inline";
} {
  return {
    filename: SIGNATURE_LOGO_FILENAME,
    content: signatureLogoBytes(),
    contentType: "image/png",
    cid: SIGNATURE_LOGO_CID,
    contentDisposition: "inline",
  };
}

export function renderSignatureText(_names: Pick<SenderSignature, "firstName" | "fullName">): string {
  const lines: string[] = [
    "Regards",
    "",
    SIGNATURE_TEAM,
    "",
    SIGNATURE_ADDRESS,
    "",
    `Email: ${SIGNATURE_EMAIL}`,
    `Website: ${SIGNATURE_WEB}`,
    "",
    PRINT_LINE,
  ];
  return lines.join("\n");
}

/** Clear space above Regards, in the on-screen preview and the sent email. */
const SIGN_OFF_GAP = "32px";

function signatureParagraph(text: string, marginBottom: string, marginTop = "0"): string {
  return `<p style="margin:${marginTop} 0 ${marginBottom};">${text}</p>`;
}

export function renderSignatureHtml(
  _names: Pick<SenderSignature, "firstName" | "fullName">,
  logoSrc: string
): string {
  const parts: string[] = [
    `<div class="hhsrs-signature" style="font-family:Calibri,Aptos,Arial,sans-serif;font-size:14.5px;line-height:1.45;color:#111111;">`,
    signatureParagraph("Regards", "16px", SIGN_OFF_GAP),
    signatureParagraph(SIGNATURE_TEAM, "16px"),
    signatureParagraph(escapeHtml(SIGNATURE_ADDRESS), "16px"),
    `<p style="margin:0 0 16px;"><img src="${escapeHtml(logoSrc)}" alt="Savills" width="${SIGNATURE_LOGO_PX}" height="${SIGNATURE_LOGO_PX}" style="width:${SIGNATURE_LOGO_PX}px;height:${SIGNATURE_LOGO_PX}px;object-fit:contain;border:0;display:block;" /></p>`,
  ];
  parts.push(
    `<p style="margin:0;">Email: <a href="${SIGNATURE_EMAIL_URL}" style="color:#2563eb;text-decoration:underline;">${SIGNATURE_EMAIL}</a></p>`
  );
  parts.push(
    `<p style="margin:0 0 16px;">Website: <a href="${SIGNATURE_WEB_URL}" style="color:#2563eb;text-decoration:underline;">${SIGNATURE_WEB}</a></p>`
  );
  parts.push(
    `<p style="margin:0;"><span style="color:#16a34a;font-size:14px;">${LEAF}</span> Before printing, think about the environment</p>`
  );
  parts.push(`</div>`);
  return parts.join("");
}

function plainToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n/g, "\n").replace(/\n/g, "<br>\n");
}

export type EmailCardPhoto = {
  src: string;
  name: string;
};

/** Content-ID for a case photo shown in the email body. Not the signature logo. */
export function inlinePhotoCid(index: number): string {
  return `hhsrs-photo-${index}@savillshousing.co.uk`;
}

/**
 * Drop a signature that was stored on an older send, so the card can add
 * the short live signature once, under the message.
 */
export function stripTrailingSignature(body: string): string {
  const text = String(body || "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const marker = "\n\nRegards\n\nHHSRS Reporting Team\n";
  const at = text.lastIndexOf(marker);
  if (at < 0) return text;
  const tail = text.slice(at);
  if (!tail.includes("Before printing, think about the environment")) return text;
  return text.slice(0, at).replace(/\s+$/, "");
}

/** Plain stored email text as paragraphs and bullets for the grey card. */
export function emailBodyToHtml(body: string): string {
  const text = stripTrailingSignature(body);
  if (!text.trim()) return "";
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
      list.push(`<li>${escapeHtml(bullet[1].trim())}: ${escapeHtml(bullet[2].trim())}</li>`);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    parts.push(`<p>${escapeHtml(line)}</p>`);
  }
  flush();
  return parts.join("");
}

function emailPhotoTable(photos: readonly EmailCardPhoto[]): string {
  if (!photos.length) return "";
  const cells = photos
    .map((photo) => {
      const src = escapeHtml(photo.src);
      return `<td style="padding:0 10px 0 0;vertical-align:top;"><img src="${src}" alt="" width="96" height="72" style="width:96px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #d5dee8;display:block;" /></td>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;border-collapse:collapse;"><tr>${cells}</tr></table>`;
}

export function composeEmailText(body: string, names: Pick<SenderSignature, "firstName" | "fullName">): string {
  const typed = String(body || "").replace(/\s+$/, "");
  const signature = renderSignatureText(names);
  // Two blank lines: the plain-text copy of the same gap above Regards.
  return typed ? `${typed}\n\n\n${signature}` : signature;
}

/**
 * Client email: the same grey card as Find and resend.
 * Photos are pictures under the signature, with no filename caption. The short signature has no personal name and no NOTICE.
 */
export function composeEmailHtml(
  body: string,
  names: Pick<SenderSignature, "firstName" | "fullName">,
  logoSrc: string,
  messageHtml?: string,
  options?: { subject?: string; photos?: readonly EmailCardPhoto[] }
): string {
  const typed = String(body || "").replace(/\s+$/, "");
  const inner = messageHtml !== undefined ? messageHtml : typed ? plainToHtml(typed) : "";
  const message = inner
    ? `<div style="font-family:Calibri,Aptos,Arial,sans-serif;font-size:14.5px;line-height:1.45;color:#111111;">${inner}</div>`
    : "";
  const subject = String(options?.subject || "").trim();
  // Outlook ignores font-weight on h1–h6. A <b> is what makes the subject bold in the client.
  const heading = subject
    ? `<h2 style="display:inline-block;margin:14px 16px;padding:8px 14px;border-radius:10px;font-size:16px;font-weight:800;letter-spacing:-0.02em;color:#0b1f33;background:#d0d8e6;border-bottom:1px solid #b8c2d4;border-left:5px solid #0b1f33;"><b style="font-weight:800;">${escapeHtml(subject)}</b></h2>`
    : "";
  const photos = emailPhotoTable(options?.photos || []);
  const card =
    `<div style="background:#e7edf3;padding:18px;">` +
    `<div style="background:#ffffff;border:1px solid #0b1f33;border-radius:12px;overflow:hidden;">` +
    heading +
    `<div style="margin:0 16px 16px;background:#f7f9fb;border:1px solid #d5dee8;border-radius:10px;padding:14px 16px;font-family:Calibri,Aptos,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0b1f33;">` +
    `${message}${renderSignatureHtml(names, logoSrc)}${photos}` +
    `</div></div></div>`;
  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">${card}</body></html>`;
}

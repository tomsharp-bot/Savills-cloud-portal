/**
 * Savills HHSRS email signature.
 * The wording is fixed and has no personal name.
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

/** Verbatim from the approved signature. Do not reword. */
export const SIGNATURE_LEGAL_PARAGRAPHS = [
  "NOTICE: This email is intended for the named recipient only. It may contain privileged and confidential information. If you are not the intended recipient, notify the sender immediately and destroy this email. You must not copy, distribute or take action in reliance upon it. Whilst all efforts are made to safeguard emails, the Savills Group cannot guarantee that attachments are virus free or compatible with your systems and does not accept liability in respect of viruses or computer problems experienced. The Savills Group reserves the right to monitor all email communications through its internal and external networks.",
  "For information on how Savills processes your personal data please see our privacy policy",
  "Savills plc. Registered in England No 2122174. Registered office: 33 Margaret Street, London, W1G 0JD.",
  "Savills plc is a holding company, subsidiaries of which are authorised and regulated by the Financial Conduct Authority (FCA)",
  "Savills (UK) Limited. A subsidiary of Savills plc. Registered in England No 2605138. Regulated by RICS. Registered office: 33 Margaret Street, London, W1G 0JD.",
  "Savills Advisory Services Limited. A subsidiary of Savills plc. Registered in England No 06215875. Regulated by RICS. Registered office: 33 Margaret Street, London, W1G 0JD.",
  "Savills Commercial Limited. A subsidiary of Savills plc. Registered in England No 2605125. Registered office: 33 Margaret Street, London, W1G 0JD.",
  "Savills Channel Islands Limited. A subsidiary of Savills plc. Registered in Guernsey No. 29285. Registered office: Royal Terrace, Glategny Esplanade, St Peter Port, Guernsey, GY1 2HN. Registered with the Guernsey Financial Services Commission. No. 86723.",
  "Martel Maides Limited (trading as Savills). A subsidiary of Savills plc. Registered in Guernsey No. 18682. Registered office: Royal Terrace, Glategny Esplanade, St Peter Port, Guernsey, GY1 2HN . Registered with the Guernsey Financial Services Commission. No. 57114.",
  "We are registered with the Scottish Letting Agent Register, our registration number is LARN1902057.",
  "Please note any advice contained or attached in this email is informal and given purely as guidance unless otherwise explicitly stated. Our views on price are not intended as a formal valuation and should not be relied upon as such. They are given in the course of our estate agency role. No liability is given to any third party and the figures suggested are in accordance with Professional Standards PS1 and PS2 of the RICS Valuation –Global Standards (incorporating the IVSC International Valuation Standards) effective from 31 January 2022 together, the ''Red Book'. Any advice attached is not a formal (\"Red Book\") valuation, and neither Savills nor the author can accept any responsibility to any third party who may seek to rely upon it, as a whole or any part as such. If formal advice is required this will be explicitly stated along with our understanding of limitations and purpose.",
  "BEWARE OF CYBER-CRIME: Our banking details will not change during the course of a transaction. Should you receive a notification which advises a change in our bank account details, it may be fraudulent and you should notify Savills who will advise you accordingly.",
] as const;

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
    `${LEAF} Before printing, think about the environment`,
    "",
    SIGNATURE_LEGAL_PARAGRAPHS.join("\n\n"),
  ];
  return lines.join("\n");
}

function signatureParagraph(text: string, marginBottom: string): string {
  return `<p style="margin:0 0 ${marginBottom};">${text}</p>`;
}

export function renderSignatureHtml(
  _names: Pick<SenderSignature, "firstName" | "fullName">,
  logoSrc: string
): string {
  const parts: string[] = [
    `<div class="hhsrs-signature" style="font-family:Calibri,Aptos,Arial,sans-serif;font-size:14.5px;line-height:1.45;color:#111111;">`,
    signatureParagraph("Regards", "16px"),
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
    `<p style="margin:0 0 16px;"><span style="color:#16a34a;font-size:14px;">${LEAF}</span> Before printing, think about the environment</p>`
  );
  parts.push(
    `<div style="font-size:12px;line-height:1.5;color:#222222;">${SIGNATURE_LEGAL_PARAGRAPHS.map((paragraph) => escapeHtml(paragraph)).join("<br>")}</div>`
  );
  parts.push(`</div>`);
  return parts.join("");
}

function plainToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n/g, "\n").replace(/\n/g, "<br>\n");
}

export function composeEmailText(body: string, names: Pick<SenderSignature, "firstName" | "fullName">): string {
  const typed = String(body || "").replace(/\s+$/, "");
  const signature = renderSignatureText(names);
  return typed ? `${typed}\n\n${signature}` : signature;
}

export function composeEmailHtml(
  body: string,
  names: Pick<SenderSignature, "firstName" | "fullName">,
  logoSrc: string,
  messageHtml?: string
): string {
  const typed = String(body || "").replace(/\s+$/, "");
  const inner = messageHtml !== undefined ? messageHtml : typed ? plainToHtml(typed) : "";
  const message = inner
    ? `<div style="font-family:Calibri,Aptos,Arial,sans-serif;font-size:14.5px;line-height:1.45;color:#111111;">${inner}</div>`
    : "";
  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">${message}${renderSignatureHtml(names, logoSrc)}</body></html>`;
}

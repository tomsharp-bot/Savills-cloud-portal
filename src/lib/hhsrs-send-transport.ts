/**
 * SMTP send and IMAP Sent-folder copy for the HHSRS mailbox.
 * The password is read from the environment at call time and is never logged or returned.
 * HHSRS_SEND_MOCK=1 uses a fake transport outside production so screenshots and local checks
 * do not contact GoDaddy. Production always uses the real servers.
 */
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { ImapFlow } from "imapflow";
import type { OutboundEmail } from "./hhsrs-send.js";

export type SentMessage = { messageId: string; raw: Buffer };

function smtpHost(): string {
  return (process.env.HHSRS_SMTP_HOST || "").trim() || "smtpout.secureserver.net";
}

function smtpPort(): number {
  const port = Number(process.env.HHSRS_SMTP_PORT || 465);
  return Number.isFinite(port) && port > 0 ? port : 465;
}

function imapHost(): string {
  return (process.env.HHSRS_IMAP_HOST || "").trim() || "imap.secureserver.net";
}

export function mockTransportEnabled(): boolean {
  return process.env.HHSRS_SEND_MOCK === "1" && process.env.NODE_ENV !== "production";
}

function mailboxPassword(): string {
  return process.env.HHSRS_SMTP_PASSWORD || "";
}

async function compileRaw(mail: OutboundEmail, keepBcc: boolean): Promise<Buffer> {
  const composer = new MailComposer({
    from: { name: mail.fromName, address: mail.fromAddress },
    to: mail.to,
    cc: mail.cc.length ? mail.cc : undefined,
    bcc: keepBcc && mail.bcc.length ? mail.bcc : undefined,
    subject: mail.subject,
    text: mail.text,
    messageId: mail.messageId,
    keepBcc,
    attachments: mail.attachments.map((file) => ({
      filename: file.filename,
      content: file.content,
      contentType: file.contentType,
    })),
  });
  return composer.compile().build();
}

export async function sendMailboxMessage(mail: OutboundEmail): Promise<SentMessage> {
  const rawForSent = await compileRaw(mail, true);
  if (mockTransportEnabled()) {
    return { messageId: mail.messageId, raw: rawForSent };
  }
  const password = mailboxPassword();
  if (!password) {
    throw new Error("SMTP password is not set");
  }
  const rawForDelivery = await compileRaw(mail, false);
  const transporter = nodemailer.createTransport({
    host: smtpHost(),
    port: smtpPort(),
    secure: true,
    auth: {
      user: mail.fromAddress,
      pass: password,
    },
  });
  try {
    const info = await transporter.sendMail({
      envelope: {
        from: mail.fromAddress,
        to: [...mail.to, ...mail.cc, ...mail.bcc],
      },
      raw: rawForDelivery,
    });
    return { messageId: info.messageId || mail.messageId, raw: rawForSent };
  } finally {
    transporter.close();
  }
}

export async function appendToSentFolder(raw: Buffer): Promise<void> {
  if (mockTransportEnabled()) return;
  const password = mailboxPassword();
  const user = (process.env.HHSRS_SMTP_USER || "").trim() || "hhsrs@savillshousing.co.uk";
  if (!password) {
    throw new Error("IMAP password is not set");
  }
  const client = new ImapFlow({
    host: imapHost(),
    port: 993,
    secure: true,
    auth: { user, pass: password },
    logger: false,
  });
  await client.connect();
  try {
    let mailbox = "Sent";
    const boxes = await client.list();
    const sent = boxes.find((box) => box.specialUse === "\\Sent") || boxes.find((box) => /sent/i.test(box.path));
    if (sent?.path) mailbox = sent.path;
    const appended = await client.append(mailbox, raw, ["\\Seen"]);
    if (!appended) throw new Error("IMAP append was refused");
  } finally {
    await client.logout().catch(() => undefined);
  }
}

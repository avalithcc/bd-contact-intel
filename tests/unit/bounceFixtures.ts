/**
 * Synthetic Gmail API payloads for delivery status notifications. Shapes follow what `users.messages.get`
 * (format=full) returns for the real senders (Gmail, Exchange, Postfix); every address is invented.
 */
import type { GmailApiMessage, GmailApiMessagePart } from "@/lib/gmail/parseMessage";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const text = (body: string): GmailApiMessagePart => ({ mimeType: "text/plain", body: { data: b64(body) } });

/** The delivery-status part as Gmail serves it: the per-recipient fields arrive as headers of child parts. */
const statusAsHeaders = (blocks: Record<string, string>[]): GmailApiMessagePart => ({
  mimeType: "message/delivery-status",
  parts: blocks.map((b) => ({ mimeType: "message/delivery-status", headers: Object.entries(b).map(([name, value]) => ({ name, value })) })),
});

/** The same part carrying the RFC 3464 text in its body (what a plain MIME decoder yields). */
const statusAsText = (blocks: Record<string, string>[]): GmailApiMessagePart => ({
  mimeType: "message/delivery-status",
  body: { data: b64(blocks.map((b) => Object.entries(b).map(([k, v]) => `${k}: ${v}`).join("\n")).join("\n\n")) },
});

const original = (messageId: string, subject: string): GmailApiMessagePart => ({
  mimeType: "message/rfc822",
  headers: [
    { name: "Message-ID", value: messageId },
    { name: "Subject", value: subject },
  ],
});

export interface DsnOptions {
  id?: string;
  threadId?: string;
  from?: string;
  subject?: string;
  extraHeaders?: Record<string, string>;
  parts: GmailApiMessagePart[];
  mimeType?: string;
}

export function dsn(o: DsnOptions): GmailApiMessage {
  const headers = [
    { name: "From", value: o.from ?? "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
    { name: "To", value: "bd@avalith.test" },
    { name: "Subject", value: o.subject ?? "Delivery Status Notification (Failure)" },
    ...Object.entries(o.extraHeaders ?? {}).map(([name, value]) => ({ name, value })),
  ];
  return { id: o.id ?? "dsn-1", threadId: o.threadId ?? "thread-out-1", internalDate: "1792000000000", payload: { mimeType: o.mimeType ?? "multipart/report", headers, parts: o.parts } };
}

export const ORIGINAL_ID = "<CAorig1@mail.gmail.com>";
export const ORIGINAL_SUBJECT = "Squads nearshore para Acme";

export interface DsnVariant {
  id?: string;
  threadId?: string;
  address?: string;
  originalId?: string;
}

export const gmailHard511 = (v: DsnVariant = {}) => {
  const address = v.address ?? "lucia@acme-ejemplo.test";
  const originalId = v.originalId ?? ORIGINAL_ID;
  return dsn({
    id: v.id,
    threadId: v.threadId,
    extraHeaders: { "In-Reply-To": originalId, References: originalId },
    parts: [
      text(`Address not found. Your message wasn't delivered to ${address} because the address couldn't be found.`),
      statusAsHeaders([
        { "Reporting-MTA": "dns; googlemail.com" },
        { "Final-Recipient": `rfc822; ${address}`, Action: "failed", Status: "5.1.1", "Diagnostic-Code": "smtp; 550-5.1.1 The email account that you tried to reach does not exist." },
      ]),
      original(originalId, ORIGINAL_SUBJECT),
    ],
  });
};

export const gmailDelay422 = (v: DsnVariant = {}) => {
  const address = v.address ?? "lucia@acme-ejemplo.test";
  const originalId = v.originalId ?? ORIGINAL_ID;
  return dsn({
    id: v.id ?? "dsn-2",
    threadId: v.threadId,
    subject: "Delivery Status Notification (Delay)",
    extraHeaders: { "In-Reply-To": originalId },
    parts: [
      text("Delivery incomplete. Gmail will keep trying."),
      statusAsHeaders([{ "Final-Recipient": `rfc822; ${address}`, Action: "delayed", Status: "4.2.2", "Diagnostic-Code": "smtp; 452 4.2.2 mailbox full" }]),
      original(originalId, ORIGINAL_SUBJECT),
    ],
  });
};

export const exchangeNdr = () =>
  dsn({
    id: "dsn-3",
    from: "postmaster@contoso-ejemplo.onmicrosoft.test",
    subject: "Undeliverable: Squads nearshore para Acme",
    parts: [
      text("Your message to jane@contoso-ejemplo.test couldn't be delivered."),
      statusAsText([
        { "Reporting-MTA": "dns;contoso-ejemplo.test" },
        { "Final-Recipient": "rfc822;jane@contoso-ejemplo.test", "Original-Recipient": "rfc822;jane.doe@contoso-ejemplo.test", Action: "failed", Status: "5.1.10", "Diagnostic-Code": "smtp;550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup" },
      ]),
      { mimeType: "text/rfc822-headers", body: { data: b64(`Message-ID: ${ORIGINAL_ID}\nSubject: ${ORIGINAL_SUBJECT}\nTo: jane@contoso-ejemplo.test\n`) } },
    ],
  });

/** Postfix with no delivery-status part at all: only the X-Failed-Recipients header and the text. */
export const postfixTextOnly = () =>
  dsn({
    id: "dsn-4",
    from: "Mail Delivery System <MAILER-DAEMON@mx.example.test>",
    subject: "Mail delivery failed: returning message to sender",
    mimeType: "text/plain",
    extraHeaders: { "X-Failed-Recipients": "bob@viejo-ejemplo.test", "In-Reply-To": ORIGINAL_ID },
    parts: [],
  });

export const postfixTextBody = (): GmailApiMessage => {
  const m = postfixTextOnly();
  m.payload = { ...m.payload!, body: { data: b64("This is the mail system.\n\n<bob@viejo-ejemplo.test>: host mx.viejo-ejemplo.test said: 550 5.1.1 <bob@viejo-ejemplo.test>: Recipient address rejected: User unknown") } };
  return m;
};

export const outOfOffice = (): GmailApiMessage => ({
  id: "ooo-1",
  threadId: "thread-out-1",
  internalDate: "1792000000000",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Lucia <lucia@acme-ejemplo.test>" },
      { name: "Subject", value: "Automatic reply: Squads nearshore para Acme" },
      { name: "Auto-Submitted", value: "auto-replied" },
    ],
    body: { data: b64("I am out of office until Monday.") },
  },
});

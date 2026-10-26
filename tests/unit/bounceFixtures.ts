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

/** A Gmail-style failure notification with a chosen status, action and diagnostic (severity and sanitising cases). */
export const failedWith = (status: string, diagnostic: string, o: { action?: string; subject?: string; internalDate?: string; from?: string; extraHeaders?: Record<string, string> } = {}): GmailApiMessage => {
  const m = dsn({
    from: o.from,
    extraHeaders: { "In-Reply-To": ORIGINAL_ID, ...o.extraHeaders },
    parts: [
      text("Delivery failed."),
      statusAsHeaders([{ "Final-Recipient": "rfc822; lucia@acme-ejemplo.test", Action: o.action ?? "failed", Status: status, "Diagnostic-Code": `smtp; ${diagnostic}` }]),
      original(ORIGINAL_ID, o.subject ?? ORIGINAL_SUBJECT),
    ],
  });
  if (o.internalDate !== undefined) m.internalDate = o.internalDate;
  return m;
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

// --- REAL production input -------------------------------------------------------------------------------------------
/**
 * Built from a REAL production delivery notification: Gmail message id 1a16a2f1d04e80d7, received 2026-10-23. Production
 * bug: parseBounce returned null for it and no email_bounced activity was ever written.
 *
 * Headers, the Spanish text/plain part, the two RFC 3464 blocks and the embedded original's headers are byte-for-byte the
 * ones Gmail returned. Dropped on purpose: the ARC/DKIM headers and the icon.png part (no code path under test reads
 * them). ONE deliberate change: the failed recipient and its domain/MX host are replaced by invented ones (the original
 * is a third party's personal address, which does not belong in git); every occurrence goes through PROD_DSN_ADDRESS.
 *
 * Gmail serves a non-text part either with its body inline or as an attachment (`body: { size }`, a single Content-Type
 * header, no `data`). Which one it does for message/delivery-status is not known, so three shapes are built:
 *  - "inline":     the report is the part's own body.
 *  - "attachment": the part carries its MIME header and no data (the report is not visible at all).
 *  - "children":   the part has no body and the RFC 3464 groups are text/plain CHILD parts. This is the shape the production
 *                  payload is BELIEVED to take: the Gmail MCP's plaintext rendering of the message ends with the Final-Recipient
 *                  / Action / Status / Diagnostic-Code lines glued onto the text body, which only fits report text sitting in
 *                  text/plain parts. Inferred from that flattening, NOT observed in the raw format=full JSON.
 */
export const PROD_DSN_ADDRESS = "buzon.muerto@acme-ejemplo.test";
export const PROD_DSN_ORIGINAL_ID = "<CAAtF1PV4rqjJd7Y7US8Wg5i5a3xE48s5g3ZZxk4dE4EdMtrSrg@mail.gmail.com>";

const PROD_DSN_PLAIN = `
** No se ha encontrado la dirección **

Tu mensaje no se ha entregado a ${PROD_DSN_ADDRESS} porque no se ha encontrado la dirección o esta no puede recibir correo.



Esta es la respuesta del servidor remoto:
550 5.1.1 User Unknown
`;

export const PROD_DSN_STATUS = `Reporting-MTA: dns; googlemail.com
Arrival-Date: Fri, 23 Oct 2026 12:13:53 -0700 (PDT)
X-Original-Message-ID: ${PROD_DSN_ORIGINAL_ID}

Final-Recipient: rfc822; ${PROD_DSN_ADDRESS}
Action: failed
Status: 5.1.1
Remote-MTA: dns; mx-ejemplo.acme-ejemplo.test. (192.0.2.24, the server
 for the domain acme-ejemplo.test.)
Diagnostic-Code: smtp; 550 5.1.1 User Unknown
Last-Attempt-Date: Fri, 23 Oct 2026 12:13:54 -0700 (PDT)
`;

const PROD_DSN_ORIGINAL_HEADERS = `From: cristian@avalith.net
MIME-Version: 1.0
Date: Fri, 23 Oct 2026 19:13:51 +0000
Message-ID: ${PROD_DSN_ORIGINAL_ID}
Subject: =?UTF-8?Q?Capacidad_de_ingenier=C3=ADa_senior_para_Avalith?=
To: ${PROD_DSN_ADDRESS}
`;

/** The DSN's own text with a relayed (not failed) report in place of the failure: same message, opposite verdict. */
const PROD_DSN_RELAYED_STATUS = PROD_DSN_STATUS.replace("Action: failed", "Action: relayed").replace("Status: 5.1.1", "Status: 2.0.0");

export type ProdDsnShape = "inline" | "attachment" | "children";

export function prodDsn(shape: ProdDsnShape, o: { statusText?: string } = {}): GmailApiMessage {
  const statusText = o.statusText ?? PROD_DSN_STATUS;
  const statusPart: GmailApiMessagePart =
    shape === "inline"
      ? { mimeType: "message/delivery-status", body: { data: b64(statusText) } }
      : shape === "children"
        ? { mimeType: "message/delivery-status", headers: [{ name: "Content-Type", value: "message/delivery-status" }], parts: statusText.split(/\n\s*\n/).map((group) => text(group)) }
        : { mimeType: "message/delivery-status", headers: [{ name: "Content-Type", value: "message/delivery-status" }], body: { size: statusText.length } };
  return {
    id: "1a16a2f1d04e80d7",
    threadId: "1a16a2f10994ecf0",
    internalDate: "1792782834000",
    payload: {
      mimeType: "multipart/report",
      headers: [
        { name: "Content-Type", value: 'multipart/report; boundary="000000000000006f423065e86c897"; report-type=delivery-status' },
        { name: "To", value: "cristian@avalith.net" },
        { name: "Return-Path", value: "<>" },
        { name: "Auto-Submitted", value: "auto-replied" },
        { name: "Message-ID", value: "<6adbb1f2.702a7cd1.233c52.07dc.GMR@mx.google.com>" },
        { name: "Date", value: "Fri, 23 Oct 2026 12:13:54 -0700 (PDT)" },
        { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
        { name: "Subject", value: "Delivery Status Notification (Failure)" },
        { name: "References", value: PROD_DSN_ORIGINAL_ID },
        { name: "In-Reply-To", value: PROD_DSN_ORIGINAL_ID },
        { name: "X-Failed-Recipients", value: PROD_DSN_ADDRESS },
      ],
      parts: [
        {
          mimeType: "multipart/related",
          parts: [{ mimeType: "multipart/alternative", parts: [text(PROD_DSN_PLAIN), { mimeType: "text/html", body: { data: b64("<html><body>550 5.1.1 User Unknown</body></html>") } }] }],
        },
        statusPart,
        { mimeType: "text/rfc822-headers", body: { data: b64(PROD_DSN_ORIGINAL_HEADERS) } },
      ],
    },
  };
}

/** The same notification with an inline report that says the mail was relayed: a real report with no failed recipient. */
export const prodDsnRelayed = (shape: ProdDsnShape = "inline") => prodDsn(shape, { statusText: PROD_DSN_RELAYED_STATUS });

/**
 * A structured report that DIFFERS from the human text and from X-Failed-Recipients (an Original-Recipient alias and a
 * 5.1.2 status where the prose says 5.1.1): an assertion on it can only pass if the report itself was parsed.
 */
export const PROD_DSN_ALIAS = "alias.original@acme-ejemplo.test";
export const prodDsnStructuredDiffers = (shape: ProdDsnShape) =>
  prodDsn(shape, {
    statusText: PROD_DSN_STATUS.replace(`Final-Recipient: rfc822; ${PROD_DSN_ADDRESS}`, `Final-Recipient: rfc822; ${PROD_DSN_ADDRESS}\nOriginal-Recipient: rfc822; ${PROD_DSN_ALIAS}`).replace("Status: 5.1.1", "Status: 5.1.2"),
  });

/** Replaces the human text/plain part and the X-Failed-Recipients header of a prodDsn message (null removes the header). */
export function withProse(m: GmailApiMessage, prose: string, failedRecipients: string | null): GmailApiMessage {
  const plain = m.payload!.parts![0]!.parts![0]!.parts![0]!;
  plain.body = { data: b64(prose) };
  m.payload!.headers = m.payload!.headers!.filter((h) => h.name !== "X-Failed-Recipients");
  if (failedRecipients !== null) m.payload!.headers.push({ name: "X-Failed-Recipients", value: failedRecipients });
  return m;
}

/** A delivery-status part carrying its report BOTH as its own body and as text/plain children (body first, see parseBounce). */
export function prodDsnBodyAndChildren(bodyText: string, childText: string): GmailApiMessage {
  const m = prodDsn("inline", { statusText: bodyText });
  m.payload!.parts![1]!.parts = [text(childText)];
  return m;
}

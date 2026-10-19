import { GmailSendError } from "@/lib/gmail/errors";

/**
 * Header lines of one attachment part. Pure; the base64 body is added by rawMessage.ts (which owns the wrapping).
 *
 * The name travels twice, as mail clients expect: an ASCII `filename="..."` fallback and the RFC 2231 `filename*=UTF-8''...`
 * form that carries the real (possibly non-ASCII) name. The name is untrusted text, so CR/LF/NUL is rejected rather than
 * stripped (same rule as every other unencoded header value).
 */
export interface MimeAttachment {
  filename: string;
  contentType: string;
  data: Uint8Array;
}

// RFC 5987 attr-char: everything else is percent-encoded byte by byte.
const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

export function encodeRfc2231(value: string): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && ATTR_CHAR.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** What a client without RFC 2231 support shows: ASCII only, nothing that could end the quoted-string. */
function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/g, "_");
}

const MAX_ENCODED_NAME = 600; // keeps every header line far below the 998-character limit

/** Drops stem characters (never the extension) until the percent-encoded form fits. */
function fitName(name: string): string {
  let current = name;
  while (encodeRfc2231(current).length > MAX_ENCODED_NAME) {
    const dot = current.lastIndexOf(".");
    const ext = dot > 0 ? current.slice(dot) : "";
    const stem = Array.from(dot > 0 ? current.slice(0, dot) : current);
    stem.pop();
    current = stem.join("") + ext;
  }
  return current;
}

export function attachmentHeaders(att: MimeAttachment): string[] {
  if (/[\r\n\0]/.test(att.filename) || /[\r\n\0]/.test(att.contentType)) {
    throw new GmailSendError("invalid_header", "An attachment name or type contains a control character (CR, LF or NUL)", "Attachment");
  }
  const name = fitName(att.filename);
  const fallback = asciiFallback(name);
  const star = `UTF-8''${encodeRfc2231(name)}`;
  return [
    `Content-Type: ${att.contentType}; name="${fallback}";`,
    ` name*=${star}`,
    `Content-Disposition: attachment;`,
    ` filename="${fallback}";`,
    ` filename*=${star}`,
    "Content-Transfer-Encoding: base64",
  ];
}

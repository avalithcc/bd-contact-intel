/**
 * Content sniffing for email attachments. The extension and the browser's declared type are both attacker-controlled, so
 * at send time the server also checks the first bytes of the real file. Pure.
 */
export type MagicKind = "pdf" | "png" | "jpg" | "zip" | "ole" | "text";

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  bytes.length >= at + signature.length && signature.every((b, i) => bytes[at + i] === b);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPG = [0xff, 0xd8, 0xff] as const;
const ZIP = [0x50, 0x4b, 0x03, 0x04] as const;
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // "%PDF-"

/** PDF readers accept the header anywhere in the first KiB. */
function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024) - PDF.length;
  for (let i = 0; i <= limit; i++) if (startsWith(bytes, PDF, i)) return true;
  return false;
}

/** Plain text never carries NUL bytes; a binary renamed to .txt/.csv does. */
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const head = bytes.subarray(0, 8192);
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return false;
  return true;
}

export function matchesMagic(kind: MagicKind, bytes: Uint8Array): boolean {
  switch (kind) {
    case "pdf":
      return hasPdfHeader(bytes);
    case "png":
      return startsWith(bytes, PNG);
    case "jpg":
      return startsWith(bytes, JPG);
    case "zip":
      return startsWith(bytes, ZIP);
    case "ole":
      return startsWith(bytes, OLE);
    case "text":
      return looksLikeText(bytes);
  }
}

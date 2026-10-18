/**
 * RFC 2047 encoded-words for the Subject header. Pure.
 *
 * One encoded-word may be at most 75 characters: `=?UTF-8?B?` + base64 + `?=` leaves 63 for the base64, i.e. 15
 * quanta of 4 = 45 payload bytes. Words are cut on code-point boundaries (never inside a multibyte sequence or a
 * surrogate pair), so each word decodes on its own, as §2 requires.
 */
const MAX_WORD_BYTES = 45;
const MAX_INLINE_LINE = 78;
const PREFIX = "Subject:";

const word = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

export function encodeSubjectWords(subject: string): string[] {
  const words: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const ch of subject) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > MAX_WORD_BYTES) {
      words.push(word(chunk));
      chunk = "";
      bytes = 0;
    }
    chunk += ch;
    bytes += size;
  }
  words.push(word(chunk));
  return words;
}

/**
 * The complete Subject header (lines joined with CRLF). A subject that fits stays on the `Subject:` line exactly as
 * before; otherwise every word goes on its own folded line (CRLF + space), which the receiver unfolds and decodes
 * word by word.
 */
export function foldSubjectHeader(subject: string): string {
  const words = encodeSubjectWords(subject);
  if (words.length === 1 && PREFIX.length + 1 + words[0].length <= MAX_INLINE_LINE) return `${PREFIX} ${words[0]}`;
  return [PREFIX, ...words.map((w) => ` ${w}`)].join("\r\n");
}

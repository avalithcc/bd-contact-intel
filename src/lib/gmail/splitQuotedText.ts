/**
 * Splits a synced message's plain-text body into the reply itself and the
 * quoted thread history Gmail appends below it — the "Mostrar/Ocultar texto
 * citado" toggle (email-sync.html:167-169; README decision 7). Pure, no I/O.
 *
 * Recognizes Gmail's own quote-header line ("El ... escribió:" / "On ...
 * wrote:") in either language this app ships copy for, plus the classic
 * Outlook "-----Original Message-----"/"________" separators. When none of
 * those appear (a body someone quoted with bare "> " lines and no header,
 * or a forwarded plain-text client), falls back to the first "> "-prefixed
 * line. A body with no quote marker at all returns `quoted: null` — the
 * toggle is never rendered for it.
 */
export interface SplitQuotedTextResult {
  main: string;
  quoted: string | null;
}

const HEADER_PATTERNS = [/^el .+ escribi[oó]:$/i, /^on .+ wrote:$/i, /^-{2,}\s*original message\s*-{2,}$/i, /^_{5,}$/];

export function splitQuotedText(bodyText: string): SplitQuotedTextResult {
  const trimmedBody = bodyText.trim();
  if (!trimmedBody) return { main: "", quoted: null };

  const lines = bodyText.split("\n");
  let splitIndex = lines.findIndex((line) => HEADER_PATTERNS.some((re) => re.test(line.trim())));
  if (splitIndex === -1) {
    splitIndex = lines.findIndex((line) => line.trim().startsWith(">"));
  }
  if (splitIndex === -1) return { main: trimmedBody, quoted: null };

  const main = lines.slice(0, splitIndex).join("\n").trim();
  const quoted = lines.slice(splitIndex).join("\n").trim();
  if (!quoted) return { main: trimmedBody, quoted: null };
  return { main, quoted };
}

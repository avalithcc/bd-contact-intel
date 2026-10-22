/**
 * Advisory opt-out detection (outreach-sequences task 10.7). ADVISORY ONLY: this returns a hint that the UI may turn
 * into a "No contactar?" prompt next to a reply. It must NEVER suppress, discard or change anything by itself: a
 * phrase in a human reply is not a CAN-SPAM request until a BD confirms it ("remove me from the thread" is not
 * "remove me from your list"), and acting on a guess would silence a person who wanted to talk. The module has no
 * database access on purpose; the only write path is recordOptOut (optOutQueries.ts), triggered by a BD.
 *
 * LEANS TOWARD DETECTING, on purpose. A false negative is a missed opt-out, a compliance problem; a false positive is
 * a noisy prompt a BD dismisses. So every step below removes text only when it is sure it is not the person's own, and
 * a doubtful line is kept. Do not "tighten" this the other way.
 *
 * What is removed before matching, in order of how sure we are:
 *  1. PRIMARY: our own known text. Our footer says 'reply with "unsubscribe"', so any reply quoting our mail contains
 *     the word. The footer sentences (every language) and the unsubscribe link are deleted by CONTENT, after whitespace is
 *     collapsed, so a quote with no marker at all, or one a mail client re-wrapped, cannot raise a prompt.
 *  2. Lines prefixed ">" (a quote by definition) and the one-line attributions "On ... wrote:" / "El ... escribió:".
 *     Only those lines go: a reply written BELOW a Gmail-style quote is kept.
 *  3. Outlook-style quotes cut everything below: a "-----Original Message-----" / "-----Mensaje original-----" divider,
 *     a long underscore rule, or a From:/De: line that is preceded by a blank line AND followed by a second header
 *     line (Sent/Enviado/Date/Fecha/To/Para/Subject/Asunto). A body line that merely starts "From: ..." is therefore
 *     not a boundary. Cost accepted: an Outlook reply interleaved inside its own quote loses the part under the cut.
 */
import { ALL_OPT_OUT_TEXTS } from "./config";

/**
 * Matched against FOLDED text (lowercase-insensitive, accents removed: see `fold`), so every Spanish pattern below is
 * written without accents and covers both spellings ("quítame" / "quitame", "suscripción" / "suscripcion").
 *
 * `baja` is a very common Spanish word ("de baja calidad", "está de baja"), so the bare pattern is noisy. That is an
 * OWNER DECISION, taken knowingly: our Spanish footer tells people to reply with the word "baja", so the detector has to
 * recognise it, and this module is ADVISORY ONLY (it never suppresses anything, it only offers a BD a prompt) with a
 * documented preference for a false positive over a missed opt-out. Do NOT tighten it the other way.
 */
const PHRASES = [
  { phrase: "unsubscribe", pattern: /\bunsubscribe\b/i },
  { phrase: "remove me", pattern: /\bremove\s+me\b/i },
  { phrase: "stop emailing", pattern: /\bstop\s+(e-?mailing|sending\s+(me\s+)?e-?mails?)\b/i },
  { phrase: "no more emails", pattern: /\bno\s+more\s+e-?mails?\b/i },
  { phrase: "dar de baja", pattern: /\b(dar(me|se|nos)?|dame|denme|den)\s+de\s+baja\b/i },
  { phrase: "desuscribir", pattern: /\bdes-?s?uscri(b|p)\w*/i },
  { phrase: "cancelar suscripcion", pattern: /\bcancel\w*\s+(mi\s+|la\s+|esta\s+)?suscripcion\b/i },
  { phrase: "no me escribas mas", pattern: /\bno\s+(me\s+)?(escrib|envi|mand|contact)\w*\s+(mas|nunca)\b/i },
  { phrase: "no quiero recibir", pattern: /\bno\s+(quiero|deseo|quisiera)\s+(seguir\s+|volver\s+a\s+)?recibir\b/i },
  { phrase: "quitame de", pattern: /\b(quit|sac|saqu|elimin|borr)(a|e|en)(me|nos)\s+de\b/i },
  { phrase: "borrar mis datos", pattern: /\b(borr|elimin)\w*\s+(todos\s+)?(mis|mi)\s+(datos|informacion|cuenta)\b/i },
  { phrase: "baja", pattern: /\bbaja\b/i },
] as const;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** Accents removed ("más" -> "mas"), so people who type without accents and people who type with them match alike. */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// EVERY configured sentence in EVERY language, not one address's: a Spanish reply quoting our Spanish footer says "baja".
const KNOWN_FOOTER_TEXT = ALL_OPT_OUT_TEXTS.map((text) => fold(squash(text)));
const UNSUBSCRIBE_URL = /https?:\/\/\S*\/api\/unsubscribe\S*/gi;

const DIVIDER = /^\s*(-{2,}\s*(original message|mensaje original|forwarded message|mensaje reenviado)\s*-{2,}|_{5,}\s*)$/i;
const ATTRIBUTION = /^\s*(on|el)\s.+\b(wrote|escribi[oó]|ha escrito):\s*$/i;
const HEADER_START = /^\s*(from|de):\s/i;
const HEADER_NEXT = /^\s*(sent|enviado|date|fecha|to|para|subject|asunto)(\s+el)?:\s/i;

function isOutlookBoundary(lines: readonly string[], i: number): boolean {
  const line = lines[i]!;
  if (DIVIDER.test(line)) return true;
  if (!HEADER_START.test(line) || (lines[i - 1] ?? "x").trim() !== "") return false;
  return HEADER_NEXT.test(lines[i + 1] ?? "");
}

function ownText(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isOutlookBoundary(lines, i)) break;
    const line = lines[i]!;
    if (!line.trimStart().startsWith(">") && !ATTRIBUTION.test(line)) kept.push(line);
  }
  return kept.join("\n");
}

/** The first advisory phrase found in what the person wrote, or null. */
export function detectOptOutPhrase(body: string | null | undefined): string | null {
  if (!body) return null;
  let text = fold(squash(ownText(body))).replace(UNSUBSCRIBE_URL, " ");
  for (const known of KNOWN_FOOTER_TEXT) text = text.split(known).join(" ");
  return PHRASES.find((p) => p.pattern.test(text))?.phrase ?? null;
}

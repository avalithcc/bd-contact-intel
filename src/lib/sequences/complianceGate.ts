/**
 * The ONE pre-send compliance predicate. The runner's re-check (preSendChecks) and the approval gate (approvalQueries) both
 * ask it, so what is refused at release is exactly what is refused at approval: a second hand-written copy could drift.
 * Pure, no I/O. The reason codes are the hold reasons, so the BD reads the same words in both places.
 *
 *  - `unmapped_market`: no address (the recipient has no audience) or an address the config does not carry. No default exists.
 *  - `missing_footer`: the body does not carry THIS address's footer, or the per-recipient unsubscribe link is gone.
 *  - `wrong_language`: the draft was written in another language than the one we would write in today (languageMismatch.ts).
 *    Judged only when the caller passes both languages; an unknown draft language is never refused.
 */
import type { AudienceLanguage, ComplianceAddress } from "./complianceAudience";
import { bodyHasFooter } from "./complianceFooter";
import type { ComplianceConfig } from "./config";
import { languageMismatch } from "./languageMismatch";

export type ComplianceRefusal = "unmapped_market" | "missing_footer" | "wrong_language";

const UNSUBSCRIBE_LINK = /https:\/\/[^\s<>,"]+\/api\/unsubscribe\?t=[A-Za-z0-9_-]{43}/;

/** The per-recipient link the footer producer wrote into the body; null when the BD edited it away. */
export function extractUnsubscribeUrl(body: string): string | null {
  return body.match(UNSUBSCRIBE_LINK)?.[0] ?? null;
}

export function complianceRefusal(address: ComplianceAddress | null, body: string, config: ComplianceConfig, language?: { draft: unknown; today: AudienceLanguage | null }): ComplianceRefusal | null {
  if (!address || !Object.hasOwn(config, address)) return "unmapped_market";
  if (!bodyHasFooter(body, config, address) || !extractUnsubscribeUrl(body)) return "missing_footer";
  return language && languageMismatch(language.draft, language.today) ? "wrong_language" : null;
}

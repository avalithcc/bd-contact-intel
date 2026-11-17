/** Content checks that run at approval time. Pure. */
import { bannedTermsInBody } from "@/lib/outreach/subjectRules";
import { splitFooter } from "./complianceFooter";
import type { ComplianceConfig } from "./config";

export type SubjectCheck = { ok: true } | { ok: false; reason: "reply_prefix_subject"; explanation: string };

// A cold step 1 that opens with "Re:" or "Fwd:" fakes an existing conversation; it must never be approved.
const FAKE_THREAD_PREFIX = /^\s*(re|fwd?)\s*:/i;

export function checkStep1Subject(subject: string): SubjectCheck {
  if (!FAKE_THREAD_PREFIX.test(subject)) return { ok: true };
  return {
    ok: false,
    reason: "reply_prefix_subject",
    explanation: 'A first email cannot start with "Re:" or "Fwd:" because it pretends to continue a conversation that never happened. Rewrite the subject.',
  };
}

/**
 * The refusal for a body carrying banned vendor vocabulary. The reason carries the offending terms after the colon so the
 * one string that already travels to the screen (reasonText) can name them; the dictionary entry is keyed by the prefix.
 */
export const BANNED_VOCABULARY_KEY = "banned_vocabulary";
export type BannedVocabularyReason = `${typeof BANNED_VOCABULARY_KEY}:${string}`;
export const bannedVocabularyReason = (terms: readonly string[]): BannedVocabularyReason => `${BANNED_VOCABULARY_KEY}:${terms.join(", ")}`;
/** The terms named in a reason built by bannedVocabularyReason; null for any other reason. */
export const parseBannedVocabularyReason = (reason: string): string | null => (reason.startsWith(`${BANNED_VOCABULARY_KEY}:`) ? reason.slice(BANNED_VOCABULARY_KEY.length + 1) : null);

export type BodyCheck = { ok: true } | { ok: false; reason: BannedVocabularyReason; terms: string[] };

/**
 * Step 1 and step 2 alike: a reminder inherits its subject but has its own body. The compliance footer is cut off with the
 * one splitter the system already has (it legitimately holds an address and opt-out text); a body with no footer is checked
 * whole, and is refused for the missing footer anyway.
 */
export function checkBodyVocabulary(body: string, config: ComplianceConfig): BodyCheck {
  const message = splitFooter(body, config)?.message ?? body;
  const terms = bannedTermsInBody(message);
  return terms.length ? { ok: false, reason: bannedVocabularyReason(terms), terms } : { ok: true };
}

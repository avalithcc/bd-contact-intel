import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { contact } from "@/db/schema";
import { companyKeyFilter } from "@/lib/queries";
import {
  detectPattern,
  detectDomain,
  buildEmail,
  DEFAULT_PATTERN_ID,
  type PatternId,
} from "@/lib/emailPatterns";
import { isDeadDomain, type MailProvider, type LookupStatus } from "@/lib/emailDomain";
import { getDomainCheck } from "@/lib/domainCheckCache";
import { guessCompanyDomain } from "@/lib/companyDomain";

// Cap on how many colleague samples we pull to infer a company's email
// convention. A BD's contacts at one company can occasionally run into the
// hundreds; 200 is comfortably enough evidence for a majority pattern
// without letting one huge company dominate a single query's cost.
const SAMPLE_CAP = 200;

// Confidence thresholds. Both require a CONFIRMED receiving domain (hasMx),
// since a domain that can't be confirmed to receive mail at all can never
// be more than "low" regardless of how many colleagues agreed on the
// pattern. Above that, more agreeing colleague samples = more confidence
// the pattern is a real company convention rather than coincidence.
const HIGH_CONFIDENCE_MIN_AGREE = 5;
const MEDIUM_CONFIDENCE_MIN_AGREE = 3;

export type SuggestionConfidence = "high" | "medium" | "low";

export interface EmailSuggestion {
  email: string;
  patternId: PatternId;
  domain: string;
  sampleCount: number;
  // Number of colleague samples that back this suggestion. For a
  // "detected" suggestion this is the count of samples that AGREED on the
  // winning pattern (as before). For an "assumed" suggestion, no pattern
  // was ever agreed on — there's nothing to "agree" — so this instead holds
  // detectDomain()'s support count (how many colleagues share the assumed
  // domain). Reusing the same field (rather than adding a separate
  // domainSupport field) keeps the UI's existing colleague-count copy
  // (suggestedEmailNote/domainReason) working unmodified for both paths.
  agreeCount: number;
  hasMx: boolean;
  provider: MailProvider;
  domainStatus: LookupStatus;
  confidence: SuggestionConfidence;
  // "detected": a company-specific convention was confirmed by >=2 agreeing
  // colleague samples (existing behavior, unchanged).
  // "assumed": no convention could be confirmed; this is an industry-default
  // "first.last" guess applied to a company domain revealed by at least one
  // colleague's email. Must be labeled as an assumption in the UI, never
  // presented as a detected convention.
  // "guessed-domain": neither of the above found anything (no colleague at
  // this company has a corporate email on file at all) — the domain itself
  // was guessed from the company's NAME and validated by DNS (see
  // src/lib/companyDomain.ts). Weakest of the three: both the local-part
  // pattern AND the domain are guesses, and a company name can collide with
  // an unrelated homonym company elsewhere in the world. Must always be
  // "low" confidence and clearly labeled as unconfirmed in the UI.
  source: "detected" | "assumed" | "guessed-domain";
}

export interface SuggestionTarget {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyKey: string | null;
  // Company DISPLAY name (contact.company), distinct from companyKey. Only
  // used by the last-resort companyDomain.ts guess, which needs the
  // human-readable name to derive domain candidates from — companyKey is
  // already normalized for a different purpose (matching aliases) and isn't
  // a good source for "what would this company's domain plausibly be".
  company: string | null;
}

/**
 * Suggest a probable corporate email for one contact, inferred ONLY from
 * that SAME BD's other contacts at the same company who already have an
 * email on file. Nothing here calls an external API or scraping service —
 * the "signal" is entirely the BD's own imported contacts.
 *
 * Three-path behavior, tried in order, each only attempted when the
 * previous one finds nothing:
 *  1) DETECTED (source: "detected"): detectPattern() requires >=2 colleague
 *     samples to AGREE on the same local-part convention (e.g. everyone
 *     uses first.last@...). Confidence can be "high"/"medium"/"low"
 *     depending on MX confirmation and how many samples agreed.
 *  2) ASSUMED (source: "assumed"): detectDomain() looks for the company's
 *     corporate domain from as little as ONE colleague sample (no pattern
 *     agreement required), and if found, we build the industry-default
 *     DEFAULT_PATTERN_ID ("first.last") address at that domain. This is a
 *     GUESS, not a detected convention — confidence is always forced to
 *     "low" (see below) and the UI must label it as an assumption.
 *  3) GUESSED-DOMAIN (source: "guessed-domain"): when not even ONE colleague
 *     at this company has a usable corporate email on file (measured
 *     reality: 89% of this contact base's on-file emails are free-mail, so
 *     for most companies there is nothing to learn from at all), try to
 *     derive the company's domain from its NAME instead, validated by
 *     public DNS only — no scraping, no paid API (see
 *     src/lib/companyDomain.ts). This is the weakest path: BOTH the address
 *     AND the domain are guesses, and a company name can collide with an
 *     unrelated homonym company elsewhere. Confidence is always "low" and
 *     the UI must say the company could not be confirmed.
 *
 * Paths (2) and (3) exist because measured against real data, requiring a
 * confirmed pattern (path 1 alone) left coverage near zero — the
 * overwhelming majority of companies in this contact base never accumulate
 * 2+ agreeing colleague samples, and most don't even have one.
 *
 * Returns null when the target has no company key / name to work with, or
 * when none of the three paths above can produce anything (see
 * src/lib/emailPatterns.ts#detectPattern / #detectDomain and
 * src/lib/companyDomain.ts#guessCompanyDomain).
 */
export async function suggestEmailForContact(
  bdId: string,
  target: SuggestionTarget,
): Promise<EmailSuggestion | null> {
  if (!target.companyKey || !target.firstName || !target.lastName) return null;

  // Privacy/correctness boundary: contacts are private per-BD data. The
  // sample set used to infer a company's email convention MUST be scoped to
  // the same bdId as the contact we're suggesting for — company_key is
  // shared taxonomy across BDs, but contact rows (and the emails on them)
  // are not, so this must never read another BD's contacts.
  const samples = await db
    .select({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
    })
    .from(contact)
    .where(
      and(
        eq(contact.bdId, bdId),
        // Alias-aware, like every other company filter in the app: a
        // company reached through company_alias (e.g. "Globant S.A." vs
        // "Globant") must contribute its colleagues' emails too.
        companyKeyFilter(target.companyKey),
        isNotNull(contact.email),
        ne(contact.id, target.id),
      ),
    )
    .limit(SAMPLE_CAP);

  const usableSamples = samples.filter(
    (s): s is { firstName: string; lastName: string; email: string } =>
      !!s.firstName && !!s.lastName && !!s.email,
  );

  const detected = detectPattern(usableSamples);
  if (detected) {
    const email = buildEmail(
      detected.patternId,
      detected.domain,
      target.firstName,
      target.lastName,
      detected.firstVariant,
      detected.lastVariant,
    );
    if (!email) return null;

    const domainCheck = await getDomainCheck(detected.domain);

    // A CONFIRMED non-receiving domain (successful DNS lookup with zero MX
    // records, or no such domain) means no address here can ever be
    // delivered. Don't return a suggestion guaranteed to bounce — but don't
    // give up either: a company that migrated domains still has colleagues
    // on the OLD one in our base, and the guessed-domain path below may find
    // the live one. Falling through is exactly the churn case the fallback
    // chain exists for.
    if (isDeadDomain(domainCheck.status)) return guessFromCompanyName(target);

    let confidence: SuggestionConfidence = "low";
    if (domainCheck.hasMx && detected.agreeCount >= HIGH_CONFIDENCE_MIN_AGREE) {
      confidence = "high";
    } else if (domainCheck.hasMx && detected.agreeCount >= MEDIUM_CONFIDENCE_MIN_AGREE) {
      confidence = "medium";
    }
    // Everything else (no MX confirmation yet, a lookup error, or too few
    // agreeing colleagues) stays "low" — including a lookup "error", where
    // the domain is unconfirmed rather than known-bad.

    return {
      email,
      patternId: detected.patternId,
      domain: detected.domain,
      sampleCount: detected.sampleCount,
      agreeCount: detected.agreeCount,
      hasMx: domainCheck.hasMx,
      provider: domainCheck.provider,
      domainStatus: domainCheck.status,
      confidence,
      source: "detected",
    };
  }

  // FALLBACK PATH: no agreed-upon convention. Reuse the same `usableSamples`
  // set detectPattern() used — it only requires firstName/lastName/email to
  // be present (see the filter above), NOT a non-free-mail domain: that
  // check is detectDomain()'s own job (via its internal
  // isDomainUsableSample), and it re-applies isFreeMailDomain itself, so
  // free-mail samples are still correctly excluded from domain detection.
  // Reusing usableSamples here is a simplification, not a stricter-superset
  // guarantee: we already need target.firstName/target.lastName to build
  // the target's OWN address regardless, and requiring names on colleague
  // samples too costs us little in practice, so re-querying the raw
  // `samples` array (which only guarantees a non-null email) isn't worth it.
  const domainGuess = detectDomain(usableSamples);
  if (domainGuess) {
    const assumedEmail = buildEmail(DEFAULT_PATTERN_ID, domainGuess.domain, target.firstName, target.lastName);
    if (!assumedEmail) return null;

    const domainCheck = await getDomainCheck(domainGuess.domain);

    // Same as the detected path: a dead domain falls through to the
    // name-based guess rather than ending the search.
    if (isDeadDomain(domainCheck.status)) return guessFromCompanyName(target);

    // Confidence is ALWAYS "low" for an assumed suggestion, even when the
    // domain has confirmed MX records. Unlike the detected path, no
    // colleague ever agreed on this being the actual convention — hasMx
    // only confirms the DOMAIN accepts mail, not that first.last is the
    // right local-part guess for it. Upgrading confidence here would
    // overstate evidence we don't have.
    return {
      email: assumedEmail,
      patternId: DEFAULT_PATTERN_ID,
      domain: domainGuess.domain,
      sampleCount: usableSamples.length,
      agreeCount: domainGuess.support,
      hasMx: domainCheck.hasMx,
      provider: domainCheck.provider,
      domainStatus: domainCheck.status,
      confidence: "low",
      source: "assumed",
    };
  }

  // LAST-RESORT PATH: not even a single colleague at this company has a
  // usable corporate email on file — detectDomain() found nothing to work
  // with either. Try to derive the company's domain from its NAME instead,
  // validated purely by DNS (see src/lib/companyDomain.ts). This is a GUESS
  // about company identity, not evidence from this BD's own contacts — a
  // company name can collide with an unrelated homonym (a US "Flexibility
  // Inc" vs. the user's local one), so confidence is always forced to "low"
  // and the UI must say the company could not be confirmed.
  return guessFromCompanyName(target);
}

/**
 * Last-resort suggestion built on a domain guessed from the company NAME.
 * Extracted so the detected/assumed paths can fall through to it when the
 * domain their colleagues use turns out to be dead.
 */
async function guessFromCompanyName(target: SuggestionTarget): Promise<EmailSuggestion | null> {
  if (!target.firstName || !target.lastName) return null;

  const guessedDomain = await guessCompanyDomain(target.company);
  if (!guessedDomain) return null;

  const guessedEmail = buildEmail(DEFAULT_PATTERN_ID, guessedDomain.domain, target.firstName, target.lastName);
  if (!guessedEmail) return null;

  return {
    email: guessedEmail,
    patternId: DEFAULT_PATTERN_ID,
    domain: guessedDomain.domain,
    // No colleague sample backs this at all — sampleCount/agreeCount are 0,
    // unlike the "assumed" path's domainGuess.support. The UI's copy for
    // "guessed-domain" must not claim colleague evidence.
    sampleCount: 0,
    agreeCount: 0,
    hasMx: true,
    provider: guessedDomain.provider,
    domainStatus: "ok",
    confidence: "low",
    source: "guessed-domain",
  };
}

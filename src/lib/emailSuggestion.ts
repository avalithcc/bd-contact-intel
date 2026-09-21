import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { contact, emailDomainCheck } from "@/db/schema";
import { companyKeyFilter } from "@/lib/queries";
import {
  detectPattern,
  detectDomain,
  buildEmail,
  DEFAULT_PATTERN_ID,
  type PatternId,
} from "@/lib/emailPatterns";
import {
  isDeadDomain,
  lookupDomain,
  type MailProvider,
  type LookupStatus,
  type DomainLookupResult,
} from "@/lib/emailDomain";

// Cap on how many colleague samples we pull to infer a company's email
// convention. A BD's contacts at one company can occasionally run into the
// hundreds; 200 is comfortably enough evidence for a majority pattern
// without letting one huge company dominate a single query's cost.
const SAMPLE_CAP = 200;

// How long a cached MX lookup (email_domain_check) stays fresh before we
// re-resolve it. MX records change rarely, so 30 days keeps DNS traffic low
// while still catching a domain that migrated mail providers.
const DOMAIN_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
  source: "detected" | "assumed";
}

/**
 * Read the cached MX check for `domain` if fresh, otherwise look it up via
 * DNS (src/lib/emailDomain.ts) and upsert the cache. Shared across BDs — a
 * domain's MX is public DNS data, not contact data (see
 * src/db/schema.ts#emailDomainCheck).
 */
async function getDomainCheck(domain: string) {
  // The cache is an optimization, not a dependency: if reading or writing it
  // fails, fall through to (or keep) the live DNS answer instead of throwing
  // out of a best-effort suggestion and taking the whole page down with it.
  const [cached] = await selectCachedDomain(domain);

  const isFresh = cached && Date.now() - cached.checkedAt.getTime() < DOMAIN_CACHE_TTL_MS;
  if (isFresh) {
    return {
      // Both confirmed dead-end statuses collapse to "no-mx" on the way
      // back out of the cache: they suppress the suggestion identically, and
      // the distinction is only worth a DNS round trip, not a column.
      status: (cached.hasMx ? "ok" : "no-mx") as LookupStatus,
      hasMx: cached.hasMx,
      provider: cached.provider as MailProvider,
      mxHosts: cached.mxHosts as string[],
    };
  }

  const result = await lookupDomain(domain);

  // Only persist a definitive DNS answer ("ok" or a confirmed dead end). A
  // transient lookup "error" (timeout, resolver hiccup) is NOT cached, so
  // the next request retries instead of freezing an unconfirmed result for
  // 30 days.
  if (result.status !== "error") {
    await cacheDomainCheck(result, domain);
  }

  return result;
}

async function selectCachedDomain(domain: string) {
  try {
    return await db
      .select()
      .from(emailDomainCheck)
      .where(eq(emailDomainCheck.domain, domain))
      .limit(1);
  } catch {
    return [];
  }
}

async function cacheDomainCheck(result: DomainLookupResult, domain: string): Promise<void> {
  try {
    await db
      .insert(emailDomainCheck)
      .values({
        domain,
        hasMx: result.hasMx,
        provider: result.provider,
        mxHosts: result.mxHosts,
        checkedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: emailDomainCheck.domain,
        set: {
          hasMx: sql`excluded.has_mx`,
          provider: sql`excluded.provider`,
          mxHosts: sql`excluded.mx_hosts`,
          checkedAt: sql`excluded.checked_at`,
        },
      });
  } catch {
    // Nothing to do: the caller already has its answer for this request.
  }
}

export interface SuggestionTarget {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyKey: string | null;
}

/**
 * Suggest a probable corporate email for one contact, inferred ONLY from
 * that SAME BD's other contacts at the same company who already have an
 * email on file. Nothing here calls an external API or scraping service —
 * the "signal" is entirely the BD's own imported contacts.
 *
 * Two-path behavior:
 *  1) DETECTED (source: "detected"): tried first, unchanged from before this
 *     fallback was added. detectPattern() requires >=2 colleague samples to
 *     AGREE on the same local-part convention (e.g. everyone uses
 *     first.last@...). Confidence can be "high"/"medium"/"low" depending on
 *     MX confirmation and how many samples agreed.
 *  2) ASSUMED (source: "assumed"), only tried when (1) finds nothing:
 *     detectDomain() looks for the company's corporate domain from as
 *     little as ONE colleague sample (no pattern agreement required), and
 *     if found, we build the industry-default DEFAULT_PATTERN_ID
 *     ("first.last") address at that domain. This is a GUESS, not a
 *     detected convention — confidence is always forced to "low" (see
 *     below) and the UI must label it as an assumption.
 *
 * This fallback exists because measured against real data, requiring a
 * confirmed pattern left coverage near zero — the overwhelming majority of
 * companies in this contact base never accumulate 2+ agreeing colleague
 * samples, but a corporate domain is often visible from just one.
 *
 * Returns null when the target has no company key / name to work with, or
 * when neither a pattern nor a domain can be found (see
 * src/lib/emailPatterns.ts#detectPattern / #detectDomain).
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

    // A CONFIRMED non-receiving domain (successful DNS lookup, zero MX
    // records) means no address at this domain can ever be delivered — don't
    // show a suggestion at all rather than one guaranteed to bounce.
    // A domain that provably cannot receive mail (no MX, or no domain at
    // all) makes any suggested address worthless — show nothing rather than
    // a plausible-looking guess.
    if (isDeadDomain(domainCheck.status)) return null;

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
  if (!domainGuess) return null;

  const assumedEmail = buildEmail(DEFAULT_PATTERN_ID, domainGuess.domain, target.firstName, target.lastName);
  if (!assumedEmail) return null;

  const domainCheck = await getDomainCheck(domainGuess.domain);

  // Same dead-domain suppression as the detected path: an assumed address
  // at a domain confirmed to never receive mail is worthless to show.
  if (isDeadDomain(domainCheck.status)) return null;

  // Confidence is ALWAYS "low" for an assumed suggestion, even when the
  // domain has confirmed MX records. Unlike the detected path, no colleague
  // ever agreed on this being the actual convention — hasMx only confirms
  // the DOMAIN accepts mail, not that first.last is the right local-part
  // guess for it. Upgrading confidence here would overstate evidence we
  // don't have.
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

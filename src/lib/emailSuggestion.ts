import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { contact } from "@/db/schema";
import { detectPattern, buildEmail, type PatternId } from "@/lib/emailPatterns";

// Cap on how many colleague samples we pull to infer a company's email
// convention. A BD's contacts at one company can occasionally run into the
// hundreds; 200 is comfortably enough evidence for a majority pattern
// without letting one huge company dominate a single query's cost.
const SAMPLE_CAP = 200;

export interface EmailSuggestion {
  email: string;
  patternId: PatternId;
  domain: string;
  sampleCount: number;
  agreeCount: number;
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
 * Returns null when the target has no company key / name to work with, or
 * when no pattern with enough support is found (see
 * src/lib/emailPatterns.ts#detectPattern).
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
        eq(contact.companyKey, target.companyKey),
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
  if (!detected) return null;

  const email = buildEmail(detected.patternId, detected.domain, target.firstName, target.lastName);
  if (!email) return null;

  return {
    email,
    patternId: detected.patternId,
    domain: detected.domain,
    sampleCount: detected.sampleCount,
    agreeCount: detected.agreeCount,
  };
}

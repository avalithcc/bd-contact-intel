/**
 * Cached MX-lookup lookup layer shared by every domain-guessing path
 * (src/lib/emailSuggestion.ts's detected/assumed suggestions and
 * src/lib/companyDomain.ts's name-based domain guess). Extracted out of
 * emailSuggestion.ts so companyDomain.ts can reuse the same 30-day cache
 * over the `email_domain_check` table instead of issuing its own live DNS
 * lookups — this also avoids a circular import between the two modules.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailDomainCheck } from "@/db/schema";
import {
  isDeadDomain,
  lookupDomain,
  type MailProvider,
  type LookupStatus,
  type DomainLookupResult,
} from "@/lib/emailDomain";

export { isDeadDomain, type MailProvider, type LookupStatus, type DomainLookupResult };

// How long a cached MX lookup (email_domain_check) stays fresh before we
// re-resolve it. MX records change rarely, so 30 days keeps DNS traffic low
// while still catching a domain that migrated mail providers.
const DOMAIN_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Read the cached MX check for `domain` if fresh, otherwise look it up via
 * DNS (src/lib/emailDomain.ts) and upsert the cache. Shared across BDs — a
 * domain's MX is public DNS data, not contact data (see
 * src/db/schema.ts#emailDomainCheck).
 */
export async function getDomainCheck(domain: string) {
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

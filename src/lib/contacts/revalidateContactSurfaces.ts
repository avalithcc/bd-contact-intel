/**
 * The ONE way a server action refreshes the pages a Contact write can change. It names the Contact and the list
 * effects (revalidateLists.ts) and this module owns every path, so an action never repeats them.
 *
 * Three pages show a Contact's data: its own record, the lists, and its COMPANY's record page, whose timeline unions in
 * every contact's activity and open tasks (getCompanyTimeline). A write against a Contact therefore changes the company
 * page too, yet actions only hold a person id.
 *
 * Applied UNIFORMLY to every Contact write on purpose. Do not decide per call site whether this particular write reaches
 * the company timeline: that judgment drifts as the timeline grows new sources, and being uniform costs one lookup by
 * primary key on a user-initiated mutation, which is free. tests/unit/revalidateContactSurfacesSource.test.ts fails the
 * build if a Contact path is revalidated anywhere else.
 */
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { revalidateLists, type ListEffect } from "@/lib/contacts/revalidateLists";

export interface RevalidateContactSurfacesDeps {
  revalidatePath: (path: string) => void;
  revalidateLists: (...effects: ListEffect[]) => void;
  resolveCanonicalCompanyKey: (personId: string) => Promise<string | null>;
}

/**
 * Effects first, company last, and the company step is BEST-EFFORT.
 *
 * The person's `company_key` may be an ALIAS while the record page exists only at the canonical key (getCompanyByKey
 * matches it exactly), so the key is resolved through company aliases, the same KEY rule as the timeline's
 * companyContactsCondition. Revalidating only the raw key does not cause staleness, it just does not help by
 * itself: when it is an alias it names a page that does not exist and the live one is untouched. Callers that also hold
 * a company key revalidate it alongside this. One round trip per call, never per list effect.
 *
 * The write has already COMMITTED by the time an action calls this, so a transient failure resolving the key must not
 * throw: that would report a successful write as an error and invite a retry that duplicates the row. A missed
 * revalidation costs one stale company page until the next navigation; a duplicate row cannot be undone.
 */
export async function revalidateContactSurfacesWith(
  deps: RevalidateContactSurfacesDeps,
  personId: string,
  effects: readonly ListEffect[],
): Promise<void> {
  deps.revalidatePath(`/contacts/${personId}`);
  if (effects.length > 0) deps.revalidateLists(...effects);
  try {
    const canonicalKey = await deps.resolveCanonicalCompanyKey(personId);
    if (canonicalKey) deps.revalidatePath(`/companies/${canonicalKey}`);
  } catch (err) {
    // A redirect()/notFound() is thrown, not returned, so it must escape this
    // catch untouched (tests/unit/rethrowNavigationErrors.test.ts).
    unstable_rethrow(err);
    // Anything else is intentionally swallowed — see above.
  }
}

export async function revalidateContactSurfaces(personId: string, ...effects: ListEffect[]): Promise<void> {
  await revalidateContactSurfacesWith(
    {
      revalidatePath,
      revalidateLists,
      // Imported on demand so this module (and its unit tests) load without a database client.
      resolveCanonicalCompanyKey: async (id) => (await import("@/lib/companies/aliasResolutionDb")).getCanonicalCompanyKeyForPerson(id),
    },
    personId,
    effects,
  );
}

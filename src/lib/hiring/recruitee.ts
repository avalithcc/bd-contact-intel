import type { JobSource, NormalizedPosting } from "./types";

export interface RecruiteeConfig {
  slug: string;
}

interface RecruiteeOffer {
  id: number;
  title: string;
  // `location` is Recruitee's own pre-composed "City, State, Country" string
  // and is what's used when present; `city`/`country` are kept as a fallback
  // for the rare offer where `location` is blank but the split fields aren't
  // (confirmed both shapes occur on live boards during this adapter's
  // verification).
  location?: string;
  city?: string;
  country?: string;
  careers_url?: string;
  careers_apply_url?: string;
  department?: string;
  published_at?: string;
  created_at?: string;
}

function isRecruiteeConfig(config: unknown): config is RecruiteeConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    typeof (config as { slug?: unknown }).slug === "string"
  );
}

function isRecruiteeOffer(entry: unknown): entry is RecruiteeOffer {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { id?: unknown }).id === "number" &&
    typeof (entry as { title?: unknown }).title === "string"
  );
}

function normalizeLocation(offer: RecruiteeOffer): string {
  if (offer.location) return offer.location;
  return [offer.city, offer.country]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");
}

// Sanity bound on how many postings a single company's response can
// contribute — protects against a malformed/huge payload from a shape drift
// or ATS bug ballooning memory/DB work for one company.
const MAX_POSTINGS_PER_RESPONSE = 2000;

/**
 * Recruitee's public offers API — no auth required:
 * https://{slug}.recruitee.com/api/offers/
 *
 * Field names (`id`, `title`, `location`, `careers_url`, `careers_apply_url`,
 * `department`, `published_at`, `created_at`) were confirmed against live
 * public Recruitee boards during this adapter's verification, not guessed
 * from documentation — no board slug is recorded here since this repo is
 * public.
 */
export const recruiteeSource: JobSource = {
  async fetchPostings(config: unknown): Promise<NormalizedPosting[]> {
    if (!isRecruiteeConfig(config)) {
      throw new Error(
        `Invalid Recruitee config: expected { slug: string }, got ${JSON.stringify(config)}`,
      );
    }
    const url = `https://${encodeURIComponent(config.slug)}.recruitee.com/api/offers/`;
    // Cap each request so one hanging ATS can't eat the whole 60s function
    // budget (see maxDuration in the sync route) and starve later companies
    // in the same run.
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(
        `Recruitee fetch failed for slug "${config.slug}": ${res.status} ${res.statusText}`,
      );
    }
    const body: unknown = await res.json();
    const offers = (body as { offers?: unknown }).offers;
    if (!Array.isArray(offers)) {
      throw new Error(
        `Recruitee fetch for slug "${config.slug}" returned a response without an offers array`,
      );
    }
    if (offers.length > MAX_POSTINGS_PER_RESPONSE) {
      throw new Error(
        `Recruitee fetch for slug "${config.slug}" returned ${offers.length} postings, ` +
          `exceeding the ${MAX_POSTINGS_PER_RESPONSE} sanity bound`,
      );
    }
    // Skip (rather than crash on) individual entries that don't match the
    // expected shape — a single malformed entry shouldn't drop the whole
    // company's sync.
    const postings = offers.filter(isRecruiteeOffer);
    return postings.map((p) => ({
      externalId: String(p.id),
      title: p.title,
      location: normalizeLocation(p),
      url: p.careers_url ?? p.careers_apply_url ?? "",
      department: p.department,
      postedAt: p.published_at
        ? new Date(p.published_at)
        : p.created_at
          ? new Date(p.created_at)
          : undefined,
    }));
  },
};

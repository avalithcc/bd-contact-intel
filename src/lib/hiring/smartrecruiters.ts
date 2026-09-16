import type { JobSource, NormalizedPosting } from "./types";

export interface SmartRecruitersConfig {
  slug: string;
}

interface SmartRecruitersLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
}

interface SmartRecruitersPosting {
  id: string;
  name: string;
  location?: SmartRecruitersLocation;
  releasedDate?: string;
  department?: { label?: string };
  ref?: string;
  applyUrl?: string;
}

interface SmartRecruitersPage {
  offset: number;
  limit: number;
  totalFound: number;
  content: unknown[];
}

function isSmartRecruitersConfig(config: unknown): config is SmartRecruitersConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    typeof (config as { slug?: unknown }).slug === "string"
  );
}

function isSmartRecruitersPosting(entry: unknown): entry is SmartRecruitersPosting {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { id?: unknown }).id === "string" &&
    typeof (entry as { name?: unknown }).name === "string"
  );
}

function isSmartRecruitersPage(body: unknown): body is SmartRecruitersPage {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { totalFound?: unknown }).totalFound === "number" &&
    Array.isArray((body as { content?: unknown }).content)
  );
}

function normalizeLocation(location: SmartRecruitersLocation | undefined): string {
  if (!location) return "";
  return [location.city, location.region, location.country]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");
}

// Sanity bounds on pagination — protects against a malformed/huge company
// response ballooning memory/DB work and request count for one company.
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_POSTINGS_PER_RESPONSE = 500;

/**
 * SmartRecruiters' public postings API — no auth required, paginated:
 * https://api.smartrecruiters.com/v1/companies/{slug}/postings?offset=&limit=100
 *
 * IMPORTANT: this endpoint returns HTTP 200 with `{ totalFound: 0, content:
 * [] }` for ANY slug, including nonexistent ones — an empty result is NOT
 * an error, it's a legitimate zero-postings response. The sync layer
 * already treats an empty raw list as "skip closing" rather than an error.
 */
export const smartRecruitersSource: JobSource = {
  async fetchPostings(config: unknown): Promise<NormalizedPosting[]> {
    if (!isSmartRecruitersConfig(config)) {
      throw new Error(
        `Invalid SmartRecruiters config: expected { slug: string }, got ${JSON.stringify(config)}`,
      );
    }

    const all: SmartRecruitersPosting[] = [];
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(
        config.slug,
      )}/postings?offset=${offset}&limit=${PAGE_SIZE}`;
      // Cap each request so one hanging ATS can't eat the whole 60s function
      // budget (see maxDuration in the sync route) and starve later
      // companies in the same run.
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        throw new Error(
          `SmartRecruiters fetch failed for slug "${config.slug}": ${res.status} ${res.statusText}`,
        );
      }
      const body: unknown = await res.json();
      if (!isSmartRecruitersPage(body)) {
        throw new Error(
          `SmartRecruiters fetch for slug "${config.slug}" returned an unexpected response shape`,
        );
      }

      // Skip (rather than crash on) individual entries that don't match the
      // expected shape — a single malformed entry shouldn't drop the whole
      // company's sync.
      all.push(...body.content.filter(isSmartRecruitersPosting));

      if (all.length >= MAX_POSTINGS_PER_RESPONSE) break;

      offset += body.content.length;
      if (offset >= body.totalFound || body.content.length === 0) break;
    }

    if (all.length > MAX_POSTINGS_PER_RESPONSE) {
      throw new Error(
        `SmartRecruiters fetch for slug "${config.slug}" returned ${all.length} postings, ` +
          `exceeding the ${MAX_POSTINGS_PER_RESPONSE} sanity bound`,
      );
    }

    return all.map((p) => ({
      externalId: p.id,
      title: p.name,
      location: normalizeLocation(p.location),
      url:
        p.applyUrl ??
        `https://jobs.smartrecruiters.com/${encodeURIComponent(config.slug)}/${encodeURIComponent(p.id)}`,
      department: p.department?.label,
      postedAt: p.releasedDate ? new Date(p.releasedDate) : undefined,
    }));
  },
};

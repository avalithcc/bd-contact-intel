import type { JobSource, NormalizedPosting } from "./types";

export interface GreenhouseConfig {
  slug: string;
}

interface GreenhousePosting {
  id: number;
  title: string;
  location?: { name?: string };
  absolute_url: string;
  updated_at?: string;
  departments?: { name?: string }[];
}

function isGreenhouseConfig(config: unknown): config is GreenhouseConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    typeof (config as { slug?: unknown }).slug === "string"
  );
}

function isGreenhousePosting(entry: unknown): entry is GreenhousePosting {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { id?: unknown }).id === "number" &&
    typeof (entry as { title?: unknown }).title === "string" &&
    typeof (entry as { absolute_url?: unknown }).absolute_url === "string"
  );
}

// Sanity bound on how many postings a single company's response can
// contribute — protects against a malformed/huge payload from a shape drift
// or ATS bug ballooning memory/DB work for one company.
const MAX_POSTINGS_PER_RESPONSE = 2000;

/**
 * Greenhouse's public job board API — no auth required:
 * https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
 *
 * Deliberately not using `?content=true`: the extra HTML job description
 * body isn't needed for any normalized field here, and skipping it keeps
 * the response small.
 */
export const greenhouseSource: JobSource = {
  async fetchPostings(config: unknown): Promise<NormalizedPosting[]> {
    if (!isGreenhouseConfig(config)) {
      throw new Error(
        `Invalid Greenhouse config: expected { slug: string }, got ${JSON.stringify(config)}`,
      );
    }
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(config.slug)}/jobs`;
    // Cap each request so one hanging ATS can't eat the whole 60s function
    // budget (see maxDuration in the sync route) and starve later companies
    // in the same run.
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(
        `Greenhouse fetch failed for slug "${config.slug}": ${res.status} ${res.statusText}`,
      );
    }
    const body: unknown = await res.json();
    const jobs = (body as { jobs?: unknown }).jobs;
    if (!Array.isArray(jobs)) {
      throw new Error(
        `Greenhouse fetch for slug "${config.slug}" returned a response without a jobs array`,
      );
    }
    if (jobs.length > MAX_POSTINGS_PER_RESPONSE) {
      throw new Error(
        `Greenhouse fetch for slug "${config.slug}" returned ${jobs.length} postings, ` +
          `exceeding the ${MAX_POSTINGS_PER_RESPONSE} sanity bound`,
      );
    }
    // Skip (rather than crash on) individual entries that don't match the
    // expected shape — a single malformed entry shouldn't drop the whole
    // company's sync.
    const postings = jobs.filter(isGreenhousePosting);
    return postings.map((p) => ({
      externalId: String(p.id),
      title: p.title,
      location: p.location?.name ?? "",
      url: p.absolute_url,
      department: p.departments?.[0]?.name,
      // Greenhouse doesn't expose a "first posted" timestamp on this
      // endpoint — `updated_at` is the last-modified time, which for most
      // postings equals the creation time but can be later if the posting
      // was edited. Treated as a best-effort `postedAt` for sorting/display.
      postedAt: p.updated_at ? new Date(p.updated_at) : undefined,
    }));
  },
};

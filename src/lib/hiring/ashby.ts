import type { JobSource, NormalizedPosting } from "./types";

export interface AshbyConfig {
  slug: string;
}

interface AshbyPosting {
  id: string;
  title: string;
  location?: string;
  jobUrl?: string;
  applyUrl?: string;
  publishedAt?: string;
  department?: string;
  employmentType?: string;
  isListed?: boolean;
}

function isAshbyConfig(config: unknown): config is AshbyConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    typeof (config as { slug?: unknown }).slug === "string"
  );
}

function isAshbyPosting(entry: unknown): entry is AshbyPosting {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { id?: unknown }).id === "string" &&
    typeof (entry as { title?: unknown }).title === "string"
  );
}

// Sanity bound on how many postings a single company's response can
// contribute — protects against a malformed/huge payload from a shape drift
// or ATS bug ballooning memory/DB work for one company.
const MAX_POSTINGS_PER_RESPONSE = 2000;

/**
 * Ashby's public job board API — no auth required:
 * https://api.ashbyhq.com/posting-api/job-board/{slug}
 */
export const ashbySource: JobSource = {
  async fetchPostings(config: unknown): Promise<NormalizedPosting[]> {
    if (!isAshbyConfig(config)) {
      throw new Error(
        `Invalid Ashby config: expected { slug: string }, got ${JSON.stringify(config)}`,
      );
    }
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(config.slug)}`;
    // Cap each request so one hanging ATS can't eat the whole 60s function
    // budget (see maxDuration in the sync route) and starve later companies
    // in the same run.
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(
        `Ashby fetch failed for slug "${config.slug}": ${res.status} ${res.statusText}`,
      );
    }
    const body: unknown = await res.json();
    const jobs = (body as { jobs?: unknown }).jobs;
    if (!Array.isArray(jobs)) {
      throw new Error(
        `Ashby fetch for slug "${config.slug}" returned a response without a jobs array`,
      );
    }
    if (jobs.length > MAX_POSTINGS_PER_RESPONSE) {
      throw new Error(
        `Ashby fetch for slug "${config.slug}" returned ${jobs.length} postings, ` +
          `exceeding the ${MAX_POSTINGS_PER_RESPONSE} sanity bound`,
      );
    }
    // Skip (rather than crash on) individual entries that don't match the
    // expected shape — a single malformed entry shouldn't drop the whole
    // company's sync. Also skip entries explicitly marked unlisted — Ashby
    // can return postings that are no longer publicly listed.
    const postings = jobs
      .filter(isAshbyPosting)
      .filter((p) => p.isListed !== false);
    return postings.map((p) => ({
      externalId: p.id,
      title: p.title,
      location: p.location ?? "",
      url: p.jobUrl ?? p.applyUrl ?? "",
      department: p.department,
      postedAt: p.publishedAt ? new Date(p.publishedAt) : undefined,
    }));
  },
};

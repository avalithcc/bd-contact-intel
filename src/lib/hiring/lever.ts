import type { JobSource, NormalizedPosting } from "./types";

export interface LeverConfig {
  slug: string;
}

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number; // epoch ms
  categories?: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
  };
}

function isLeverConfig(config: unknown): config is LeverConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    typeof (config as { slug?: unknown }).slug === "string"
  );
}

function isLeverPosting(entry: unknown): entry is LeverPosting {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { id?: unknown }).id === "string" &&
    typeof (entry as { text?: unknown }).text === "string" &&
    typeof (entry as { hostedUrl?: unknown }).hostedUrl === "string"
  );
}

// Sanity bound on how many postings a single company's response can
// contribute — protects against a malformed/huge payload from a shape drift
// or ATS bug ballooning memory/DB work for one company.
const MAX_POSTINGS_PER_RESPONSE = 2000;

/**
 * Lever's public postings API — no auth required for `mode=json`:
 * https://api.lever.co/v0/postings/{slug}?mode=json
 *
 * `categories.team` is generally the more human-readable department label
 * on Lever boards; `categories.department` is used as a fallback when a
 * posting doesn't set `team`.
 */
export const leverSource: JobSource = {
  async fetchPostings(config: unknown): Promise<NormalizedPosting[]> {
    if (!isLeverConfig(config)) {
      throw new Error(
        `Invalid Lever config: expected { slug: string }, got ${JSON.stringify(config)}`,
      );
    }
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(config.slug)}?mode=json`;
    // Cap each request so one hanging ATS can't eat the whole 60s function
    // budget (see maxDuration in the sync route) and starve later companies
    // in the same run.
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(
        `Lever fetch failed for slug "${config.slug}": ${res.status} ${res.statusText}`,
      );
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      throw new Error(
        `Lever fetch for slug "${config.slug}" returned a non-array response`,
      );
    }
    if (body.length > MAX_POSTINGS_PER_RESPONSE) {
      throw new Error(
        `Lever fetch for slug "${config.slug}" returned ${body.length} postings, ` +
          `exceeding the ${MAX_POSTINGS_PER_RESPONSE} sanity bound`,
      );
    }
    // Skip (rather than crash on) individual entries that don't match the
    // expected shape — a single malformed entry shouldn't drop the whole
    // company's sync.
    const postings = body.filter(isLeverPosting);
    return postings.map((p) => ({
      externalId: p.id,
      title: p.text,
      location: p.categories?.location ?? "",
      url: p.hostedUrl,
      department: p.categories?.team ?? p.categories?.department,
      postedAt: p.createdAt ? new Date(p.createdAt) : undefined,
    }));
  },
};

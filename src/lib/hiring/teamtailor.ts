import type { JobSource, NormalizedPosting } from "./types";

export interface TeamtailorConfig {
  slug: string;
}

interface TeamtailorJobLocationAddress {
  addressLocality?: unknown;
  addressCountry?: unknown;
}

interface TeamtailorJobPosting {
  jobLocation?: { address?: TeamtailorJobLocationAddress }[];
}

interface TeamtailorItem {
  id: string;
  title: string;
  url: string;
  date_published?: string;
  content_html?: string;
  // Present on most boards but NOT part of the JSON Feed spec itself — a
  // bare-minimum-compliant item only guarantees `id`/`title`/`url`, so this
  // is read defensively (see extractLocation below).
  _jobposting?: TeamtailorJobPosting;
}

function isTeamtailorConfig(config: unknown): config is TeamtailorConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    typeof (config as { slug?: unknown }).slug === "string"
  );
}

function isTeamtailorItem(entry: unknown): entry is TeamtailorItem {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { id?: unknown }).id === "string" &&
    typeof (entry as { title?: unknown }).title === "string" &&
    typeof (entry as { url?: unknown }).url === "string"
  );
}

/**
 * Teamtailor's JSON Feed only guarantees `title`/`url`/`date_published`/
 * `content_html` per item — location lives in an out-of-spec `_jobposting`
 * (schema.org JobPosting) extension that a compliant-but-minimal feed can
 * omit entirely. Returns "" rather than guessing when it's missing: an
 * empty location deliberately classifies as market "other" in
 * classifyMarket (src/lib/hiring/markets.ts) instead of crashing or being
 * mis-bucketed into "latam"/"us".
 */
function extractLocation(item: TeamtailorItem): string {
  const address = item._jobposting?.jobLocation?.[0]?.address;
  if (!address) return "";
  return [address.addressLocality, address.addressCountry]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(", ");
}

// Sanity bound on how many postings a single company's response can
// contribute — protects against a malformed/huge payload from a shape drift
// or ATS bug ballooning memory/DB work for one company.
const MAX_POSTINGS_PER_RESPONSE = 2000;

/**
 * Teamtailor's public jobs feed — no auth required:
 * https://{slug}.teamtailor.com/jobs.json
 *
 * This is a JSON Feed (https://jsonfeed.org/): the postings array is
 * `items[]`, NOT `jobs[]` — a wrong guess here already broke the discovery
 * module's probe once (see probeTeamtailor in discovery.ts). Confirmed live
 * against real public Teamtailor boards during this adapter's verification —
 * no board slug is recorded here since this repo is public.
 */
export const teamtailorSource: JobSource = {
  async fetchPostings(config: unknown): Promise<NormalizedPosting[]> {
    if (!isTeamtailorConfig(config)) {
      throw new Error(
        `Invalid Teamtailor config: expected { slug: string }, got ${JSON.stringify(config)}`,
      );
    }
    const url = `https://${encodeURIComponent(config.slug)}.teamtailor.com/jobs.json`;
    // Cap each request so one hanging ATS can't eat the whole 60s function
    // budget (see maxDuration in the sync route) and starve later companies
    // in the same run.
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(
        `Teamtailor fetch failed for slug "${config.slug}": ${res.status} ${res.statusText}`,
      );
    }
    const body: unknown = await res.json();
    const items = (body as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      throw new Error(
        `Teamtailor fetch for slug "${config.slug}" returned a response without an items array`,
      );
    }
    if (items.length > MAX_POSTINGS_PER_RESPONSE) {
      throw new Error(
        `Teamtailor fetch for slug "${config.slug}" returned ${items.length} postings, ` +
          `exceeding the ${MAX_POSTINGS_PER_RESPONSE} sanity bound`,
      );
    }
    // Skip (rather than crash on) individual entries that don't match the
    // expected shape — a single malformed entry shouldn't drop the whole
    // company's sync.
    const postings = items.filter(isTeamtailorItem);
    return postings.map((p) => ({
      externalId: p.id,
      title: p.title,
      location: extractLocation(p),
      url: p.url,
      postedAt: p.date_published ? new Date(p.date_published) : undefined,
    }));
  },
};

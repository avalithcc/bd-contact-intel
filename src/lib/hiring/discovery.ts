import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boardCandidate, companyProbe, discoveryRun, targetCompany } from "@/db/schema";
import type { CompanyCategoryKey } from "@/lib/companyCategories";
import type { JobSource } from "./types";
import { greenhouseSource } from "./greenhouse";
import { leverSource } from "./lever";
import { ashbySource } from "./ashby";
import { smartRecruitersSource } from "./smartrecruiters";

/**
 * Automated ATS board discovery: scans company keys that show up in BDs'
 * contact bases but have no `target_company` row yet, guesses a few slug
 * variants, and probes public ATS endpoints to see if a real job board
 * exists there. Hits land in `board_candidate` for human review (see
 * src/app/discovery/actions.ts and src/lib/hiring/discoveryQueries.ts);
 * strong hits are auto-approved straight into `target_company` so the
 * existing daily sync (src/lib/hiring/sync.ts) picks them up with no extra
 * wiring.
 *
 * Lesson baked into the design (from a manual, verified sweep over ~1,590
 * companies that found 176 real boards — an ~11% hit rate): slug guessing
 * is noisy. That sweep hit several categories of false positive: a guessed
 * slug resolving to a same-named but unrelated company on the ATS, and a
 * guessed slug landing on an obvious demo/test account rather than a real
 * employer. No company names from that sweep are recorded here (this repo
 * is public) — the takeaway is structural: a slug match alone proves
 * nothing about which company you actually found. A 200 response proves
 * even less (SmartRecruiters returns `{ totalFound: 0, content: [] }` —
 * HTTP 200 — for literally any slug).
 * Only a non-empty result with real posting titles counts as a hit, and
 * only a narrow, high-confidence case auto-approves (see
 * AUTO_APPROVE_MIN_JOB_COUNT below) — everything else is queued for a human
 * to glance at the board URL and decide.
 */

// A company probed within this window is skipped by getCandidateCompanies
// so a run makes forward progress instead of re-guessing the same slugs
// every time (see company_probe in src/db/schema.ts).
const PROBE_COOLDOWN_DAYS = 30;

// Company categories (see src/lib/companyCategories.ts) excluded from
// discovery: `independent` (a person, not a company with an ATS board),
// `other` (doesn't fit any tracked industry — historically low signal), and
// `unclassified` (no category signal at all to prioritize on). A company is
// only excluded if EVERY contact row sharing its key falls in one of these
// buckets (see the `having` clause in getCandidateCompanies) — a company
// with any better-classified contact is still worth probing.
const EXCLUDED_CATEGORIES: CompanyCategoryKey[] = ["independent", "other", "unclassified"];

export const DEFAULT_DISCOVERY_LIMIT = 120;

// Wall-clock budget for one runDiscovery() call, comfortably under the
// route's `maxDuration` (see src/app/api/hiring/discover/route.ts) so a
// pathological run (many slow/timing-out probes) degrades to "processed
// fewer companies than `limit`" instead of being hard-killed by the
// platform before the discovery_run row can be finalized — which would
// turn a slow run into an invisible one instead of a visible failure.
// Companies not reached in time are simply not recorded in company_probe,
// so they're picked up first by the next run (still the highest
// contact-count candidates not yet probed).
const DEFAULT_MAX_DURATION_MS = 240_000;

// Auto-approve rule: only when the evidence is strong enough that a human
// glance would almost certainly rubber-stamp it anyway. `slug === company
// key` means the guessed slug matches the normalized company key exactly
// with no transformation at all (this only happens for single-word company
// names, since multi-word keys always differ from every generated variant
// — see generateSlugVariants) — the least ambiguous kind of match. Combined
// with a real job count floor, this deliberately fires rarely: given the
// ~20%-false-positive experience with slug guessing, it's better to under-
// auto-approve and let a human clear the (much larger) 'pending' queue than
// to risk polluting target_company with a wrong-company board.
const AUTO_APPROVE_MIN_JOB_COUNT = 5;

// Per-request timeout for a single ATS probe. Short, because a wrong slug
// guess is the overwhelmingly common case (see the ~11% hit rate above) and
// most of those resolve as a fast 404 — a probe hanging past this is
// treated as a miss, not a run failure.
const PROBE_TIMEOUT_MS = 10_000;

// Small delay between sequential slug-variant rounds for the same company,
// to be polite to the ATS endpoints being guessed at (the 6 ATS within one
// round go to 6 different hosts, so they're probed concurrently — see
// probeCompany).
const SLUG_ROUND_DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Candidate source
// ---------------------------------------------------------------------

export interface CandidateCompany {
  companyKey: string;
  displayName: string;
  contactCount: number;
}

/**
 * Distinct company keys across ALL BDs' contacts (shared universe — public
 * company identity, not private contact data) that aren't already a target
 * company, haven't been probed in the last PROBE_COOLDOWN_DAYS, and aren't
 * exclusively low-signal categories — ordered by contact count descending
 * so the companies most worth having a board for are probed first.
 *
 * `company_category` is a deterministic function of `company_key` (see
 * normalizeCompanyKey), so in practice every contact row sharing a key has
 * the same category; `min(coalesce(...))` in the HAVING clause is just
 * picking that (expected-uniform) value, not a real aggregation. `mode()`
 * picks the most common raw `company` spelling for display purposes.
 *
 * One query, LIMIT applied in SQL — no per-company round trip.
 */
export async function getCandidateCompanies(
  limit: number,
): Promise<CandidateCompany[]> {
  const cooldownDate = new Date(Date.now() - PROBE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const excluded = sql.join(
    EXCLUDED_CATEGORIES.map((c) => sql`${c}`),
    sql`, `,
  );

  const rows = await db.execute<{
    company_key: string;
    display_name: string;
    contact_count: number;
  }>(sql`
    select
      c.company_key as company_key,
      mode() within group (order by c.company) as display_name,
      count(*)::int as contact_count
    from contact c
    where c.company_key is not null and c.company_key != ''
      and not exists (
        select 1 from target_company tc where tc.company_key = c.company_key
      )
      and not exists (
        select 1 from company_probe cp
        where cp.company_key = c.company_key and cp.last_probed_at >= ${cooldownDate}
      )
    group by c.company_key
    having min(coalesce(c.company_category, 'unclassified')) not in (${excluded})
    order by count(*) desc
    limit ${limit}
  `);

  return rows.map((r) => ({
    companyKey: r.company_key,
    displayName: r.display_name ?? r.company_key,
    contactCount: r.contact_count,
  }));
}

// ---------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------

// Extra words stripped after normalizeCompanyKey (which already handles
// ASCII-folding, punctuation and corporate suffixes — see
// src/lib/companyCategories.ts) — company display names on LinkedIn
// frequently tack on a country/region qualifier that's never part of the
// actual ATS slug (e.g. "Acme Argentina" -> board slug "acme").
const COUNTRY_WORD_RE = /\b(argentina|arg|latam|latinoamerica)\b/g;

/**
 * Up to 3 slug guesses for a normalized company key: the tokens joined with
 * no separator, the tokens joined with "-", and the first token alone when
 * it's long enough to plausibly be its own slug (short tokens like "la" or
 * "mp" are too ambiguous to try in isolation). Order matters: exact-key
 * variants are tried first since they're the ones eligible for
 * auto-approval (see upsertBoardCandidate).
 */
export function generateSlugVariants(companyKey: string): string[] {
  const cleaned = companyKey.replace(COUNTRY_WORD_RE, " ").replace(/\s+/g, " ").trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  if (!tokens.length) return [];

  const variants = new Set<string>();
  variants.add(tokens.join(""));
  variants.add(tokens.join("-"));
  if (tokens[0].length > 3) variants.add(tokens[0]);
  return [...variants].slice(0, 3);
}

// ---------------------------------------------------------------------
// ATS probes
// ---------------------------------------------------------------------

export type ProbeAts =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "recruitee"
  | "teamtailor";

interface ProbeSample {
  title: string;
  location?: string;
  url?: string;
}

interface ProbeHit {
  jobCount: number;
  samples: ProbeSample[];
}

type ProbeFn = (slug: string) => Promise<ProbeHit | null>;

/**
 * Wraps an existing JobSource adapter (greenhouse/lever/ashby/
 * smartrecruiters — already implemented in this directory) as a discovery
 * probe: reuses its fetch + normalize logic as-is rather than duplicating
 * it, and treats ANY thrown error (404 for a wrong slug, timeout, shape
 * drift) as a miss rather than letting it propagate — a wrong slug guess is
 * the expected, common case here, not a failure worth recording as one.
 * Also treats an empty result as a miss, which is what makes
 * SmartRecruiters' "HTTP 200 with `{ totalFound: 0, content: [] }` for any
 * slug" behavior harmless here: an empty array's `.length` is falsy
 * regardless of the 200 status, so it never becomes a hit.
 */
function adapterProbe(source: JobSource): ProbeFn {
  return async (slug) => {
    try {
      const postings = await source.fetchPostings({ slug });
      if (!postings.length) return null;
      return {
        jobCount: postings.length,
        samples: postings.slice(0, 3).map((p) => ({
          title: p.title,
          location: p.location || undefined,
          url: p.url || undefined,
        })),
      };
    } catch {
      return null;
    }
  };
}

/**
 * Recruitee's public offers feed. No dedicated, tested adapter exists for
 * it yet (unlike greenhouse/lever/ashby/smartrecruiters), so this is
 * discovery-only and best-effort — but the exact shape used below (`title`,
 * `location`, `careers_url` on each entry in `offers`) was confirmed live
 * against a real production Recruitee board during this change's
 * verification, not guessed from documentation. Any shape mismatch,
 * non-200, or missing title still falls through to a miss rather than a
 * false hit.
 */
async function probeRecruitee(slug: string): Promise<ProbeHit | null> {
  try {
    const res = await fetch(`https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const offers = (body as { offers?: unknown }).offers;
    if (!Array.isArray(offers) || !offers.length) return null;

    const samples: ProbeSample[] = [];
    for (const entry of offers) {
      if (samples.length >= 3) break;
      const title = (entry as { title?: unknown }).title;
      if (typeof title !== "string" || !title) continue;
      const location = (entry as { location?: unknown }).location;
      const url = (entry as { careers_url?: unknown }).careers_url;
      samples.push({
        title,
        location: typeof location === "string" ? location : undefined,
        url: typeof url === "string" ? url : undefined,
      });
    }
    if (!samples.length) return null;
    return { jobCount: offers.length, samples };
  } catch {
    return null;
  }
}

/**
 * Teamtailor's public jobs feed, confirmed live against a real board during
 * this change's verification: `https://{slug}.teamtailor.com/jobs.json` is
 * a JSON Feed (https://jsonfeed.org/) — `{ items: [{ id, title, url,
 * _jobposting: { jobLocation: [{ address: { addressLocality,
 * addressCountry } }] } }] }` — NOT a bare `jobs` array, which is the
 * shape an earlier draft of this probe guessed at incorrectly. Still
 * defensive about anything beyond that (a missing `_jobposting` or
 * `jobLocation` just means no location evidence, not a miss).
 */
async function probeTeamtailor(slug: string): Promise<ProbeHit | null> {
  try {
    const res = await fetch(`https://${encodeURIComponent(slug)}.teamtailor.com/jobs.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const items = (body as { items?: unknown }).items;
    if (!Array.isArray(items) || !items.length) return null;

    const samples: ProbeSample[] = [];
    for (const entry of items) {
      if (samples.length >= 3) break;
      const record = entry as {
        title?: unknown;
        url?: unknown;
        _jobposting?: { jobLocation?: { address?: { addressLocality?: unknown; addressCountry?: unknown } }[] };
      };
      const title = record.title;
      if (typeof title !== "string" || !title) continue;
      const address = record._jobposting?.jobLocation?.[0]?.address;
      const location = [address?.addressLocality, address?.addressCountry]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(", ");
      samples.push({
        title,
        location: location || undefined,
        url: typeof record.url === "string" ? record.url : undefined,
      });
    }
    if (!samples.length) return null;
    return { jobCount: items.length, samples };
  } catch {
    return null;
  }
}

/**
 * Probe registry keyed by ats. greenhouse/lever/ashby/smartrecruiters reuse
 * the existing adapters (see registry.ts for the sync-side equivalent);
 * recruitee/teamtailor have no adapter yet (see JOB_SOURCES in
 * registry.ts), so they get lightweight, discovery-only probes here rather
 * than full adapters — promoting one to a real adapter (for sync.ts to
 * also use) is future work once a board is actually confirmed on it.
 */
const PROBES: Record<ProbeAts, ProbeFn> = {
  greenhouse: adapterProbe(greenhouseSource),
  lever: adapterProbe(leverSource),
  ashby: adapterProbe(ashbySource),
  smartrecruiters: adapterProbe(smartRecruitersSource),
  recruitee: probeRecruitee,
  teamtailor: probeTeamtailor,
};

const PROBE_ORDER: ProbeAts[] = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "teamtailor",
];

// ---------------------------------------------------------------------
// target_company approval (shared by auto-approve and the manual review
// server actions — see src/app/discovery/actions.ts)
// ---------------------------------------------------------------------

/**
 * Inserts/updates the target_company row for an approved candidate so the
 * existing daily sync (src/lib/hiring/sync.ts, via vercel.json's cron)
 * picks it up with no extra wiring. `countryFilter` is hardcoded to "AR" —
 * this app's tracked hiring signals are scoped to Argentina-based roles
 * (see src/lib/hiring/countryFilter.ts) for every target company seeded so
 * far; revisit if a future candidate should track a different country.
 */
export async function approveAsTargetCompany(
  companyKey: string,
  displayName: string,
  ats: string,
  slug: string,
): Promise<void> {
  await db
    .insert(targetCompany)
    .values({
      companyKey,
      displayName,
      ats,
      config: { slug },
      countryFilter: "AR",
      active: true,
    })
    .onConflictDoUpdate({
      target: targetCompany.companyKey,
      set: {
        displayName: sql`excluded.display_name`,
        ats: sql`excluded.ats`,
        config: sql`excluded.config`,
        countryFilter: sql`excluded.country_filter`,
        active: true,
      },
    });
}

// ---------------------------------------------------------------------
// Probing + persistence
// ---------------------------------------------------------------------

async function upsertBoardCandidate(
  company: CandidateCompany,
  ats: ProbeAts,
  slug: string,
  hit: ProbeHit,
): Promise<void> {
  const now = new Date();
  const isStrongMatch = slug === company.companyKey && hit.jobCount >= AUTO_APPROVE_MIN_JOB_COUNT;
  const status: "pending" | "auto_approved" = isStrongMatch ? "auto_approved" : "pending";

  const evidence = {
    locations: [...new Set(hit.samples.map((s) => s.location).filter((l): l is string => Boolean(l)))],
    jobUrls: hit.samples.map((s) => s.url).filter((u): u is string => Boolean(u)),
  };

  await db
    .insert(boardCandidate)
    .values({
      companyKey: company.companyKey,
      displayName: company.displayName,
      ats,
      slug,
      status,
      jobCount: hit.jobCount,
      sampleTitles: hit.samples.map((s) => s.title),
      evidence,
      contactCount: company.contactCount,
      discoveredAt: now,
      decidedAt: status === "auto_approved" ? now : null,
      decidedBy: status === "auto_approved" ? "system:auto_approve" : null,
    })
    .onConflictDoUpdate({
      target: [boardCandidate.ats, boardCandidate.slug],
      set: {
        // Refresh evidence on a re-hit, but NEVER touch status/decidedAt/
        // decidedBy here — a human (or a prior auto-approve) may have
        // already decided this candidate, and a later probe re-confirming
        // the same board must not silently revert that decision.
        displayName: sql`excluded.display_name`,
        jobCount: sql`excluded.job_count`,
        sampleTitles: sql`excluded.sample_titles`,
        evidence: sql`excluded.evidence`,
        contactCount: sql`excluded.contact_count`,
      },
    });

  if (status === "auto_approved") {
    await approveAsTargetCompany(company.companyKey, company.displayName, ats, slug);
  }
}

async function recordProbe(companyKey: string, hit: boolean): Promise<void> {
  await db
    .insert(companyProbe)
    .values({ companyKey, lastProbedAt: new Date(), attempts: 1, hit })
    .onConflictDoUpdate({
      target: companyProbe.companyKey,
      set: {
        lastProbedAt: sql`excluded.last_probed_at`,
        attempts: sql`${companyProbe.attempts} + 1`,
        hit: sql`excluded.hit`,
      },
    });
}

/**
 * Probes one company across up to 3 slug variants, one round at a time; all
 * 6 ATS within a round run concurrently (they're 6 different hosts, so this
 * is a latency win, not a politeness problem — see SLUG_ROUND_DELAY_MS for
 * the actual politeness delay, applied between rounds). Stops at the first
 * round that produces any hit — once a company's board is found, further
 * slug guesses for it add cost without adding value. Every hit found in the
 * winning round is recorded (a company can legitimately have boards on more
 * than one ATS, though that's rare).
 *
 * Never throws: every probe already swallows its own errors (see
 * adapterProbe/probeRecruitee/probeTeamtailor above), so a bad guess is
 * just a miss.
 */
async function probeCompany(company: CandidateCompany): Promise<boolean> {
  const slugs = generateSlugVariants(company.companyKey);
  let anyHit = false;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const results = await Promise.all(
      PROBE_ORDER.map(async (ats) => ({ ats, hit: await PROBES[ats](slug) })),
    );
    for (const { ats, hit } of results) {
      if (!hit) continue;
      anyHit = true;
      await upsertBoardCandidate(company, ats, slug, hit);
    }
    if (anyHit) break;
    if (i < slugs.length - 1 && SLUG_ROUND_DELAY_MS > 0) {
      await sleep(SLUG_ROUND_DELAY_MS);
    }
  }

  return anyHit;
}

// ---------------------------------------------------------------------
// Run orchestration
// ---------------------------------------------------------------------

export interface DiscoveryRunOptions {
  limit?: number;
  maxDurationMs?: number;
}

export interface DiscoveryRunResult {
  companiesProbed: number;
  hits: number;
  status: "ok" | "error";
  error?: string;
}

/**
 * Runs one discovery pass: pulls up to `limit` candidate companies
 * (highest contact count first, see getCandidateCompanies), probes each,
 * and records the outcome. Bounded by both `limit` and a wall-clock
 * deadline (see DEFAULT_MAX_DURATION_MS) so a run degrades gracefully
 * inside a Vercel function's time budget rather than being hard-killed —
 * either bound can leave candidates unprobed, and that's fine: they simply
 * aren't recorded in company_probe, so the next run's candidate query picks
 * them up again (still ordered by contact count, so nothing is lost, only
 * deferred).
 *
 * A single company's failure never aborts the run (mirrors
 * syncAllCompanies's contract in sync.ts) — probeCompany already never
 * throws, and the try/catch below exists only to guard against a genuinely
 * unexpected bug (e.g. a transient DB write failure) doing the same.
 */
export async function runDiscovery(
  options: DiscoveryRunOptions = {},
): Promise<DiscoveryRunResult> {
  const limit = options.limit ?? DEFAULT_DISCOVERY_LIMIT;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const startedAt = new Date();
  const deadline = Date.now() + maxDurationMs;

  const [{ id: runId }] = await db
    .insert(discoveryRun)
    .values({ startedAt, status: "ok" })
    .returning({ id: discoveryRun.id });

  let companiesProbed = 0;
  let hits = 0;

  try {
    const candidates = await getCandidateCompanies(limit);

    for (const candidate of candidates) {
      if (Date.now() >= deadline) break;

      try {
        companiesProbed++;
        const hit = await probeCompany(candidate);
        if (hit) hits++;
        await recordProbe(candidate.companyKey, hit);
      } catch {
        // Defensive only — see function doc above. The company is still
        // counted as probed; if its company_probe row failed to write, the
        // cooldown window simply won't apply to it and it'll be retried
        // (probed twice) on the next run, which is harmless.
      }
    }

    await db
      .update(discoveryRun)
      .set({ finishedAt: new Date(), companiesProbed, hits, status: "ok" })
      .where(eq(discoveryRun.id, runId));

    return { companiesProbed, hits, status: "ok" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .update(discoveryRun)
      .set({ finishedAt: new Date(), companiesProbed, hits, status: "error", error })
      .where(eq(discoveryRun.id, runId));
    return { companiesProbed, hits, status: "error", error };
  }
}

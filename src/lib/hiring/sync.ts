import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  jobPosting,
  syncRun,
  targetCompany,
  type TargetCompany,
} from "@/db/schema";
import { JOB_SOURCES } from "./registry";
import type { AtsKey } from "./registry";
import { isItPosting } from "./classify";
import { matchesCountry } from "./countryFilter";

export interface SyncResult {
  companyKey: string;
  status: "ok" | "error";
  fetched: number;
  created: number;
  closed: number;
  error?: string;
}

async function recordSyncRun(
  companyKey: string,
  startedAt: Date,
  result: Omit<SyncResult, "companyKey">,
): Promise<void> {
  await db.insert(syncRun).values({
    companyKey,
    startedAt,
    finishedAt: new Date(),
    status: result.status,
    fetched: result.fetched,
    created: result.created,
    closed: result.closed,
    error: result.error ?? null,
  });
}

/**
 * Sync one target company: fetch postings from its ATS, filter to IT +
 * country, upsert them, and close postings no longer seen. Idempotent and
 * safe to re-run — never throws; failures are captured in the returned
 * result and in a sync_run row so one company's failure doesn't affect the
 * others (see syncAllCompanies).
 */
export async function syncCompany(company: TargetCompany): Promise<SyncResult> {
  const startedAt = new Date();
  const source = JOB_SOURCES[company.ats as AtsKey];

  if (!source) {
    const error = `No adapter registered for ats "${company.ats}"`;
    await recordSyncRun(company.companyKey, startedAt, {
      status: "error",
      fetched: 0,
      created: 0,
      closed: 0,
      error,
    });
    return { companyKey: company.companyKey, status: "error", fetched: 0, created: 0, closed: 0, error };
  }

  try {
    const raw = await source.fetchPostings(company.config);
    // Track every externalId actually returned by the ATS this run, before
    // the country filter runs. Closing is keyed off this set (see below) so
    // postings that are filtered out (e.g. blank/foreign location) are never
    // closed just because they didn't make it into `filtered` — they're
    // still live upstream, we just don't display them.
    const seenExternalIds = new Set(raw.map((p) => p.externalId));
    const filtered = raw.filter((p) => matchesCountry(p.location, company.countryFilter));

    let created = 0;
    if (filtered.length) {
      const externalIds = filtered.map((p) => p.externalId);
      const existing = await db
        .select({ externalId: jobPosting.externalId })
        .from(jobPosting)
        .where(
          and(
            eq(jobPosting.companyKey, company.companyKey),
            inArray(jobPosting.externalId, externalIds),
          ),
        );
      const existingIds = new Set(existing.map((e) => e.externalId));
      created = filtered.filter((p) => !existingIds.has(p.externalId)).length;

      const rows = filtered.map((p) => ({
        companyKey: company.companyKey,
        externalId: p.externalId,
        title: p.title,
        location: p.location,
        url: p.url,
        department: p.department ?? null,
        postedAt: p.postedAt ?? null,
        isIt: isItPosting(p.title),
        lastSeen: startedAt,
      }));

      await db
        .insert(jobPosting)
        .values(rows)
        .onConflictDoUpdate({
          target: [jobPosting.companyKey, jobPosting.externalId],
          set: {
            title: sql`excluded.title`,
            location: sql`excluded.location`,
            url: sql`excluded.url`,
            department: sql`excluded.department`,
            postedAt: sql`excluded.posted_at`,
            isIt: sql`excluded.is_it`,
            lastSeen: sql`excluded.last_seen`,
            // A posting that reappears after being marked closed is reopened.
            closedAt: sql`null`,
          },
        });
    }

    // Closing is keyed off `seenExternalIds` (the raw ATS response), NOT off
    // the country-filtered list — a posting that got filtered out (e.g.
    // blank location) is still live upstream and must not be closed, only
    // skipped for insert/update above. An empty raw response is almost
    // always a transient fetch problem on the ATS side rather than "this
    // company closed every posting", so we never close anything in that
    // case — doing so would mass-close every open posting for the company.
    let closedCount = 0;
    let note: string | undefined;
    if (raw.length === 0) {
      note = "empty response — closing skipped";
    } else {
      const closedRows = await db
        .update(jobPosting)
        .set({ closedAt: startedAt })
        .where(
          and(
            eq(jobPosting.companyKey, company.companyKey),
            isNull(jobPosting.closedAt),
            notInArray(jobPosting.externalId, [...seenExternalIds]),
          ),
        )
        .returning({ id: jobPosting.id });
      closedCount = closedRows.length;
    }

    const result: SyncResult = {
      companyKey: company.companyKey,
      status: "ok",
      fetched: raw.length,
      created,
      closed: closedCount,
      ...(note ? { error: note } : {}),
    };
    await recordSyncRun(company.companyKey, startedAt, result);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await recordSyncRun(company.companyKey, startedAt, {
      status: "error",
      fetched: 0,
      created: 0,
      closed: 0,
      error,
    });
    return { companyKey: company.companyKey, status: "error", fetched: 0, created: 0, closed: 0, error };
  }
}

/**
 * Sync every active target company, sequentially (with a small delay
 * between companies to be polite to their ATS endpoints). A single
 * company's failure is recorded and skipped — it never aborts the rest of
 * the run (syncCompany itself never throws).
 */
export async function syncAllCompanies(delayMs = 500): Promise<SyncResult[]> {
  const companies = await db
    .select()
    .from(targetCompany)
    .where(eq(targetCompany.active, true));

  const results: SyncResult[] = [];
  for (const company of companies) {
    results.push(await syncCompany(company));
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boardCandidate, discoveryRun, type DiscoveryRun } from "@/db/schema";
import type { ProbeAts } from "./discovery";

/**
 * Where a human reviewer can click through to look at a candidate board.
 * Best-effort, mirrors the public URL shape each ATS advertises for its
 * own boards — not guaranteed to be exactly right for every account, but
 * good enough as a starting point for a one-click sanity check.
 */
export function boardUrlFor(ats: string, slug: string): string {
  const s = encodeURIComponent(slug);
  switch (ats as ProbeAts) {
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${s}`;
    case "lever":
      return `https://jobs.lever.co/${s}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${s}`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${s}`;
    case "recruitee":
      return `https://${s}.recruitee.com`;
    case "teamtailor":
      return `https://${s}.teamtailor.com`;
    default:
      return "";
  }
}

export interface DiscoveryQueueItem {
  id: string;
  companyKey: string;
  displayName: string;
  ats: string;
  slug: string;
  jobCount: number;
  sampleTitles: string[];
  // Aggregate across ALL BDs, snapshotted when this candidate was
  // discovered/last re-hit — NOT the viewing BD's own contact count. See
  // the table comment on board_candidate in src/db/schema.ts.
  contactCount: number;
  boardUrl: string;
  discoveredAt: Date;
}

/**
 * Pending candidates for human review, highest team contact-count first —
 * shared data (public company boards), not scoped to the viewing BD. One
 * fixed query.
 */
export async function getPendingCandidates(): Promise<DiscoveryQueueItem[]> {
  const rows = await db
    .select()
    .from(boardCandidate)
    .where(eq(boardCandidate.status, "pending"))
    .orderBy(desc(boardCandidate.contactCount));

  return rows.map((r) => ({
    id: r.id,
    companyKey: r.companyKey,
    displayName: r.displayName,
    ats: r.ats,
    slug: r.slug,
    jobCount: r.jobCount,
    sampleTitles: Array.isArray(r.sampleTitles) ? (r.sampleTitles as string[]) : [],
    contactCount: r.contactCount,
    boardUrl: boardUrlFor(r.ats, r.slug),
    discoveredAt: r.discoveredAt,
  }));
}

export interface DiscoveryStatusCounts {
  pending: number;
  approved: number;
  rejected: number;
}

/**
 * Counts of candidates by review status, folding 'auto_approved' into
 * 'approved' for display (both mean "counts toward target_company now" —
 * see src/lib/hiring/discovery.ts). One fixed query (GROUP BY), regardless
 * of how many candidates exist.
 */
export async function getDiscoveryStatusCounts(): Promise<DiscoveryStatusCounts> {
  const rows = await db
    .select({ status: boardCandidate.status, count: sql<number>`count(*)::int` })
    .from(boardCandidate)
    .groupBy(boardCandidate.status);

  const counts: DiscoveryStatusCounts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of rows) {
    if (row.status === "pending") counts.pending += row.count;
    else if (row.status === "approved" || row.status === "auto_approved") counts.approved += row.count;
    else if (row.status === "rejected") counts.rejected += row.count;
  }
  return counts;
}

/**
 * The most recent discovery_run row, so a silent failure (or a run that
 * quietly probed 0 companies) is visible on /discovery instead of just...
 * not showing up. One fixed query.
 */
export async function getLastDiscoveryRun(): Promise<DiscoveryRun | undefined> {
  const rows = await db
    .select()
    .from(discoveryRun)
    .orderBy(desc(discoveryRun.startedAt))
    .limit(1);
  return rows[0];
}

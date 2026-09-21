import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { companyAlias, contact, jobPosting, syncRun, targetCompany } from "@/db/schema";
import { resolveHiringCompanies } from "@/lib/hiring/queries";
import type { MarketKey } from "@/lib/hiring/markets";
import { isDormant } from "@/lib/queries";
import {
  compareOutreachRows,
  isLeadershipRoleGroup,
  relationshipTierOf,
  type OutreachRow,
} from "@/lib/outreach/queries";
import type { RoleGroupKey } from "@/lib/roleGroups";

// Selectable "what changed since I last looked?" windows, in days.
export const WHATS_NEW_WINDOWS = [7, 14, 30] as const;
export type WhatsNewWindow = (typeof WHATS_NEW_WINDOWS)[number];
export const DEFAULT_WHATS_NEW_WINDOW: WhatsNewWindow = 7;

/** Validate an arbitrary `?window=` query param against the allowed set. */
export function parseWhatsNewWindow(value: string | undefined): WhatsNewWindow {
  const n = Number(value);
  return (WHATS_NEW_WINDOWS as readonly number[]).includes(n)
    ? (n as WhatsNewWindow)
    : DEFAULT_WHATS_NEW_WINDOW;
}

export interface WhatsNewPosting {
  id: string;
  title: string;
  location: string;
  url: string;
  postedAt: Date | null;
  firstSeen: Date;
}

export interface SuggestedContact {
  id: string;
  name: string | null;
  position: string | null;
  roleGroup: RoleGroupKey | null;
  isLeadership: boolean;
}

export interface WhatsNewCompanyGroup {
  companyKey: string;
  displayName: string;
  newPostingCount: number;
  openItCount: number;
  // The signed-in BD's own contacts at this company (shared postings data,
  // BD-scoped counts — see getWhatsNewFeed below).
  contactCount: number;
  leadershipContactCount: number;
  restContactCount: number;
  newPostings: WhatsNewPosting[];
  suggestedContacts: SuggestedContact[];
  // See CompanyHiringSummary.offshoreItCount/latamItCount/offshoreHeavy in
  // src/lib/hiring/queries.ts — same derived signal, carried through
  // resolveHiringCompanies (no extra query, no re-derivation).
  offshoreItCount: number;
  latamItCount: number;
  offshoreHeavy: boolean;
}

export interface WhatsNewClosure {
  id: string;
  companyKey: string;
  displayName: string;
  title: string;
  location: string;
  closedAt: Date;
}

export interface WhatsNewFeed {
  windowDays: WhatsNewWindow;
  companies: WhatsNewCompanyGroup[];
  closures: WhatsNewClosure[];
  // Shared sync/target-company facts, not BD-scoped — see getSyncStatus.
  monitoredCompanyCount: number;
  hasAnySyncRun: boolean;
  lastSuccessfulSyncAt: Date | null;
}

interface SyncStatus {
  hasAnySyncRun: boolean;
  lastSuccessfulSyncAt: Date | null;
  monitoredCompanyCount: number;
}

/**
 * Shared, non-BD-scoped facts used to tell the three "why is this page
 * empty?" cases apart: no target companies seeded, target companies seeded
 * but no sync has ever run, or synced with nothing new in the window. One
 * query with three scalar subqueries instead of three round trips.
 */
async function getSyncStatus(): Promise<SyncStatus> {
  // Raw `db.execute` skips drizzle's column mappers, so a timestamp comes
  // back as a string (or a Date, depending on the driver) — it must be
  // normalized here, or Intl formatting throws "Invalid time value".
  const rows = await db.execute<{
    monitoredCompanyCount: number;
    totalSyncRuns: number;
    lastSuccessfulSyncAt: Date | string | null;
  }>(sql`
    select
      (select count(*)::int from ${targetCompany} where ${targetCompany.active} = true) as "monitoredCompanyCount",
      (select count(*)::int from ${syncRun}) as "totalSyncRuns",
      (select max(${syncRun.finishedAt}) from ${syncRun} where ${syncRun.status} = 'ok') as "lastSuccessfulSyncAt"
  `);
  const row = rows[0];
  const lastSync = row?.lastSuccessfulSyncAt ?? null;
  const lastSyncDate = lastSync ? new Date(lastSync) : null;
  return {
    hasAnySyncRun: (row?.totalSyncRuns ?? 0) > 0,
    lastSuccessfulSyncAt:
      lastSyncDate && !Number.isNaN(lastSyncDate.getTime()) ? lastSyncDate : null,
    monitoredCompanyCount: row?.monitoredCompanyCount ?? 0,
  };
}

interface ContactForRanking {
  id: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  roleGroup: string | null;
  messageCount: number;
  lastMessageAt: Date | null;
  reciprocal: boolean;
  canonicalCompanyKey: string;
}

/**
 * Up to `limit` people to suggest reaching out to at one company, ranked
 * with the exact same rule /outreach uses (see compareOutreachRows in
 * src/lib/outreach/queries.ts) rather than a second scoring rule: dormant
 * reciprocal first, then active reciprocal, then leadership seniority, then
 * hiring urgency, then the offshore-heavy tiebreak (all constant across
 * this group, since it's one company).
 */
function buildSuggestedContacts(
  companyContacts: ContactForRanking[],
  companyDisplayName: string,
  openItCount: number,
  offshoreItCount: number,
  latamItCount: number,
  offshoreHeavy: boolean,
  limit = 3,
): SuggestedContact[] {
  const ranked: OutreachRow[] = companyContacts.map((c) => {
    const dormant = isDormant(c.reciprocal, c.lastMessageAt);
    const roleGroup = (c.roleGroup ?? null) as RoleGroupKey | null;
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      company: companyDisplayName,
      position: c.position,
      roleGroup,
      messageCount: c.messageCount,
      lastMessageAt: c.lastMessageAt,
      reciprocal: c.reciprocal,
      dormant,
      isLeadership: isLeadershipRoleGroup(c.roleGroup),
      relationshipTier: relationshipTierOf(c.reciprocal, dormant, c.messageCount),
      companyDisplayName,
      openItCount,
      offshoreItCount,
      latamItCount,
      offshoreHeavy,
      // /whats-new doesn't surface the startup signal (no UI for it here),
      // but OutreachRow/compareOutreachRows are shared with /outreach — see
      // the function comment above — so these are just unused nulls, not a
      // real lookup.
      isStartup: null,
      startupReason: null,
    };
  });
  ranked.sort(compareOutreachRows);
  return ranked.slice(0, limit).map((r) => ({
    id: r.id,
    name: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
    position: r.position,
    roleGroup: r.roleGroup,
    isLeadership: r.isLeadership,
  }));
}

/**
 * "What changed since I last looked?" feed for one BD: IT postings first
 * seen in the last `windowDays`, grouped by company, plus a compact
 * closures list for the same window.
 *
 * Exactly 5 fixed queries regardless of how many companies/postings/contacts
 * exist (not counting getCurrentBd(), reused as-is from the caller):
 *  1. getSyncStatus() above (one round trip, three scalar subqueries).
 *  2-3. resolveHiringCompanies() from src/lib/hiring/queries.ts, reused
 *     as-is (open IT postings joined with target_company, plus the
 *     company_alias rows for those companies) — shared, not BD-scoped.
 *  4. Closed IT postings in the window, joined with target_company —
 *     shared, not BD-scoped.
 *  5. This BD's own contacts at any company touched by 2-4, resolved
 *     through company_alias in the same query (a contact's free-text
 *     company doesn't always normalize to the target company's own key —
 *     same rationale as companyKeyFilter in src/lib/queries.ts) — BD-scoped
 *     via `eq(contact.bdId, bdId)`.
 * Grouping, the leadership/rest split, and the suggested-contacts ranking
 * all happen in JS over those five result sets — no per-company or
 * per-posting query. `market` and `miamiOnly`, when set, narrow queries 2-3
 * (via resolveHiringCompanies) and query 4 with a SQL WHERE condition each;
 * `hideOffshore` narrows queries 2-3 the same way (it only ever means
 * "currently has an open offshore posting", which doesn't apply to already
 * -closed rows in query 4) — the query count stays exactly 5 either way.
 */
export async function getWhatsNewFeed(
  bdId: string,
  windowDays: WhatsNewWindow,
  market?: MarketKey,
  miamiOnly?: boolean,
  hideOffshore?: boolean,
): Promise<WhatsNewFeed> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [syncStatus, openCompanies, closedRows] = await Promise.all([
    getSyncStatus(), // query 1
    resolveHiringCompanies(market, miamiOnly, hideOffshore), // queries 2-3 (shared, not BD-scoped)
    db // query 4 (shared, not BD-scoped)
      .select({
        id: jobPosting.id,
        companyKey: jobPosting.companyKey,
        displayName: targetCompany.displayName,
        title: jobPosting.title,
        location: jobPosting.location,
        closedAt: jobPosting.closedAt,
      })
      .from(jobPosting)
      .innerJoin(targetCompany, eq(jobPosting.companyKey, targetCompany.companyKey))
      .where(
        and(
          eq(jobPosting.isIt, true),
          isNotNull(jobPosting.closedAt),
          gte(jobPosting.closedAt, cutoff),
          market ? eq(jobPosting.market, market) : undefined,
          miamiOnly ? eq(jobPosting.isMiami, true) : undefined,
        ),
      )
      .orderBy(desc(jobPosting.closedAt)),
  ]);

  const newByCompany = new Map<
    string,
    {
      displayName: string;
      openItCount: number;
      newPostings: WhatsNewPosting[];
      offshoreItCount: number;
      latamItCount: number;
      offshoreHeavy: boolean;
    }
  >();
  for (const c of openCompanies.values()) {
    const newPostings = c.postings.filter((p) => p.firstSeen >= cutoff);
    if (!newPostings.length) continue;
    newByCompany.set(c.companyKey, {
      displayName: c.displayName,
      openItCount: c.postings.length,
      newPostings,
      offshoreItCount: c.offshoreItCount,
      latamItCount: c.latamItCount,
      offshoreHeavy: c.offshoreHeavy,
    });
  }

  const relevantCompanyKeys = [
    ...new Set([...newByCompany.keys(), ...closedRows.map((r) => r.companyKey)]),
  ];

  // BD-scoped: this is the only query in this function filtered by bdId —
  // job postings and target companies above are shared, cross-BD data.
  const contactsByCompany = new Map<string, ContactForRanking[]>();
  if (relevantCompanyKeys.length) {
    // Same alias-resolution idea as companyKeyFilter in src/lib/queries.ts,
    // generalized to a set of canonical keys instead of one: a contact's
    // free-text company_key may itself be an alias of one of these target
    // companies rather than the canonical key.
    const canonicalKeyExpr = sql<string>`coalesce(
      (select ${companyAlias.companyKey} from ${companyAlias} where ${companyAlias.aliasKey} = ${contact.companyKey}),
      ${contact.companyKey}
    )`;
    const rows = await db // query 5 — BD-scoped
      .select({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        position: contact.position,
        roleGroup: contact.roleGroup,
        messageCount: contact.messageCount,
        lastMessageAt: contact.lastMessageAt,
        reciprocal: contact.reciprocal,
        canonicalCompanyKey: canonicalKeyExpr,
      })
      .from(contact)
      .where(and(eq(contact.bdId, bdId), inArray(canonicalKeyExpr, relevantCompanyKeys)));

    for (const r of rows) {
      const list = contactsByCompany.get(r.canonicalCompanyKey) ?? [];
      list.push(r);
      contactsByCompany.set(r.canonicalCompanyKey, list);
    }
  }

  const companies: WhatsNewCompanyGroup[] = [...newByCompany.entries()].map(
    ([companyKey, info]) => {
      const companyContacts = contactsByCompany.get(companyKey) ?? [];
      const leadershipContactCount = companyContacts.filter((c) =>
        isLeadershipRoleGroup(c.roleGroup),
      ).length;
      return {
        companyKey,
        displayName: info.displayName,
        newPostingCount: info.newPostings.length,
        openItCount: info.openItCount,
        contactCount: companyContacts.length,
        leadershipContactCount,
        restContactCount: companyContacts.length - leadershipContactCount,
        newPostings: info.newPostings,
        suggestedContacts: buildSuggestedContacts(
          companyContacts,
          info.displayName,
          info.openItCount,
          info.offshoreItCount,
          info.latamItCount,
          info.offshoreHeavy,
        ),
        offshoreItCount: info.offshoreItCount,
        latamItCount: info.latamItCount,
        offshoreHeavy: info.offshoreHeavy,
      };
    },
  );

  // Companies where the BD already has contacts first (the actionable
  // signal), then by how much is new there — mirrors the ordering rule in
  // getCompanyHiringSummaries (src/lib/hiring/queries.ts). An offshore-heavy
  // company (see isOffshoreHeavy in src/lib/hiring/markets.ts) is the
  // lowest-priority tiebreak, same rationale as there.
  companies.sort((a, b) => {
    const aHas = a.contactCount > 0 ? 1 : 0;
    const bHas = b.contactCount > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    if (a.newPostingCount !== b.newPostingCount) return b.newPostingCount - a.newPostingCount;
    if (a.offshoreHeavy !== b.offshoreHeavy) return a.offshoreHeavy ? 1 : -1;
    return 0;
  });

  // Secondary signal: only surface closures at companies where the BD has
  // contacts — a closed posting at a company with no contacts isn't a
  // signal this BD can act on.
  const closures: WhatsNewClosure[] = closedRows
    .filter((r) => (contactsByCompany.get(r.companyKey)?.length ?? 0) > 0)
    .map((r) => ({
      id: r.id,
      companyKey: r.companyKey,
      displayName: r.displayName,
      title: r.title,
      location: r.location,
      closedAt: r.closedAt as Date,
    }));

  return {
    windowDays,
    companies,
    closures,
    monitoredCompanyCount: syncStatus.monitoredCompanyCount,
    hasAnySyncRun: syncStatus.hasAnySyncRun,
    lastSuccessfulSyncAt: syncStatus.lastSuccessfulSyncAt,
  };
}

import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contact } from "@/db/schema";
import { DORMANT_MONTHS, isDormant } from "@/lib/queries";
import {
  getHiringMatchIndex,
  LEADERSHIP_ROLE_GROUPS,
  type HiringMatch,
} from "@/lib/hiring/queries";
import type { RoleGroupKey } from "@/lib/roleGroups";
import type { Dictionary } from "@/lib/i18n/dictionaries";

// Relationship tiers, highest outreach priority first. Kept as an explicit
// enum (rather than a single opaque "score") so every row's rank traces
// back to a named, explainable bucket — see buildReasons() in
// src/app/outreach/page.tsx.
export const RELATIONSHIP_TIERS = [
  "dormant", // reciprocal, but no message in DORMANT_MONTHS+
  "reciprocal_recent", // reciprocal, active
  "contacted_no_reply", // messaged, but never reciprocal
  "never_messaged", // no messages at all — only ranked in when opted in
] as const;
export type RelationshipTier = (typeof RELATIONSHIP_TIERS)[number];

function relationshipTierOf(
  reciprocal: boolean,
  dormant: boolean,
  messageCount: number,
): RelationshipTier {
  if (reciprocal && dormant) return "dormant";
  if (reciprocal) return "reciprocal_recent";
  if (messageCount > 0) return "contacted_no_reply";
  return "never_messaged";
}

const TIER_RANK: Record<RelationshipTier, number> = {
  dormant: 0,
  reciprocal_recent: 1,
  contacted_no_reply: 2,
  never_messaged: 3,
};

export interface OutreachFilters {
  roleGroup?: RoleGroupKey;
  // Whether "never messaged" contacts are included at all (they always
  // rank last when they are). Default true.
  includeNeverMessaged?: boolean;
}

export interface OutreachRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  roleGroup: RoleGroupKey | null;
  messageCount: number;
  lastMessageAt: Date | null;
  reciprocal: boolean;
  dormant: boolean;
  isLeadership: boolean;
  relationshipTier: RelationshipTier;
  // Hiring signal for this contact's company, resolved via the same
  // alias-aware match used on /hiring (see getHiringMatchIndex).
  companyDisplayName: string;
  openItCount: number;
}

export interface OutreachPage {
  rows: OutreachRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  // Distinct companies currently hiring IT, regardless of whether the BD
  // has any contacts there — lets the empty state distinguish "nothing
  // synced yet" from "synced, but no matching contacts".
  hiringCompanyCount: number;
}

function compareOutreachRows(a: OutreachRow, b: OutreachRow): number {
  // 1. Relationship tier: dormant reciprocal contacts first, cold
  // never-messaged contacts last.
  const tierDiff = TIER_RANK[a.relationshipTier] - TIER_RANK[b.relationshipTier];
  if (tierDiff !== 0) return tierDiff;

  // 2. Seniority: leadership role groups outrank everyone else within the
  // same relationship tier.
  if (a.isLeadership !== b.isLeadership) return a.isLeadership ? -1 : 1;

  // 3. More open IT roles at the company = more urgent to reach out.
  if (a.openItCount !== b.openItCount) return b.openItCount - a.openItCount;

  // 4. Tiebreak on recency: for dormant contacts, the longest-overdue goes
  // first (oldest last contact); for everyone else, the most recently
  // active goes first.
  const at = a.lastMessageAt?.getTime() ?? 0;
  const bt = b.lastMessageAt?.getTime() ?? 0;
  if (at !== bt) return a.relationshipTier === "dormant" ? at - bt : bt - at;

  return (a.lastName ?? "").localeCompare(b.lastName ?? "");
}

function isLeadershipRoleGroup(roleGroup: string | null): boolean {
  return !!roleGroup && (LEADERSHIP_ROLE_GROUPS as readonly string[]).includes(roleGroup);
}

/**
 * Ranked "who should I message this week?" list for one BD: contacts whose
 * company is currently hiring IT, ordered by relationship strength then
 * seniority then hiring urgency (see compareOutreachRows).
 *
 * Exactly 3 fixed queries regardless of page number or total contact count:
 * (1)+(2) the two queries behind getHiringMatchIndex (open postings,
 * aliases — shared with /hiring, not BD-scoped), and (3) one `contact`
 * query scoped to `bd_id = bdId` and pre-filtered to only companies with an
 * open IT posting, so the row count stays bounded by the hiring crossover
 * rather than the full contact base. Scoring, sorting and pagination happen
 * in JS over that single fetched set — no per-row or per-page query.
 */
export async function listOutreachCandidates(
  bdId: string,
  filters: OutreachFilters = {},
  page = 1,
  pageSize = 25,
): Promise<OutreachPage> {
  const includeNeverMessaged = filters.includeNeverMessaged ?? true;

  const hiringIndex = await getHiringMatchIndex(); // queries 1-2
  const matchKeys = [...hiringIndex.keys()];
  const hiringCompanyCount = new Set(
    [...hiringIndex.values()].map((m) => m.companyKey),
  ).size;

  if (!matchKeys.length) {
    return { rows: [], total: 0, page: 1, pageSize, totalPages: 1, hiringCompanyCount: 0 };
  }

  const where = [eq(contact.bdId, bdId), inArray(contact.companyKey, matchKeys)];
  if (filters.roleGroup) where.push(eq(contact.roleGroup, filters.roleGroup));
  if (!includeNeverMessaged) where.push(gt(contact.messageCount, 0));

  const rows = await db // query 3
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      companyKey: contact.companyKey,
      position: contact.position,
      roleGroup: contact.roleGroup,
      messageCount: contact.messageCount,
      lastMessageAt: contact.lastMessageAt,
      reciprocal: contact.reciprocal,
    })
    .from(contact)
    .where(and(...where));

  const scored: OutreachRow[] = rows.map((r) => {
    const dormant = isDormant(r.reciprocal, r.lastMessageAt);
    const hiring: HiringMatch | undefined = r.companyKey
      ? hiringIndex.get(r.companyKey)
      : undefined;
    return {
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      company: r.company,
      position: r.position,
      roleGroup: (r.roleGroup ?? null) as RoleGroupKey | null,
      messageCount: r.messageCount,
      lastMessageAt: r.lastMessageAt,
      reciprocal: r.reciprocal,
      dormant,
      isLeadership: isLeadershipRoleGroup(r.roleGroup),
      relationshipTier: relationshipTierOf(r.reciprocal, dormant, r.messageCount),
      companyDisplayName: hiring?.displayName ?? r.company ?? "",
      openItCount: hiring?.openItCount ?? 0,
    };
  });

  scored.sort(compareOutreachRows);

  const total = scored.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = scored.slice((safePage - 1) * pageSize, safePage * pageSize);

  return {
    rows: pageRows,
    total,
    page: safePage,
    pageSize,
    totalPages,
    hiringCompanyCount,
  };
}

/** Human-readable reason chips for why a row is ranked where it is. */
export function outreachReasons(
  row: OutreachRow,
  relativeTime: (d: Date) => string,
  t: Dictionary,
): string[] {
  const reasons: string[] = [];

  switch (row.relationshipTier) {
    case "dormant":
      reasons.push(
        row.lastMessageAt
          ? t.outreach.reasonDormantSince(relativeTime(row.lastMessageAt), DORMANT_MONTHS)
          : t.outreach.reasonDormant,
      );
      break;
    case "reciprocal_recent":
      reasons.push(
        row.lastMessageAt
          ? t.outreach.reasonReciprocalActive(relativeTime(row.lastMessageAt))
          : t.outreach.reasonReciprocal,
      );
      break;
    case "contacted_no_reply":
      reasons.push(
        row.lastMessageAt
          ? t.outreach.reasonContactedNoReply(relativeTime(row.lastMessageAt))
          : t.outreach.reasonContactedNoReplyGeneric,
      );
      break;
    case "never_messaged":
      reasons.push(t.outreach.reasonNeverMessaged);
      break;
  }

  if (row.roleGroup) reasons.push(t.roleGroups[row.roleGroup]);

  reasons.push(
    t.outreach.reasonOpenRoles(
      row.companyDisplayName || row.company || t.outreach.companyFallback,
      row.openItCount,
    ),
  );

  return reasons;
}

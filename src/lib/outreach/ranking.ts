/**
 * Pure "who to contact next" ranking rule, split out of
 * src/lib/outreach/queries.ts (which imports `db`) so it can be reused and
 * unit-tested without a DB connection — same pattern as
 * src/lib/hiring/leadership.ts's split from src/lib/hiring/queries.ts.
 *
 * Owner decision 2026-09-26: the `/contacts` "Outreach" system view
 * (src/lib/contacts/outreachView.ts) must use the EXACT SAME order as
 * `/outreach` — importing these functions instead of re-deriving them is
 * what guarantees that, by construction.
 */
import { LEADERSHIP_ROLE_GROUPS } from "@/lib/hiring/leadership";
import type { HiringMatch } from "@/lib/hiring/queries";
import type { MarketKey } from "@/lib/hiring/markets";
import type { RoleGroupKey } from "@/lib/roleGroups";
import type { CompanyCategoryKey } from "@/lib/companyCategories";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export type { HiringMatch };

// Single source of truth for the "reciprocal but gone quiet" threshold —
// src/lib/queries.ts re-exports this (rather than defining its own) so
// isDormant() and outreachReasons() below can never drift apart.
export const DORMANT_MONTHS = 12;

// Relationship tiers, highest outreach priority first. Kept as an explicit
// enum (rather than a single opaque "score") so every row's rank traces
// back to a named, explainable bucket — see outreachReasons() below.
export const RELATIONSHIP_TIERS = [
  "dormant", // reciprocal, but no message in DORMANT_MONTHS+
  "reciprocal_recent", // reciprocal, active
  "contacted_no_reply", // messaged, but never reciprocal
  "never_messaged", // no messages at all — only ranked in when opted in
] as const;
export type RelationshipTier = (typeof RELATIONSHIP_TIERS)[number];

export function relationshipTierOf(
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
  // Restricts to contacts whose company falls in this industry category
  // (see src/lib/companyCategories.ts). Applied as a plain SQL WHERE on
  // `contact.company_category`, same as roleGroup below — no extra query.
  companyCategory?: CompanyCategoryKey;
  // Whether "never messaged" contacts are included at all (they always
  // rank last when they are). Default true.
  includeNeverMessaged?: boolean;
  // Restricts the hiring crossover to one market bucket (see
  // src/lib/hiring/markets.ts). Flows into getHiringMatchIndex's SQL WHERE
  // clause — undefined means "all markets" (today's behavior).
  market?: MarketKey;
  // Miami-metro sub-filter, only meaningful alongside `market: "us"` (see
  // src/lib/hiring/markets.ts#isMiamiArea). Flows into getHiringMatchIndex's
  // SQL WHERE clause — same query count either way.
  miamiOnly?: boolean;
  // Opt-in hide for contacts whose company is offshore-heavy (see
  // src/lib/hiring/markets.ts#isOffshoreHeavy). Off by default — see the
  // comment on resolveHiringCompanies' `hideOffshore` param in
  // src/lib/hiring/queries.ts. Flows into getHiringMatchIndex's SQL WHERE
  // clause — same query count either way.
  hideOffshore?: boolean;
  // Opt-in filter to only companies classified as startups (see
  // src/lib/hiring/startupClassification.ts). Off by default. Flows into
  // getHiringMatchIndex's SQL WHERE clause (via resolveHiringCompanies'
  // `startupsOnly` param) — same query count either way. An unclassified
  // company (is_startup IS NULL) is excluded when this is on, same as one
  // confirmed not a startup.
  startupsOnly?: boolean;
  // Free-text match on the contact's first or last name (case-insensitive,
  // substring). Applied as a plain SQL WHERE on `contact`, same as
  // roleGroup/companyCategory above — no extra query.
  name?: string;
}

export interface OutreachRow {
  id: string;
  // False for a teammate-exclusive Contact (see the `id` doc comment on
  // listOutreachCandidates in queries.ts): `id` then falls back to
  // `person.id`, which the still-bdId-scoped `/contact/[id]` page and
  // generateOutreachMessage don't resolve. UI callers use this explicit flag
  // to hide/disable those two actions instead of re-deriving it by
  // comparing ids.
  hasOwnContact: boolean;
  // The unified `person.id` (design D1) — the "view" link goes here for
  // every row now that `/contacts/[id]` (design D8) isn't `bdId`-scoped,
  // unlike the legacy `id` field above. Optional: src/lib/whatsnew/queries.ts
  // builds OutreachRow-shaped rows from the legacy `contact` table directly
  // (unmigrated read path) and has no unified id to put here yet.
  personId?: string;
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
  // This contact's company's open offshore vs. LATAM IT posting counts, and
  // the offshore-heavy verdict derived from them (see
  // HiringMatch.offshoreItCount/latamItCount/offshoreHeavy) — resolved via
  // the same alias-aware match as openItCount above. offshoreHeavy is a
  // deprioritizing signal only (see compareOutreachRows), never used to
  // drop the row; the two counts exist so the badge can show its basis.
  offshoreItCount: number;
  latamItCount: number;
  offshoreHeavy: boolean;
  // Startup classification for this contact's company (see
  // src/lib/hiring/startupClassification.ts), resolved via the same
  // alias-aware match as openItCount above. Null means "not classified
  // yet", distinct from a confirmed `false`. Shown as the "Startup" badge
  // on /outreach, with startupReason as its tooltip.
  isStartup: boolean | null;
  startupReason: string | null;
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

/**
 * Shared ranking rule for "who to contact at this company": dormant
 * reciprocal contacts first, then active reciprocal, then leadership
 * seniority, then hiring urgency — see the numbered steps below. Exported
 * so other views that need the same "who to suggest" idea (see
 * src/lib/whatsnew/queries.ts, src/lib/contacts/outreachView.ts) sort with
 * this comparator directly instead of re-deriving a second scoring rule.
 */
export function compareOutreachRows(a: OutreachRow, b: OutreachRow): number {
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

  // 5. Lowest-priority tiebreak: a contact whose company is offshore-heavy
  // (see src/lib/hiring/markets.ts#isOffshoreHeavy — strictly more open
  // offshore postings than LATAM ones) sorts after an otherwise-identical
  // one. Deliberately last among the substantive criteria — it must never
  // outrank relationship strength, seniority or hiring urgency above, only
  // break a tie once those are all equal.
  if (a.offshoreHeavy !== b.offshoreHeavy) return a.offshoreHeavy ? 1 : -1;

  return (a.lastName ?? "").localeCompare(b.lastName ?? "");
}

export function isLeadershipRoleGroup(roleGroup: string | null): boolean {
  return !!roleGroup && (LEADERSHIP_ROLE_GROUPS as readonly string[]).includes(roleGroup);
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

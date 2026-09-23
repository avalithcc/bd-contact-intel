import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bd, lead, leadSource, type NewLead } from "@/db/schema";
import type { LeadDraft } from "./csv";
import { isLeadStatusKey, type EmailStatusKey, type LeadStatusKey } from "./types";

// Cap on whitespace-separated search tokens in the free-text name filter, so
// a pathological paste-in doesn't blow up the query into dozens of OR'd
// conditions — same convention as src/lib/queries.ts#searchCondition.
const MAX_SEARCH_TOKENS = 5;

const LIKE_WILDCARD_RE = /[%_\\]/g;
function escapeLikeWildcards(value: string): string {
  return value.replace(LIKE_WILDCARD_RE, (ch) => `\\${ch}`);
}

/**
 * Resolves each distinct raw `owner` value from the source CSVs (e.g.
 * "Macarena") to a `bd.id`, matching case-insensitively against either the
 * BD's first name (the part of `bd.name` before the first space) or the
 * local part of their email. Never guesses: a value that doesn't cleanly
 * match exactly one BD is left unmatched and reported back, rather than
 * assigned to the wrong person. Some source rows carry garbage in the
 * `owner` column (company names from a misaligned export) — those simply
 * never match anything and show up as unmatched.
 */
export async function matchOwnersToBd(
  ownerRawValues: string[],
): Promise<{ matched: Map<string, string>; unmatched: string[] }> {
  const distinct = [...new Set(ownerRawValues.map((v) => v.trim()).filter(Boolean))];
  const matched = new Map<string, string>();
  const unmatched: string[] = [];
  if (!distinct.length) return { matched, unmatched };

  const allBds = await db.select({ id: bd.id, name: bd.name, email: bd.email }).from(bd);

  for (const raw of distinct) {
    const normalized = raw.toLowerCase();
    const hit = allBds.find((b) => {
      const firstName = b.name.trim().split(/\s+/)[0]?.toLowerCase();
      const localPart = b.email.split("@")[0]?.toLowerCase();
      return firstName === normalized || localPart === normalized;
    });
    if (hit) matched.set(raw, hit.id);
    else unmatched.push(raw);
  }

  return { matched, unmatched };
}

export interface ImportLeadsResult {
  sourceKey: string;
  upserted: number;
  matchedOwners: string[];
  unmatchedOwners: string[];
}

/**
 * Upsert a batch of merged lead drafts (see src/lib/leads/csv.ts) into the
 * shared `lead` table, keyed on (source_key, attendee_id) so re-running the
 * same import never duplicates rows. `ownerBdId` is only ever set from a
 * clean name/email match (see matchOwnersToBd) — an unmatched owner stays
 * NULL rather than guessed.
 *
 * `status`/`notes`/`updatedByBdId`/`updatedAt` are intentionally excluded
 * from the upsert's UPDATE clause: those are edited by BDs from the app
 * (see updateLeadStatus/updateLeadOwner below) and must survive a re-import
 * of the same source list untouched.
 */
export async function importLeads(
  sourceKey: string,
  displayName: string,
  drafts: LeadDraft[],
): Promise<ImportLeadsResult> {
  await db
    .insert(leadSource)
    .values({ key: sourceKey, displayName })
    .onConflictDoUpdate({
      target: leadSource.key,
      set: { displayName: sql`excluded.display_name` },
    });

  const { matched, unmatched } = await matchOwnersToBd(
    drafts.map((d) => d.ownerRaw).filter((v): v is string => !!v),
  );

  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < drafts.length; i += CHUNK) {
    const chunk = drafts.slice(i, i + CHUNK);
    const rows: NewLead[] = chunk.map((d) => ({
      sourceKey,
      attendeeId: d.attendeeId,
      firstName: d.firstName,
      lastName: d.lastName,
      jobTitle: d.jobTitle,
      seniority: d.seniority,
      companyRaw: d.companyRaw,
      companyDisplay: d.companyDisplay,
      companyGroup: d.companyGroup,
      companyKey: d.companyKey,
      industryRaw: d.industryRaw,
      industryGroup: d.industryGroup,
      city: d.city,
      region: d.region,
      country: d.country,
      attendeeType: d.attendeeType,
      email: d.email,
      emailStatus: d.emailStatus,
      emailConfidence: d.emailConfidence,
      emailSource: d.emailSource,
      ownerBdId: d.ownerRaw ? (matched.get(d.ownerRaw) ?? null) : null,
      lastImportedAt: new Date(),
    }));

    await db
      .insert(lead)
      .values(rows)
      .onConflictDoUpdate({
        target: [lead.sourceKey, lead.attendeeId],
        set: {
          firstName: sql`excluded.first_name`,
          lastName: sql`excluded.last_name`,
          jobTitle: sql`excluded.job_title`,
          seniority: sql`excluded.seniority`,
          companyRaw: sql`excluded.company_raw`,
          companyDisplay: sql`excluded.company_display`,
          companyGroup: sql`excluded.company_group`,
          companyKey: sql`excluded.company_key`,
          industryRaw: sql`excluded.industry_raw`,
          industryGroup: sql`excluded.industry_group`,
          city: sql`excluded.city`,
          region: sql`excluded.region`,
          country: sql`excluded.country`,
          attendeeType: sql`excluded.attendee_type`,
          email: sql`excluded.email`,
          emailStatus: sql`excluded.email_status`,
          emailConfidence: sql`excluded.email_confidence`,
          emailSource: sql`excluded.email_source`,
          // Only overwrite ownerBdId when this import actually resolved one
          // — a stale/garbage owner value in a later re-import must not
          // erase a previously-assigned, possibly manually-corrected owner.
          ownerBdId: sql`coalesce(excluded.owner_bd_id, ${lead.ownerBdId})`,
          lastImportedAt: sql`excluded.last_imported_at`,
        },
      });
    upserted += chunk.length;
  }

  return {
    sourceKey,
    upserted,
    matchedOwners: [...matched.keys()],
    unmatchedOwners: unmatched,
  };
}

export type OwnerFilterValue = "mine" | "unassigned" | string; // string = bd id

export interface LeadFilters {
  name?: string;
  company?: string;
  industryGroup?: string;
  seniority?: string;
  owner?: OwnerFilterValue;
  emailStatus?: EmailStatusKey;
  status?: LeadStatusKey;
}

export interface LeadRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  seniority: string | null;
  companyDisplay: string | null;
  companyRaw: string | null;
  industryGroup: string | null;
  email: string | null;
  emailStatus: EmailStatusKey;
  ownerBdId: string | null;
  ownerName: string | null;
  status: LeadStatusKey;
}

export interface LeadsPage {
  rows: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function nameSearchCondition(q: string) {
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
  if (!tokens.length) return undefined;
  const tokenConditions = tokens.map((token) => {
    const pattern = `%${escapeLikeWildcards(token)}%`;
    return or(ilike(lead.firstName, pattern), ilike(lead.lastName, pattern));
  });
  return and(...tokenConditions);
}

function ownerFilterCondition(owner: OwnerFilterValue, myBdId: string) {
  if (owner === "mine") return eq(lead.ownerBdId, myBdId);
  if (owner === "unassigned") return isNull(lead.ownerBdId);
  return eq(lead.ownerBdId, owner);
}

export async function listLeads(
  myBdId: string,
  filters: LeadFilters = {},
  page = 1,
  pageSize = 25,
): Promise<LeadsPage> {
  const where: SQL[] = [];
  if (filters.name) {
    const cond = nameSearchCondition(filters.name);
    if (cond) where.push(cond);
  }
  if (filters.company) {
    const pattern = `%${escapeLikeWildcards(filters.company.trim())}%`;
    where.push(
      or(ilike(lead.companyDisplay, pattern), ilike(lead.companyRaw, pattern))!,
    );
  }
  if (filters.industryGroup) where.push(eq(lead.industryGroup, filters.industryGroup));
  if (filters.seniority) where.push(eq(lead.seniority, filters.seniority));
  if (filters.owner) where.push(ownerFilterCondition(filters.owner, myBdId));
  if (filters.emailStatus) where.push(eq(lead.emailStatus, filters.emailStatus));
  if (filters.status) where.push(eq(lead.status, filters.status));

  const whereClause = where.length ? and(...where) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(lead)
    .where(whereClause);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const rows = await db
    .select({
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      jobTitle: lead.jobTitle,
      seniority: lead.seniority,
      companyDisplay: lead.companyDisplay,
      companyRaw: lead.companyRaw,
      industryGroup: lead.industryGroup,
      email: lead.email,
      emailStatus: lead.emailStatus,
      ownerBdId: lead.ownerBdId,
      ownerName: bd.name,
      status: lead.status,
    })
    .from(lead)
    .leftJoin(bd, eq(lead.ownerBdId, bd.id))
    .where(whereClause)
    .orderBy(asc(lead.lastName), asc(lead.firstName))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return {
    rows: rows.map((r) => ({
      ...r,
      emailStatus: r.emailStatus as EmailStatusKey,
      status: r.status as LeadStatusKey,
    })),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export interface LeadDetail extends LeadRow {
  companyGroup: string | null;
  companyKey: string | null;
  industryRaw: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  attendeeType: string | null;
  emailConfidence: number | null;
  emailSource: string | null;
  notes: string | null;
  updatedByBdId: string | null;
  updatedByName: string | null;
  updatedAt: Date | null;
  createdAt: Date;
  lastImportedAt: Date;
  sourceKey: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Full detail for one lead. Leads are shared, so no owner-scoping here. */
export async function getLeadById(id: string): Promise<LeadDetail | null> {
  if (!UUID_RE.test(id)) return null;

  const rows = await db
    .select({
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      jobTitle: lead.jobTitle,
      seniority: lead.seniority,
      companyRaw: lead.companyRaw,
      companyDisplay: lead.companyDisplay,
      companyGroup: lead.companyGroup,
      companyKey: lead.companyKey,
      industryRaw: lead.industryRaw,
      industryGroup: lead.industryGroup,
      city: lead.city,
      region: lead.region,
      country: lead.country,
      attendeeType: lead.attendeeType,
      email: lead.email,
      emailStatus: lead.emailStatus,
      emailConfidence: lead.emailConfidence,
      emailSource: lead.emailSource,
      ownerBdId: lead.ownerBdId,
      status: lead.status,
      notes: lead.notes,
      updatedByBdId: lead.updatedByBdId,
      updatedAt: lead.updatedAt,
      createdAt: lead.createdAt,
      lastImportedAt: lead.lastImportedAt,
      sourceKey: lead.sourceKey,
    })
    .from(lead)
    .where(eq(lead.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const namesById = new Map<string, string>();
  const idsToLookup = [row.ownerBdId, row.updatedByBdId].filter(
    (v): v is string => !!v,
  );
  if (idsToLookup.length) {
    const bds = await db
      .select({ id: bd.id, name: bd.name })
      .from(bd)
      .where(or(...idsToLookup.map((id2) => eq(bd.id, id2))));
    for (const b of bds) namesById.set(b.id, b.name);
  }

  return {
    ...row,
    emailStatus: row.emailStatus as EmailStatusKey,
    status: row.status as LeadStatusKey,
    ownerName: row.ownerBdId ? (namesById.get(row.ownerBdId) ?? null) : null,
    updatedByName: row.updatedByBdId ? (namesById.get(row.updatedByBdId) ?? null) : null,
  };
}

export interface LeadFilterOptions {
  seniorities: string[];
  industryGroups: string[];
  owners: { id: string; name: string }[];
}

/** Distinct values for the /leads filter dropdowns, computed from the data itself. */
export async function getLeadFilterOptions(): Promise<LeadFilterOptions> {
  const [seniorityRows, industryRows, owners] = await Promise.all([
    db
      .selectDistinct({ v: lead.seniority })
      .from(lead)
      .where(sql`${lead.seniority} is not null`)
      .orderBy(asc(lead.seniority)),
    db
      .selectDistinct({ v: lead.industryGroup })
      .from(lead)
      .where(sql`${lead.industryGroup} is not null`)
      .orderBy(asc(lead.industryGroup)),
    db.select({ id: bd.id, name: bd.name }).from(bd).orderBy(asc(bd.name)),
  ]);
  return {
    seniorities: seniorityRows.map((r) => r.v).filter((v): v is string => !!v),
    industryGroups: industryRows.map((r) => r.v).filter((v): v is string => !!v),
    owners,
  };
}

/** Update a lead's status and/or notes. Any signed-in BD may do this. */
export async function updateLeadStatus(
  id: string,
  updatedByBdId: string,
  fields: { status?: LeadStatusKey; notes?: string | null },
): Promise<void> {
  if (!UUID_RE.test(id)) return;
  const set: Partial<NewLead> = { updatedByBdId, updatedAt: new Date() };
  if (fields.status && isLeadStatusKey(fields.status)) set.status = fields.status;
  if (fields.notes !== undefined) set.notes = fields.notes?.trim() || null;
  await db.update(lead).set(set).where(eq(lead.id, id));
}

/** Reassign a lead's owner. Any signed-in BD may do this. */
export async function updateLeadOwner(
  id: string,
  updatedByBdId: string,
  ownerBdId: string | null,
): Promise<void> {
  if (!UUID_RE.test(id)) return;
  await db
    .update(lead)
    .set({ ownerBdId, updatedByBdId, updatedAt: new Date() })
    .where(eq(lead.id, id));
}

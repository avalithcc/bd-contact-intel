/**
 * The reads behind the Sequence pages (go-live, PR 13). Raw `sql` returns timestamps as strings, so every instant is
 * normalized with parseDbTimestamp; counts are cast to int in SQL. Pure shaping lives in pageReads.ts.
 *
 * Round trips (PERFORMANCE.md), each ONE statement unless noted:
 *   listSequencesForBd      1   (sequences + members + step 1 drafts + companies, one flat join)
 *   listAllSequences        1   (the same join, every owner, plus the owner name: admin only)
 *   getSendingAccount       1
 *   listPickerPage          1   (one page; +1 for the industry counts at offset 0; +1 for the country facts when none are cached)
 *   listContactMemberships  1
 *   listReplyPhrases        1   (skipped when no member has replied)
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { normalizeSuppressionValue, type SuppressionRule } from "./suppression";
import type { ContactMembership } from "./contactContext";
import type { SequenceListRow } from "./listView";
import { groupListRows, replyPhrases, toMembership, toPickerContact, type ListDbRow, type MembershipDbRow, type PickerDbRow } from "./pageReads";
import { PICKER_PAGE_SIZE, type PickerPage, type PickerQuery } from "./pickerFilters";
import { industryCountsFromRows, type IndustryCountRow } from "./industryCounts";
import { buildPickerReads, countryFacts, distinctCountriesSql, type CountryFacts } from "./pickerQuery";
import { resolveComplianceAudience } from "./complianceAudience";
import { withResolvedCompanyName } from "@/lib/contacts/companyDisplayName";
import { companyNameColumnsSql, canonicalCompanyJoinSql } from "./rosterQuery";

type Row = Record<string, unknown>;
const rowsOf = <T>(r: unknown) => r as T[];
const date = (v: unknown): Date | null => (v == null ? null : parseDbTimestamp(v as string | Date));

/**
 * The signed-in BD's Sequences with EVERY member. No limit on purpose: `listView` derives every count from the rows it
 * is handed, so a cut list would report a smaller roster than exists (the same reason detailQueries.ts refuses to
 * truncate). A BD's own Sequences are hand-picked rosters of tens of people.
 */
export async function listSequencesForBd(bdId: string): Promise<SequenceListRow[]> {
  return readListRows(sql``, sql``, sql`where s.owner_bd_id = ${bdId}::uuid`);
}

/** Most Sequences the admin "Todas" read returns (newest first). Members are never cut: the bound is on whole Sequences. */
export const ALL_SEQUENCES_LIMIT = 200;

/**
 * Every BD's Sequences with their owner, for the admin list: the newest ALL_SEQUENCES_LIMIT Sequences, bounded on whole
 * Sequences so every shown roster stays complete. When `meId` is given, that BD's own Sequences are always included, so
 * the Mías tab never loses a row to the bound. The caller (the page) calls it for an admin only.
 */
export async function listAllSequences(meId?: string, limit = ALL_SEQUENCES_LIMIT): Promise<{ rows: SequenceListRow[]; capped: boolean }> {
  const mine = meId ? sql` or s.owner_bd_id = ${meId}::uuid` : sql``;
  // limit + 1 newest: the extra one only proves more exist. Rows come newest first, so the viewer's older own rows sit
  // after the newest limit + 1; `capped` is exactly "more than `limit` Sequences came back".
  const rows = await readListRows(
    sql`, s.owner_bd_id::text as owner_id, ob.name as owner_name`,
    sql`join bd ob on ob.id = s.owner_bd_id`,
    sql`where s.id in (select r.id from sequence r order by r.created_at desc, r.id limit ${limit + 1})${mine}`,
  );
  return { rows: rows.filter((r, i) => i < limit || (meId !== undefined && r.owner?.id === meId)), capped: rows.length > limit };
}

async function readListRows(ownerCols: SQL, ownerJoin: SQL, where: SQL): Promise<SequenceListRow[]> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      select s.id::text as id, s.name, s.created_at, s.daily_send_cap, s.schedule, sm.state, (d.id is not null) as has_draft, d.scheduled_for, ${companyNameColumnsSql}${ownerCols}
      from sequence s
      ${ownerJoin}
      left join sequence_member sm on sm.sequence_id = s.id
      left join sequence_draft d on d.sequence_member_id = sm.id and d.step = 1
      left join person p on p.id = sm.person_id
      ${canonicalCompanyJoinSql}
      ${where}
      order by s.created_at desc, s.id, sm.created_at, sm.id`),
  );
  return groupListRows(withResolvedCompanyName(rows.map((r) => ({ ...(r as ListDbRow & { companyCanonicalName: string | null }), created_at: date(r.created_at)!, scheduled_for: date(r.scheduled_for) }))));
}

/** The BD's connected Gmail account, the one a Sequence sends from. Null when none is connected: nothing can be created. */
export async function getSendingAccount(bdId: string): Promise<{ id: string; address: string } | null> {
  const [row] = await db.select({ id: emailAccount.id, address: emailAccount.emailAddress }).from(emailAccount).where(and(eq(emailAccount.bdId, bdId), eq(emailAccount.status, "connected")));
  return row ?? null;
}

const COUNTRY_FACTS_TTL_MS = 5 * 60_000;
let countryFactsCache: { at: number; facts: CountryFacts } | null = null;

/** Test hook: the facts are cached per server instance, so a test that adds a country must forget them. */
export function clearPickerCountryFacts() {
  countryFactsCache = null;
}

/**
 * Which country texts have no compliance audience / are the US, for the SQL that orders and filters the picker. Cached for a
 * few minutes (one round trip saved per page): a stale entry can only mis-order a row, never mis-admit it, because the
 * reason a row shows and the add itself re-derive the audience from the row (resolveComplianceAudience).
 */
async function pickerCountryFacts(): Promise<CountryFacts> {
  if (countryFactsCache && Date.now() - countryFactsCache.at < COUNTRY_FACTS_TTL_MS) return countryFactsCache.facts;
  const facts = countryFacts(rowsOf<{ country: string }>(await db.execute(distinctCountriesSql)).map((r) => r.country));
  countryFactsCache = { at: Date.now(), facts };
  return facts;
}

/**
 * One page of the roster picker for a NEW Sequence: every live contact with an email, filtered and searched on the
 * server (pickerQuery.ts), PICKER_PAGE_SIZE at a time. Unlike a roster query that removes non-addable Contacts, this
 * KEEPS them when `showBlocked` is on: the picker shows them last with the reason, and the reason comes from
 * `staticBlock` (pageReads.toPickerContact), the same admission the server re-runs on add.
 *
 * Round trips: 1 (the page), plus 1 for the industry chip counts when `query.offset` is 0 (a restarted list: they are read
 * from the SAME `query` through buildPickerReads, so they describe exactly the set the list now shows; a "Cargar más"
 * page returns `industryCounts: null` and the client keeps the ones it has), plus 1 for the country facts when none are cached.
 */
export async function listPickerPage(query: PickerQuery, meId: string, unnamed: string): Promise<PickerPage> {
  const reads = buildPickerReads(query, meId, await pickerCountryFacts());
  const rows = rowsOf<PickerDbRow & { companyCanonicalName: string | null; suppressed: boolean; person_country: string | null; mobile_phone: string | null; phone: string | null; company_country: string | null; posting_markets: string[] }>(
    await db.execute(reads.page),
  );
  const industryCounts = reads.counts ? industryCountsFromRows(rowsOf<IndustryCountRow>(await db.execute(reads.counts))) : null;
  const named = withResolvedCompanyName(rows).slice(0, PICKER_PAGE_SIZE);
  const contacts = named.map((r) => {
    const mapped = resolveComplianceAudience({ mobilePhone: r.mobile_phone, phone: r.phone, personCountry: r.person_country, companyCountry: r.company_country, postingMarkets: r.posting_markets }) !== null;
    // A suppressed address becomes a one-address rule, so the SAME isSuppressed() that guards the add decides the reason.
    const rules: SuppressionRule[] = r.suppressed && r.email ? [{ ruleKind: "address", value: normalizeSuppressionValue("address", r.email) }] : [];
    return toPickerContact({ ...r, market_mapped: mapped }, rules, unnamed);
  });
  return { contacts, hasMore: rows.length > PICKER_PAGE_SIZE, industryCounts };
}

/** Newest history first, live and opted-out first, so a bound could only ever cut old discarded history. */
const MEMBERSHIP_LIMIT = 100;

/**
 * Every membership of this Contact's EMAIL ADDRESS, in any Sequence of any BD. Keyed by address and not by person_id on
 * purpose: `recordOptOutForMember` suppresses the address and discards every live membership of it, joining person on
 * the email alone (suppressAddressInTx), so a read keyed on the person undercounts whenever the same address lives on a
 * second Contact row. Same match as the write: email_normalized, falling back to lower(trim(email)) on older rows.
 * Starts from sequence_member (small), so the person lookup is by primary key.
 */
export async function listContactMemberships(viewerBdId: string, email: string | null): Promise<ContactMembership[]> {
  const address = email ? normalizeSuppressionValue("address", email) : "";
  if (!address) return [];
  const rows = rowsOf<Row>(
    await db.execute(sql`
      select sm.id::text as member_id, s.name as sequence_name, s.owner_bd_id::text as owner_bd_id, sm.state, d.scheduled_for,
             s.id::text as sequence_id, d.subject, d.approved_at, p.email as to_address, sm.sent_at, sm.replied_at, sm.discarded_at, sm.discard_reason
      from sequence_member sm
      join sequence s on s.id = sm.sequence_id
      join person p on p.id = sm.person_id
      left join sequence_draft d on d.sequence_member_id = sm.id and d.step = 1
      where (p.email_normalized = ${address} or lower(trim(p.email)) = ${address})
      order by (sm.state = 'discarded' and sm.discard_reason is distinct from 'opt_out'), sm.created_at desc, sm.id
      limit ${MEMBERSHIP_LIMIT}`),
  );
  return rows.map((r) => toMembership({ ...(r as MembershipDbRow), scheduled_for: date(r.scheduled_for), approved_at: date(r.approved_at), sent_at: date(r.sent_at), replied_at: date(r.replied_at), discarded_at: date(r.discarded_at) }, viewerBdId));
}

/**
 * Advisory opt-out phrases for the OWNER's replied members. Reads only the owner's own mailbox (em.bd_id): an admin
 * reading another BD's Sequence must go through the audited conversation access, not through this. Genuine replies
 * only, with the runner's own definition (inbound, not automatic, not a thread attribution, after the send).
 */
export async function listReplyPhrases(ownerBdId: string, memberIds: readonly string[]): Promise<Record<string, string>> {
  if (!memberIds.length) return {};
  const ids = sql.join(memberIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = rowsOf<{ member_id: string; body_text: string | null }>(
    await db.execute(sql`
      select sm.id::text as member_id, em.body_text
      from sequence_member sm
      join email_message_person emp on emp.person_id = sm.person_id
      join email_message em on em.id = emp.email_message_id
      where sm.id in (${ids}) and sm.state = 'replied' and em.bd_id = ${ownerBdId}::uuid
        and em.direction = 'inbound' and em.is_automatic = false and emp.match_confidence <> 'thread' and em.sent_at > sm.sent_at
      order by em.sent_at desc
      limit 500`),
  );
  return replyPhrases(rows);
}

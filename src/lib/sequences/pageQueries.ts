/**
 * The reads behind the Sequence pages (go-live, PR 13). Raw `sql` returns timestamps as strings, so every instant is
 * normalized with parseDbTimestamp; counts are cast to int in SQL. Pure shaping lives in pageReads.ts.
 *
 * Round trips (PERFORMANCE.md), each ONE statement unless noted:
 *   listSequencesForBd      1   (sequences + members + step 1 drafts + companies, one flat join)
 *   getSendingAccount       1
 *   listPickerContacts      2   (the pool, then the company-wide suppression list that staticBlock needs)
 *   listContactMemberships  1
 *   listReplyPhrases        1   (skipped when no member has replied)
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { normalizeSuppressionValue } from "./suppression";
import type { ContactMembership } from "./contactContext";
import type { SequenceListRow } from "./listView";
import { groupListRows, replyPhrases, toMembership, toPickerContact, type ListDbRow, type MembershipDbRow, type PickerDbRow } from "./pageReads";
import type { PickerContact } from "./pickerView";
import { withResolvedCompanyName } from "@/lib/contacts/companyDisplayName";
import { canonicalCompanyJoinSql, clientStatusSql, companyNameColumnsSql, displayedCompanySql } from "./rosterQuery";
import { listSuppressionRules } from "./suppressionQueries";

type Row = Record<string, unknown>;
const rowsOf = <T>(r: unknown) => r as T[];
const date = (v: unknown): Date | null => (v == null ? null : parseDbTimestamp(v as string | Date));

/**
 * The signed-in BD's Sequences with EVERY member. No limit on purpose: `listView` derives every count from the rows it
 * is handed, so a cut list would report a smaller roster than exists (the same reason detailQueries.ts refuses to
 * truncate). A BD's own Sequences are hand-picked rosters of tens of people.
 */
export async function listSequencesForBd(bdId: string): Promise<SequenceListRow[]> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      select s.id::text as id, s.name, s.created_at, s.daily_send_cap, s.schedule, sm.state, (d.id is not null) as has_draft, d.scheduled_for, ${companyNameColumnsSql}
      from sequence s
      left join sequence_member sm on sm.sequence_id = s.id
      left join sequence_draft d on d.sequence_member_id = sm.id and d.step = 1
      left join person p on p.id = sm.person_id
      ${canonicalCompanyJoinSql}
      where s.owner_bd_id = ${bdId}::uuid
      order by s.created_at desc, s.id, sm.created_at, sm.id`),
  );
  return groupListRows(withResolvedCompanyName(rows.map((r) => ({ ...(r as ListDbRow & { companyCanonicalName: string | null }), created_at: date(r.created_at)!, scheduled_for: date(r.scheduled_for) }))));
}

/** The BD's connected Gmail account, the one a Sequence sends from. Null when none is connected: nothing can be created. */
export async function getSendingAccount(bdId: string): Promise<{ id: string; address: string } | null> {
  const [row] = await db.select({ id: emailAccount.id, address: emailAccount.emailAddress }).from(emailAccount).where(and(eq(emailAccount.bdId, bdId), eq(emailAccount.status, "connected")));
  return row ?? null;
}

/**
 * Hard bound on the picker pool. The pool is Contacts at companies with an open US IT posting; the picker searches it
 * client-side, so a pool past this bound would hide people from the search. Addable Contacts sort first, so what a
 * bound would cut is the ones that could not be added anyway.
 */
export const PICKER_POOL_LIMIT = 500;

/**
 * The roster picker pool for a NEW Sequence. Unlike buildRosterCandidatesQuery, which removes non-addable Contacts in
 * SQL, this KEEPS them: the picker shows them last with the reason, and the reason comes from `staticBlock`
 * (pageReads.toPickerContact), the same admission the server re-runs on add. Every row has a company key by
 * construction: the postings join matches on it.
 */
export async function listPickerContacts(unnamed: string): Promise<PickerContact[]> {
  const rows = rowsOf<PickerDbRow & { companyCanonicalName: string | null }>(
    await db.execute(sql`
      select p.id::text as person_id, p.first_name, p.last_name, p.email, p.email_status, p.email_source, p.job_title, p.status,
             ${companyNameColumnsSql}, p.company_key, p.merged_into_id::text as merged_into_id, ${clientStatusSql} as client_status,
             h.open_it::int as open_it, h.is_florida
      from person p
      ${canonicalCompanyJoinSql}
      join lateral (
        select count(*) as open_it, coalesce(bool_or(jp.is_miami), false) as is_florida
        from job_posting jp
        where jp.is_it = true and jp.closed_at is null and jp.market = 'us'
          and (jp.company_key = p.company_key or jp.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))
      ) h on h.open_it > 0
      where p.company_key is not null
      order by (p.merged_into_id is not null), (btrim(coalesce(p.email, '')) = ''), ${displayedCompanySql}, p.last_name, p.first_name, p.id
      limit ${PICKER_POOL_LIMIT}`),
  );
  const rules = await listSuppressionRules();
  return withResolvedCompanyName(rows).map((r) => toPickerContact(r, rules, unnamed));
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
             sm.sent_at, sm.replied_at, sm.discarded_at, sm.discard_reason
      from sequence_member sm
      join sequence s on s.id = sm.sequence_id
      join person p on p.id = sm.person_id
      left join sequence_draft d on d.sequence_member_id = sm.id and d.step = 1
      where (p.email_normalized = ${address} or lower(trim(p.email)) = ${address})
      order by (sm.state = 'discarded' and sm.discard_reason is distinct from 'opt_out'), sm.created_at desc, sm.id
      limit ${MEMBERSHIP_LIMIT}`),
  );
  return rows.map((r) => toMembership({ ...(r as MembershipDbRow), scheduled_for: date(r.scheduled_for), sent_at: date(r.sent_at), replied_at: date(r.replied_at), discarded_at: date(r.discarded_at) }, viewerBdId));
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

/**
 * Read model for the Sequence detail screen. Owner-scoped: a BD reads only their own Sequence (another BD's reads as
 * "not found", indistinguishable from a missing id). An admin reads any Sequence, with no audit row: admin visibility is
 * follow-up and is never audited (owner decision, 2026-10-16). The screen shows another BD's as read-only.
 *
 * Round trips (PERFORMANCE.md): ONE statement for everyone (sequence, members, drafts, posting counts and last contact
 * in a single left join).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveCompanyDisplayName } from "@/lib/contacts/companyDisplayName";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { isAdminRole } from "@/lib/auth/adminRole";
import { isLeadershipRoleGroup } from "@/lib/outreach/ranking";
import { isUuid } from "@/lib/uuid";
import type { MemberState } from "./memberState";
import type { HoldReason } from "./preSendChecks";
import { canonicalCompanyJoinSql, companyCountrySql, companyNameColumnsSql, postingMarketsSql, sameCompanyAs } from "./rosterQuery";
import type { AudienceLanguage } from "./complianceAudience";
import { parseLanguageChoice } from "./languageChoice";
import { buildMemberAudience, type ColleagueCountry, type MemberAudience } from "./audienceView";
import type { RecipientPlace } from "@/lib/sendSchedule/zones";
import { miamiCalendarDate } from "./miamiTime";
import { parseSchedule, type Schedule } from "./schedule";
import { openFreshPostingSql } from "@/lib/hiring/openPosting";

/**
 * Hard bound: a hand-picked roster is tens of people. Nothing caps a roster's size, though —
 * `COMPANY_MEMBER_LIMIT` caps 2 per company, not the total — so the read below asks for one row PAST this
 * bound and refuses rather than truncate. `sequenceStats()` derives every count from the array it is handed,
 * so a silently cut list would report a 250-member Sequence as 200 and draw the progress bar over the wrong
 * total: a number nobody can tell is wrong. Paginate the read before raising this.
 */
export const SEQUENCE_DETAIL_MEMBER_LIMIT = 200;

export type DetailDraft = { subject: string; body: string; edited: boolean; editedAt: Date | null; reviewedAt: Date | null; approvedAt: Date | null; scheduledFor: Date | null };

export type DetailMember = {
  memberId: string;
  personId: string;
  state: MemberState;
  holdReason: HoldReason | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyKey: string | null;
  email: string | null;
  emailVerified: boolean;
  openIt: number;
  florida: boolean;
  leadership: boolean;
  lastContactAt: Date | null;
  repliedAt: Date | null;
  sentAt: Date | null;
  reminderDueAt: Date | null;
  discardedAt: Date | null;
  discardReason: string | null;
  draft: DetailDraft | null;
  reminderDraft: DetailDraft | null;
  /** Where the person probably is (person first, then the company's country): input of the time-zone reference only. */
  place?: RecipientPlace;
  /** Language and legal address the draft will use, and why (the same chain as the draft itself). */
  audience?: MemberAudience;
  /** The language a person chose for this member's draft (languageChoice.ts); null when nobody did. `byName` is null if that BD is gone. */
  languageChoice?: { language: AudienceLanguage; byName: string | null; at: Date | null } | null;
};

/** `sentToday`: sends recorded today (Miami day) from this Sequence's sending account, pending claims included: what the daily cap has already used. */
export type SequenceDetail = { id: string; name: string; ownerBdId: string; ownerName: string; fromAddress: string; schedule: Schedule; dailySendCap: number; sentToday: number; members: DetailMember[] };

type Executor = Pick<typeof db, "execute">;
type Row = Record<string, unknown>;
const ts = (v: unknown) => (v == null ? null : parseDbTimestamp(v as string | Date));

function draftOf(r: Row, p: "d1" | "d2"): DetailDraft | null {
  if (r[`${p}_id`] == null) return null;
  return { subject: String(r[`${p}_subject`]), body: String(r[`${p}_body`]), editedAt: ts(r[`${p}_edited_at`]), edited: r[`${p}_edited_at`] != null, reviewedAt: ts(r[`${p}_reviewed_at`]), approvedAt: ts(r[`${p}_approved_at`]), scheduledFor: ts(r[`${p}_scheduled_for`]) };
}

function languageChoiceOf(r: Row): DetailMember["languageChoice"] {
  const language = parseLanguageChoice(r.draft_language);
  return language ? { language, byName: (r.draft_language_by_name ?? null) as string | null, at: ts(r.draft_language_at) } : null;
}

async function readDetail(ex: Executor, sequenceId: string, onlyOwnedBy: string | null): Promise<SequenceDetail | null> {
  const owned = onlyOwnedBy ? sql`and s.owner_bd_id = ${onlyOwnedBy}::uuid` : sql``;
  const day = miamiCalendarDate(new Date());
  const rows = (await ex.execute(sql`
    select s.id::text as sid, s.name, s.owner_bd_id::text as owner_id, ob.name as owner_name, s.schedule, s.daily_send_cap, ea.email_address, used.n as sent_today,
           sm.id::text as member_id, sm.person_id::text as person_id, sm.state, sm.hold_reason, sm.sent_at, sm.replied_at, sm.reminder_due_at,
           sm.discarded_at, sm.discard_reason, sm.draft_language, sm.draft_language_at, lb.name as draft_language_by_name,
           p.first_name, p.last_name, p.job_title, ${companyNameColumnsSql}, p.company_key, p.email, p.email_status = 'verified' as verified, p.role_group, p.city, p.region, p.country, cn.country as company_country,
           p.mobile_phone, p.phone, ${companyCountrySql} as audience_company_country, ${postingMarketsSql} as posting_markets,
           col.decides as company_decides, col.countries as colleague_countries,
           coalesce(h.open_it, 0)::int as open_it, coalesce(h.is_florida, false) as is_florida,
           (select max(${effectiveActivityAtSql()}) from activity where activity.person_id = sm.person_id) as last_contact_at,
           d1.id as d1_id, d1.subject as d1_subject, d1.body as d1_body, d1.edited_at as d1_edited_at, d1.reviewed_at as d1_reviewed_at, d1.approved_at as d1_approved_at, d1.scheduled_for as d1_scheduled_for,
           d2.id as d2_id, d2.subject as d2_subject, d2.body as d2_body, d2.edited_at as d2_edited_at, d2.reviewed_at as d2_reviewed_at, d2.approved_at as d2_approved_at, d2.scheduled_for as d2_scheduled_for
    from sequence s
    join bd ob on ob.id = s.owner_bd_id
    join email_account ea on ea.id = s.email_account_id
    cross join lateral (
      select count(*)::int as n from sequence_send_claim cl
      where cl.sending_account_id = s.email_account_id
        and ((cl.outcome = 'sent' and cl.miami_send_date = ${day}::date)
          or (cl.outcome = 'pending' and (cl.claimed_at at time zone 'America/New_York')::date = ${day}::date))
    ) used
    left join sequence_member sm on sm.sequence_id = s.id
    left join person p on p.id = sm.person_id
    left join bd lb on lb.id = sm.draft_language_by_bd_id
    ${canonicalCompanyJoinSql}
    left join lateral (
      select count(*) as open_it, bool_or(jp.is_miami) as is_florida from job_posting jp
      where jp.is_it = true and ${openFreshPostingSql("jp")} and jp.market = 'us'
        and ${sameCompanyAs("jp")}
    ) h on sm.id is not null
    left join lateral (
      select coalesce(sum(g.n) filter (where g.c is null), 0)::int as decides,
             coalesce(json_agg(json_build_object('country', g.c, 'n', g.n)) filter (where g.c is not null), '[]'::json) as countries
      from (
        select nullif(btrim(q.country), '') as c, count(*)::int as n from person q
        where sm.id is not null and nullif(btrim(p.country), '') is null and ${companyCountrySql} is not null
          and q.merged_into_id is null and q.id <> p.id and btrim(coalesce(q.email, '')) <> ''
          and (q.company_key in (select c.company_key from company c where ${sameCompanyAs("c")})
            or q.company_key in (select sib.alias_key from company_alias sib where sib.company_key in (select c.company_key from company c where ${sameCompanyAs("c")})))
        group by 1
      ) g
    ) col on true
    left join sequence_draft d1 on d1.sequence_member_id = sm.id and d1.step = 1
    left join sequence_draft d2 on d2.sequence_member_id = sm.id and d2.step = 2
    where s.id = ${sequenceId}::uuid ${owned}
    order by case sm.state when 'drafted' then 0 when 'approved' then 1 when 'replied' then 2 when 'sent' then 3 when 'no_reply' then 4 else 5 end, sm.created_at, sm.id
    limit ${SEQUENCE_DETAIL_MEMBER_LIMIT + 1}`)) as unknown as Row[];
  const head = rows[0];
  if (!head) return null;
  const members = rows.filter((r) => r.member_id != null);
  if (members.length > SEQUENCE_DETAIL_MEMBER_LIMIT) {
    throw new Error(`sequence ${sequenceId} has more than ${SEQUENCE_DETAIL_MEMBER_LIMIT} members: paginate this read, do not report counts over a truncated roster`);
  }
  return {
    id: String(head.sid),
    name: String(head.name),
    ownerBdId: String(head.owner_id),
    ownerName: String(head.owner_name),
    fromAddress: String(head.email_address),
    schedule: parseSchedule(head.schedule),
    dailySendCap: Number(head.daily_send_cap),
    sentToday: Number(head.sent_today ?? 0),
    members: members.map((r) => ({
      memberId: String(r.member_id),
      personId: String(r.person_id),
      state: r.state as MemberState,
      holdReason: (r.hold_reason ?? null) as HoldReason | null,
      firstName: (r.first_name ?? null) as string | null,
      lastName: (r.last_name ?? null) as string | null,
      jobTitle: (r.job_title ?? null) as string | null,
      company: resolveCompanyDisplayName((r.company ?? null) as string | null, (r.companyCanonicalName ?? null) as string | null),
      companyKey: (r.company_key ?? null) as string | null,
      email: (r.email ?? null) as string | null,
      emailVerified: r.verified === true,
      openIt: Number(r.open_it),
      florida: r.is_florida === true,
      leadership: isLeadershipRoleGroup((r.role_group ?? null) as string | null),
      lastContactAt: ts(r.last_contact_at),
      repliedAt: ts(r.replied_at),
      sentAt: ts(r.sent_at),
      reminderDueAt: ts(r.reminder_due_at),
      discardedAt: ts(r.discarded_at),
      discardReason: (r.discard_reason ?? null) as string | null,
      draft: draftOf(r, "d1"),
      reminderDraft: draftOf(r, "d2"),
      place: { city: (r.city ?? null) as string | null, region: (r.region ?? null) as string | null, country: ((r.country || r.company_country) || null) as string | null },
      languageChoice: languageChoiceOf(r),
      audience: buildMemberAudience({
        mobilePhone: (r.mobile_phone ?? null) as string | null,
        phone: (r.phone ?? null) as string | null,
        personCountry: (r.country ?? null) as string | null,
        companyCountry: (r.audience_company_country ?? null) as string | null,
        postingMarkets: (r.posting_markets ?? []) as string[],
        companyDecides: Number(r.company_decides ?? 0),
        colleagueCountries: ((r.colleague_countries ?? []) as ColleagueCountry[]).map((c) => ({ country: String(c.country), n: Number(c.n) })),
      }),
    })),
  };
}

export async function getSequenceDetail(viewer: { id: string; role: string }, sequenceId: string): Promise<SequenceDetail | null> {
  // A malformed id is a handled "not found", not a driver error (src/lib/uuid.ts).
  if (!isUuid(sequenceId)) return null;
  // The owner scope is the only thing between a BD and another BD's drafts, and `readDetail` drops that scope
  // for a falsy id. So an unusable viewer id is a handled "not found" here, never an unscoped read.
  if (isAdminRole(viewer)) return readDetail(db, sequenceId, null);
  return isUuid(viewer.id) ? readDetail(db, sequenceId, viewer.id) : null;
}

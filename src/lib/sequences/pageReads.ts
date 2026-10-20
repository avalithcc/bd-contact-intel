/**
 * Pure shaping for the rows the Sequence pages read (pageQueries.ts). No database here, so the rules that decide what a
 * page shows are unit-tested: how a flat join becomes list rows, how a picker row gets its static block, which reply
 * text can raise the opt-out prompt.
 */
import type { LeadStatusKey } from "@/lib/leads/types";
import type { MemberState } from "./memberState";
import { detectOptOutPhrase } from "./optOutPhrases";
import type { ContactMembership } from "./contactContext";
import type { PickerContact } from "./pickerView";
import { staticBlock } from "./pickerView";
import { parseSchedule } from "./schedule";
import type { SequenceListRow } from "./listView";
import type { SuppressionRule } from "./suppression";

export type ListDbRow = {
  id: string;
  name: string;
  created_at: Date;
  daily_send_cap: number;
  schedule: unknown;
  /** Null for a Sequence with no members: the left join still returns it once. */
  state: string | null;
  has_draft: boolean | null;
  scheduled_for: Date | null;
  company: string | null;
  /** Only the all-owners read selects these. */
  owner_id?: string | null;
  owner_name?: string | null;
};

/**
 * One list row per Sequence, from the flat join. Every member of every Sequence is in the input (the read has no limit,
 * because listView derives every count from the rows it is handed), and a Sequence with no members still gets a row.
 * Companies are the distinct names in roster order.
 */
export function groupListRows(rows: readonly ListDbRow[]): SequenceListRow[] {
  const bySequence = new Map<string, SequenceListRow & { companies: string[] }>();
  for (const r of rows) {
    let seq = bySequence.get(r.id);
    if (!seq) {
      seq = { id: r.id, name: r.name, createdAt: r.created_at, dailySendCap: Number(r.daily_send_cap), schedule: parseSchedule(r.schedule), companies: [], members: [], ...(r.owner_id ? { owner: { id: r.owner_id, name: String(r.owner_name) } } : {}) };
      bySequence.set(r.id, seq);
    }
    if (r.state === null) continue;
    (seq.members as SequenceListRow["members"][number][]).push({ state: r.state as MemberState, hasDraft: r.has_draft === true, scheduledFor: r.scheduled_for });
    const company = r.company?.trim();
    if (company && !seq.companies.some((c) => c.toLowerCase() === company.toLowerCase())) seq.companies.push(company);
  }
  return [...bySequence.values()];
}

export type PickerDbRow = {
  person_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_status: string;
  email_source: string | null;
  job_title: string | null;
  status: string;
  company: string | null;
  company_key: string | null;
  merged_into_id: string | null;
  client_status: string | null;
  open_it: number;
  is_florida: boolean;
  /** isMarketMapped(recipientMarket(...)), decided by the server read: false means no postal address for the market. */
  market_mapped: boolean;
};

/**
 * A picker candidate with the reason it cannot be added, if any. The read KEEPS the ones that cannot be added (the
 * picker shows them last, dimmed, with the reason): the reason is the seed admission, `staticBlock`.
 *
 * `rules` holds only what applies to THIS contact (the read flags a suppressed address in SQL).
 *
 * The guards are EMPTY on purpose. A new Sequence has no members, and `company_limit` is the one reason that depends on
 * the selection, so the picker derives it live. Handing `staticBlock` a count of 2 would render that reason with no
 * names ("...()"), and "already a member" cannot apply to a Sequence that does not exist yet.
 */
export function toPickerContact(r: PickerDbRow, rules: readonly SuppressionRule[], unnamed: string): PickerContact {
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || unnamed;
  const block = staticBlock(
    {
      personId: r.person_id, email: r.email, emailStatus: r.email_status, emailSource: r.email_source, mergedIntoId: r.merged_into_id,
      companyKey: r.company_key, clientStatus: r.client_status, label: name,
      // Hiring is a picker FILTER now, not an admission rule: a contact at a company with no open posting can be added.
      hasOpenItPosting: true, marketMapped: r.market_mapped,
    },
    { suppressionRules: rules, alreadyMemberPersonIds: new Set(), activeCountByCompany: new Map() },
  );
  return {
    personId: r.person_id, name, jobTitle: r.job_title, status: r.status as LeadStatusKey, company: r.company, companyKey: r.company_key,
    florida: r.is_florida === true, openIt: Number(r.open_it), email: r.email, emailStatus: r.email_status, emailSource: r.email_source,
    block, blockDetail: null, survivorId: block === "merged" ? r.merged_into_id : null,
  };
}

export type MembershipDbRow = {
  member_id: string;
  sequence_name: string;
  owner_bd_id: string;
  state: string;
  scheduled_for: Date | null;
  sent_at: Date | null;
  replied_at: Date | null;
  discarded_at: Date | null;
  discard_reason: string | null;
  sequence_id?: string;
  subject?: string | null;
  approved_at?: Date | null;
  to_address?: string | null;
};

export function toMembership(r: MembershipDbRow, viewerBdId: string): ContactMembership {
  return {
    memberId: r.member_id, sequenceName: r.sequence_name, state: r.state as MemberState, ownedByViewer: r.owner_bd_id === viewerBdId,
    scheduledFor: r.scheduled_for, sentAt: r.sent_at, repliedAt: r.replied_at, discardedAt: r.discarded_at, discardReason: r.discard_reason,
    sequenceId: r.sequence_id, subject: r.subject ?? null, approvedAt: r.approved_at ?? null, toAddress: r.to_address ?? null,
  };
}

/**
 * The first opt-out phrase found in any genuine reply per member, as the advisory prompt wants it. A member with several
 * replies is checked on every one: a missed opt-out is the worse error, so one phrase anywhere raises the prompt.
 */
export function replyPhrases(rows: readonly { member_id: string; body_text: string | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (out[r.member_id]) continue;
    const phrase = detectOptOutPhrase(r.body_text);
    if (phrase) out[r.member_id] = phrase;
  }
  return out;
}

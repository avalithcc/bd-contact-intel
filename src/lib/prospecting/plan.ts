/**
 * Auto-prospecting: the pure gates and planner. DB-free on purpose (the unit tests and any client import stay clean).
 *
 * Nothing here sends. Each gate stands in for a human reading the draft, so each is a REFUSAL that is recorded with its reason, never
 * a warning: the owner learns whether a gate works by reading the refusals.
 */
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { resolveProspectLanguage } from "@/lib/prospecting/language";
import type { MessageLanguage } from "@/lib/outreach/messageLanguage";
import type { OutreachMessageCompany } from "@/lib/outreach/messagePrompt";

/**
 * Drafts per BD per Argentina day, and the dedicated Sequence's own send cap. Raised 5 -> 8 by the owner on
 * 2026-11-19, to match the 8 his four hand-made Sequences already send at - DAILY_SEND_CAP_WARN_ABOVE, the top of
 * the range the product considers comfortable.
 *
 * Generating fewer than the Sequence can send is a bottleneck with no upside: the queue drains at the slower of
 * the two, so the gap only delays work the owner has already approved. Keeping ONE constant for both is what
 * stops them drifting apart again - the automatic Sequence was about to be created at 5 while every other one
 * sent 8, which nobody would have noticed until a week of half-speed output.
 */
export const AUTO_PROSPECTING_DAILY_CAP = 8;

/**
 * Owner's number, 2026-11-19: 90 days before this path writes to someone again.
 *
 * It is NOT the follow-up queue's FOLLOW_UP_ENTRY_DAYS (5), which was the placeholder here, because the two answer
 * different questions. That one asks "has this conversation gone quiet enough to chase?" about someone already in a
 * conversation. This one asks "is it acceptable to cold-email this person again?", and nobody writes unprompted to the
 * same stranger twice in a week. The gap matters most precisely where this path is weakest: no human reads the draft,
 * so a too-short cooldown turns a silent prospect into a recipient of repeated unanswered mail.
 */
export const AUTO_PROSPECTING_COOLDOWN_DAYS = 90;

export type RefusalReason =
  | "email_not_verified"
  | "in_active_sequence"
  | "open_follow_up"
  | "recent_outreach"
  | "already_drafted"
  | "no_company_name"
  | "company_is_sender"
  | "no_open_posting"
  | "invalid_model_output"
  | "banned_vocabulary"
  | "language_unknown"
  | "unmapped_market"
  | "sequence_rejected";

/** One leadership contact at the company of an unconsumed signal, as the consumer's single read returns it. */
export type CandidateRawRow = {
  signal_id: string;
  company_key: string;
  signal_data: { postingId?: string; title?: string; url?: string; location?: string };
  person_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  role_group: string | null;
  company: string | null;
  preferred_language: string | null;
  country: string | null;
  email_status: string;
  bd_id: string;
  bd_name: string;
  bd_signature_html: string | null;
  bd_enabled: boolean;
  bd_has_mailbox: boolean;
  in_active_sequence: boolean;
  open_follow_up: boolean;
  already_drafted: boolean;
  // A computed expression: postgres-js hands it back as a string.
  last_touch_at: Date | string | null;
}

export interface ProspectCandidate {
  signalId: string;
  companyKey: string;
  posting: { title: string; url: string | null; location: string | null } | null;
  personId: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  roleGroup: string | null;
  company: string | null;
  preferredLanguage: string | null;
  language: MessageLanguage | null;
  emailStatus: string;
  bdId: string;
  bdName: string;
  bdSignatureHtml: string | null;
  bdEnabled: boolean;
  bdHasMailbox: boolean;
  inActiveSequence: boolean;
  openFollowUp: boolean;
  alreadyDrafted: boolean;
  lastTouchAt: Date | null;
}

export function candidateFromRow(r: CandidateRawRow): ProspectCandidate {
  const d = r.signal_data ?? {};
  return {
    signalId: r.signal_id,
    companyKey: r.company_key,
    posting: d.title ? { title: d.title, url: d.url ?? null, location: d.location ?? null } : null,
    personId: r.person_id,
    firstName: r.first_name,
    lastName: r.last_name,
    jobTitle: r.job_title,
    roleGroup: r.role_group,
    company: r.company,
    preferredLanguage: r.preferred_language,
    language: resolveProspectLanguage(r.preferred_language, r.country),
    emailStatus: r.email_status,
    bdId: r.bd_id,
    bdName: r.bd_name,
    bdSignatureHtml: r.bd_signature_html,
    bdEnabled: r.bd_enabled,
    bdHasMailbox: r.bd_has_mailbox,
    inActiveSequence: r.in_active_sequence,
    openFollowUp: r.open_follow_up,
    alreadyDrafted: r.already_drafted,
    lastTouchAt: r.last_touch_at === null ? null : parseDbTimestamp(r.last_touch_at),
  };
}

/**
 * The email statuses this path may DRAFT to. Owner's decision, 2026-11-19: "probable" is enough to write a draft,
 * and it is NOT enough to send one.
 *
 * The original rule was verified-only, on the argument that at scale a bounce burns the domain the whole team sells
 * from. What changed is not the appetite for risk, it is that the structure now carries it: an automatic draft lands
 * in a Sequence with reviewed_at, approved_at and scheduled_for null, and `bulkApprovalGate` refuses it server-side
 * until a human has opened it. The old rule protected against mail nobody read; the gate does that now.
 *
 * So this list is safe ONLY while a human stands between the draft and the send. **Anything that sends without that
 * review must re-require "verified" rather than reusing this constant** - see the test that pins both halves.
 */
export const DRAFTABLE_EMAIL_STATUSES = ["verified", "probable"] as const;

/** Gate 1 and gate 3 for one contact: the first thing that keeps them out, or null. */
function blocker(c: ProspectCandidate, now: Date): RefusalReason | null {
  if (!(DRAFTABLE_EMAIL_STATUSES as readonly string[]).includes(c.emailStatus ?? "")) return "email_not_verified";
  if (c.inActiveSequence) return "in_active_sequence";
  if (c.openFollowUp) return "open_follow_up";
  if (c.alreadyDrafted) return "already_drafted";
  const cutoff = now.getTime() - AUTO_PROSPECTING_COOLDOWN_DAYS * 86_400_000;
  if (c.lastTouchAt && c.lastTouchAt.getTime() > cutoff) return "recent_outreach";
  if (!c.language) return "language_unknown";
  return null;
}

export type ProspectDecision =
  | { kind: "draft"; signalId: string; candidate: ProspectCandidate }
  | { kind: "refuse"; signalId: string; personId: string; bdId: string; reason: RefusalReason }
  // Left unconsumed and unrecorded: the switch is off, or the BD is at today's cap. A later run picks it up.
  | { kind: "defer"; signalId: string; reason: "switch_off" | "daily_cap" | "no_mailbox" };

/**
 * One decision per signal. `candidates` arrive grouped by signal, best contact first. Pure: `draftedToday` (drafts already written
 * today, per BD) is read, never mutated; the running count lives in a local copy.
 */
export function planProspectRun(candidates: readonly ProspectCandidate[], draftedToday: ReadonlyMap<string, number>, now: Date): ProspectDecision[] {
  const bySignal = new Map<string, ProspectCandidate[]>();
  for (const c of candidates) bySignal.set(c.signalId, [...(bySignal.get(c.signalId) ?? []), c]);

  const used = new Map(draftedToday);
  const out: ProspectDecision[] = [];
  for (const [signalId, group] of bySignal) {
    const enabled = group.filter((c) => c.bdEnabled);
    const first = enabled[0];
    if (!first) {
      out.push({ kind: "defer", signalId, reason: "switch_off" });
      continue;
    }
    const pick = enabled.find((c) => blocker(c, now) === null);
    // The draft is written into the BD's own Sequence, which sends from their mailbox: without one there is nowhere to put it.
    if (pick && !pick.bdHasMailbox) {
      out.push({ kind: "defer", signalId, reason: "no_mailbox" });
      continue;
    }
    if (!pick) {
      out.push({ kind: "refuse", signalId, personId: first.personId, bdId: first.bdId, reason: blocker(first, now)! });
      continue;
    }
    if ((used.get(pick.bdId) ?? 0) >= AUTO_PROSPECTING_DAILY_CAP) {
      out.push({ kind: "defer", signalId, reason: "daily_cap" });
      continue;
    }
    used.set(pick.bdId, (used.get(pick.bdId) ?? 0) + 1);
    out.push({ kind: "draft", signalId, candidate: pick });
  }
  return out;
}

const NO_NAME = /^(unknown|n\/?a|none|null|undefined|-+)$/i;

/**
 * Gate 2: the generator must be able to REFUSE. With no concrete company fact to write from there is no draft. "Company: unknown"
 * once reached the prompt and the model substituted Avalith as the recipient (4 real emails), so a missing name, the sender's own
 * name, and a company with no open posting to point at are all refusals here, before the model is called.
 */
export function companyFactRefusal(companyName: string | null | undefined, company: OutreachMessageCompany | null): RefusalReason | null {
  const name = companyName?.trim() ?? "";
  if (!name || NO_NAME.test(name)) return "no_company_name";
  if (/avalith/i.test(name)) return "company_is_sender";
  if (!company || company.totalCount === 0 || company.postings.length === 0) return "no_open_posting";
  return null;
}

/**
 * What counts as CONTACT and what counts as a REPLY for "Tasa de respuesta",
 * with a date on both — owner decision 2026-11-06.
 *
 * The bug this replaces: the tile divided `person.status in ('replied','meeting')`
 * by `person.status in ('contacted','replied','meeting')` over the persons
 * CREATED in the period. `person.status` is a CACHE (deriveStatus.ts), and
 * `connectionStageCandidate` promotes a person to `replied` as soon as any
 * `person_bd_connection` row has `received_count > 0` — the imported LinkedIn
 * history, which carries no period at all. So the cohort was dated and the
 * evidence was not: measured on production 2026-11-06
 * (scripts/measure/reply-rate-evidence.ts) the all-time tile read 3029/8644 =
 * 35.0% while only 197 persons had real dated reply evidence (2.3%); of the
 * 2832 LinkedIn-only ones, 2827 had their last received message BEFORE their
 * own `created_at`, 880 days before on average, the oldest dated 2012-01-03.
 *
 * LinkedIn is OUT of this metric, on both sides — owner decision 2026-11-06,
 * and the single most important thing to know before editing this file. A
 * first version counted non-draft `message` rows as outreach (sent) and reply
 * (received). Measured against production for 2026: 664/1259 = 52.7% overall,
 * but 1044 of those 1259 persons (83%) entered the metric through LinkedIn
 * conversation traffic ALONE, and the two populations disagree — 583/1044 =
 * 55.8% on LinkedIn against 76/207 = 36.7% on CRM-recorded outreach. The
 * `message` table is the imported `messages.csv` export, so it carries every
 * conversation the BD ever had: colleagues, inbound recruiters, personal chat.
 * The tile was about to publish a LinkedIn chat rate under an outreach label.
 *
 * The owner's own reasoning: a LinkedIn conversation is the step BEFORE the
 * real outreach — "en teoría si se conversa x LinkedIn luego debemos ir x
 * correo y ahí sí es donde preciso que quede bien marcado". So the rate
 * measures the email/call/WhatsApp stage, where he makes decisions.
 *
 * ACCEPTED CONSEQUENCE, not a defect to fix: a contact who answers only on
 * LinkedIn now sits in the denominator with no credit in the numerator, so the
 * rate understates by however often that happens. The owner put LinkedIn out
 * of scope knowing this. Do NOT add a compensating branch, and do not "restore"
 * the `message`/`conversation` arm — it was deleted on purpose.
 *
 * The rule here does NOT invent new evidence. It mirrors the stage rules
 * `deriveStatus.ts` already applies (`activityStageCandidate`, `callStage`,
 * `whatsappStage`, `FIXED_STAGE_BY_TYPE`, `STATUS_NEUTRAL_ACTIVITY_TYPES`) and
 * adds the one thing the status cache cannot carry: WHEN. Where it diverges
 * from a plain "rank >= contacted" reading, it is because the denominator must
 * be evidence that WE reached out:
 *   - `reply_received` / `meeting_logged` / a `connected` INBOUND call are
 *     reply evidence only, never outreach;
 *   - a `status_change`/`status_backfill` is outreach only at 'contacted'
 *     (see RATE_OUTREACH_STATUSES for why 'replied'/'meeting' must not be).
 *
 * Both twins live here: `rateActivityEvent`/`resolveRateOutcome` are the pure
 * rule the unit tests pin, and the `*Sql` builders are the same rule in SQL for
 * `buildReportAggregatesQuery`'s single statement. Production runs the SQL, so
 * every branch of the predicates also carries a real row in
 * tests/db/reportsClientsAndPeriods.test.ts: a wrong `metadata` key would
 * otherwise pass the whole unit suite. `@/db/schema`-only import, so this stays
 * testable without a live DATABASE_URL (same convention as
 * effectiveActivityTime.ts).
 */
import { sql } from "drizzle-orm";
import { resolveEffectiveActivityAt } from "@/lib/contacts/effectiveActivityTime";
import type { ActivityRowForStatus } from "@/lib/status/deriveStatus";

/**
 * Every `activity.type` that can be rate evidence — the umbrella filter both
 * twins apply FIRST, so a status-neutral type (`call_attempt`,
 * `auto_reply_received`, `whatsapp_no_channel`, `email_bounced`, the meeting
 * and follow-up bookkeeping types) can never reach the metadata branches
 * below. Pinned against `STATUS_NEUTRAL_ACTIVITY_TYPES` by
 * tests/unit/reportsReplyRate.test.ts.
 */
export const RATE_EVENT_ACTIVITY_TYPES = [
  "email_sent",
  "call",
  "whatsapp",
  "status_change",
  "status_backfill",
  "reply_received",
  "meeting_logged",
] as const;

/** The two types whose stage comes from `metadata.status`, not from the type (deriveStatus.ts). */
const RATE_STATUS_ACTIVITY_TYPES = ["status_change", "status_backfill"] as const;
/**
 * `metadata.status` values that are contact evidence — 'contacted' ALONE, not
 * `deriveStatus`'s whole rank >= contacted set. For a dated metric the wider
 * list is a structural bias toward 100%: a single manual move to 'replied'
 * would satisfy outreach and reply at the SAME instant, so
 * `max(reply) >= min(outreach)` holds by equality and one click manufactures a
 * guaranteed hit in both counts. Measured on production 2026-11-06 it was 1
 * person in 1259 — harmless then, growing with every manual stage change.
 * A person whose only evidence is a manual move to "Respondió" now has no
 * dated outreach in the period and correctly drops out of the rate entirely.
 */
const RATE_OUTREACH_STATUSES = ["contacted"] as const;
/** `metadata.status` values that are reply evidence (rank >= replied). */
const RATE_REPLY_STATUSES = ["replied", "meeting"] as const;
/** Types that are reply evidence on their own (FIXED_STAGE_BY_TYPE's rank >= replied entries). */
const RATE_FIXED_REPLY_TYPES = ["reply_received", "meeting_logged"] as const;

/**
 * One dated piece of evidence. A single row can still be both: an OUTBOUND
 * `connected` call is the touch and the conversation at once. That is the
 * owner's own rule from 2026-09-26 and it is deliberate — the call really
 * happened and someone really answered — so unlike the `status_change` case
 * above it is kept, not narrowed.
 */
export interface RateEvent {
  at: Date;
  outreach: boolean;
  reply: boolean;
}

function includes(list: readonly string[], value: string | undefined): boolean {
  return value !== undefined && list.includes(value);
}

function metaString(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * One `activity` row's contribution, dated by `resolveEffectiveActivityAt` —
 * the ONE shared time rule (`metadata.originalAt` for `status_backfill`,
 * `metadata.occurredAt` for `OCCURRED_AT_ACTIVITY_TYPES`, `NULL` for a
 * non-touch or soft-deleted row), so an imported `status_backfill` lands in
 * the period it reconstructs, never in the period the import ran.
 */
export function rateActivityEvent(row: ActivityRowForStatus & { deletedAt?: Date | null }): RateEvent | null {
  if (!(RATE_EVENT_ACTIVITY_TYPES as readonly string[]).includes(row.type)) return null;
  const at = resolveEffectiveActivityAt(row);
  if (!at) return null;
  const isStatusRow = (RATE_STATUS_ACTIVITY_TYPES as readonly string[]).includes(row.type);
  const status = isStatusRow ? metaString(row.metadata, "status") : undefined;
  const outcome = metaString(row.metadata, "outcome");
  const outreach =
    row.type === "email_sent" ||
    (row.type === "call" && metaString(row.metadata, "direction") === "outbound") ||
    (row.type === "whatsapp" && outcome === "sent") ||
    (isStatusRow && includes(RATE_OUTREACH_STATUSES, status));
  const reply =
    (RATE_FIXED_REPLY_TYPES as readonly string[]).includes(row.type) ||
    (row.type === "call" && outcome === "connected") ||
    (row.type === "whatsapp" && outcome === "replied") ||
    (isStatusRow && includes(RATE_REPLY_STATUSES, status));
  return outreach || reply ? { at, outreach, reply } : null;
}

export interface RateOutcome {
  /** In the denominator: at least one outreach event inside the window. */
  contacted: boolean;
  /** In the numerator: a reply event inside the window, at or after `firstOutreachAt`. */
  replied: boolean;
  firstOutreachAt: Date | null;
  /** The FIRST qualifying reply — the date the drill-down shows. */
  replyAt: Date | null;
}

/**
 * The period rule, for ONE person. `[fromIso, toIso)` on both sides, and the
 * reply must not predate the period's first outreach — otherwise an old
 * conversation would be credited to this period's campaign, which is the exact
 * distortion being fixed. Pure: reads the array, never writes it.
 */
export function resolveRateOutcome(events: readonly RateEvent[], fromIso: string, toIso: string): RateOutcome {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  const inWindow = events.filter((e) => e.at.getTime() >= from && e.at.getTime() < to);
  let firstOutreachAt: Date | null = null;
  for (const e of inWindow) {
    if (e.outreach && (firstOutreachAt === null || e.at < firstOutreachAt)) firstOutreachAt = e.at;
  }
  if (firstOutreachAt === null) return { contacted: false, replied: false, firstOutreachAt: null, replyAt: null };
  let replyAt: Date | null = null;
  for (const e of inWindow) {
    if (e.reply && e.at >= firstOutreachAt && (replyAt === null || e.at < replyAt)) replyAt = e.at;
  }
  return { contacted: true, replied: replyAt !== null, firstOutreachAt, replyAt };
}

/**
 * Literal quoted list for a trusted module constant (never user input) — the
 * lists above are the single definition, and rendering them as literals rather
 * than bound params lets the planner use `activity_type_idx`.
 */
function sqlList(values: readonly string[]) {
  return sql.raw(values.map((v) => `'${v}'`).join(", "));
}

/** Umbrella `activity.type in (...)` filter — see RATE_EVENT_ACTIVITY_TYPES. */
export function rateEventActivityTypesSql() {
  return sqlList(RATE_EVENT_ACTIVITY_TYPES);
}

/** SQL twin of `rateActivityEvent(...).outreach`. Call sites FROM `activity` un-aliased (rule 4). */
export function rateOutreachActivitySql() {
  return sql`(activity.type = 'email_sent'
        or (activity.type = 'call' and activity.metadata->>'direction' = 'outbound')
        or (activity.type = 'whatsapp' and activity.metadata->>'outcome' = 'sent')
        or (activity.type in (${sqlList(RATE_STATUS_ACTIVITY_TYPES)}) and activity.metadata->>'status' in (${sqlList(RATE_OUTREACH_STATUSES)})))`;
}

/** SQL twin of `rateActivityEvent(...).reply`. Call sites FROM `activity` un-aliased (rule 4). */
export function rateReplyActivitySql() {
  return sql`(activity.type in (${sqlList(RATE_FIXED_REPLY_TYPES)})
        or (activity.type = 'call' and activity.metadata->>'outcome' = 'connected')
        or (activity.type = 'whatsapp' and activity.metadata->>'outcome' = 'replied')
        or (activity.type in (${sqlList(RATE_STATUS_ACTIVITY_TYPES)}) and activity.metadata->>'status' in (${sqlList(RATE_REPLY_STATUSES)})))`;
}

// DB twin of the Lusha ledger (D7): the reservation, the settles and the two reads. This module never
// imports client.ts: the HTTP call is the caller's job and must happen between reserve() and a settle,
// OUTSIDE any transaction and never under the lock. The cap is read from this ledger only, never from
// Lusha's eventually consistent /v3/account/usage.

import { and, desc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { activity, company, duplicateCandidate, lushaReveal, person, personPropertyHistory } from "@/db/schema";
import { linkedinProfileHref } from "@/lib/contacts/linkedinProfile";
import { isLushaEnabled } from "./adminDb";
import { artDayWindow, planReservation } from "./cap";
import { pickEmail, pickPhone } from "./parse";
import type { CanRevealEntry, LushaField } from "./pricing";
import { planRevealedEmailWrite, planRevealedPhoneWrite } from "./revealPlan";
import type { Subject } from "./reveal";
import { STRANDED_AFTER_MS, toLatestRows, type LatestRows } from "./revealState";

export { FUNCTION_MAX_DURATION_MS, STRANDED_AFTER_MS } from "./revealState";

/** Serializes every reservation: a unique index cannot bound a sum() over rows that do not exist yet. */
export const LUSHA_CAP_LOCK = 0x4c55_5348; // "LUSH"

type Reader = Pick<typeof db, "select">;

/** Credits spent in the AR business day of `now`: charged where known, else the reserved amount (failed / unknown rows keep counting, D8). */
export async function getDailySpend(now: Date = new Date(), reader: Reader = db): Promise<number> {
  const { start, end } = artDayWindow(now);
  const [row] = await reader
    .select({ spent: sql<string>`coalesce(sum(coalesce(${lushaReveal.creditsCharged}, ${lushaReveal.creditsReserved})), 0)` })
    .from(lushaReveal)
    .where(and(gte(lushaReveal.at, start), lt(lushaReveal.at, end)));
  return Number(row?.spent); // drizzle returns the bigint sum as a string; evaluateCap refuses a non-integer
}

export type ReserveResult =
  | { ok: true; reservationId: string; credits: number; searchId: string | null }
  | { ok: false; reason: "cap_exceeded"; remaining: number }
  | { ok: false; reason: "busy" | "outcome_unknown" | "not_enabled" | "no_search" | "no_price_list" | "not_revealable" | "merged" | "not_found" | "already_revealed" };

/**
 * ONE short transaction: advisory lock, the day's spend, a fresh read of the latest search row (price and
 * staleness: it may have been rejected meanwhile), then the claim insert. `busy` = an in-flight row exists.
 */
export async function reserve(
  input: { personId: string; field: LushaField; actorBdId: string; cap: number; now?: Date },
  database: typeof db = db,
): Promise<ReserveResult> {
  const now = input.now ?? new Date();
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LUSHA_CAP_LOCK})`);
    // lusha-per-bd: the switch is checked where the cap is, so no caller can reserve a credit without passing it. A BD switched off
    // after prepare() ran (an open dialog) is stopped here, before the row exists and so before any Lusha call.
    if (!(await isLushaEnabled(input.actorBdId, tx))) return { ok: false, reason: "not_enabled" };
    // Reap before anything is read: a killed function leaves its row `reserved`, which used to answer "busy" forever. Under the
    // lock, so two reserves cannot both release the same row. The row is FAILED with its credits_reserved untouched: the cap
    // keeps counting what may have been billed (in its own Argentina day), and the field takes the outcome_unknown guard.
    const reaped = (await tx.execute(sql`update lusha_reveal set state = 'failed', error_code = 'reaped', settled_at = ${now.toISOString()}::timestamptz where state = 'reserved' and at < ${new Date(now.getTime() - STRANDED_AFTER_MS).toISOString()}::timestamptz returning field as rp_field`)) as unknown as { rp_field: string }[];
    // A stranded row is invisible otherwise: say so.
    if (reaped.length) console.warn(`[lusha] reaped ${reaped.length} stranded reservation(s): ${reaped.map((r) => r.rp_field).join(",")}`);
    // FOR SHARE makes mergeContacts' FOR UPDATE wait for this reservation instead of racing it (credits on a tombstone).
    // The same read answers "do we already own this value": a settled `revealed` row of ANY search blocks a second payment.
    const [owner] = await tx
      .select({
        mergedIntoId: person.mergedIntoId,
        // THE AUTHORITY IS THE STATE READ HERE, INSIDE THE LOCK, never a fact carried in from outside it. prepare() ran earlier and
        // outside the lock: by now the row it saw may have been reaped by ANY other reserve (the sweep is global), or failed as
        // outcome_unknown by its own function. "Did I reap it?" would miss both, and a second paid call would go out. So a reveal
        // is refused whenever the ledger says a failed, possibly-billed attempt exists for this field of the CURRENT search (the
        // same scope getRevealState reads). An explicit new search has a new id and reopens the field.
        unknown: sql<boolean>`exists(select 1 from lusha_reveal r where r.person_id = ${input.personId} and r.field = ${input.field} and r.state = 'failed' and r.error_code in ('outcome_unknown', 'reaped') and r.search_id = (select s.id from lusha_reveal s where s.person_id = ${input.personId} and s.field = 'search' and s.state = 'settled' order by s.at desc limit 1))`,
        owned: sql<boolean>`exists(select 1 from lusha_reveal r where r.person_id = ${input.personId} and r.field = ${input.field} and ((r.state = 'settled' and r.outcome = 'revealed') or (r.state = 'failed' and r.error_code = 'settle_failed')))`,
      })
      .from(person)
      .where(eq(person.id, input.personId))
      .for("share");
    if (!owner) return { ok: false, reason: "not_found" };
    if (owner.mergedIntoId) return { ok: false, reason: "merged" };
    if (owner.owned) return { ok: false, reason: "already_revealed" };
    if (input.field !== "search" && owner.unknown) return { ok: false, reason: "outcome_unknown" };
    const spentToday = await getDailySpend(now, tx);
    let search: { id: string; lushaContactId: string | null; payload: unknown } | null = null;
    if (input.field !== "search") {
      const [s] = await tx
        .select()
        .from(lushaReveal)
        // The latest SETTLED search: a failed attempt (429, timeout) must never hide the paid match it followed.
        .where(and(eq(lushaReveal.personId, input.personId), eq(lushaReveal.field, "search"), eq(lushaReveal.state, "settled")))
        .orderBy(desc(lushaReveal.at))
        .limit(1);
      if (!s || s.outcome !== "matched") return { ok: false, reason: "no_search" };
      search = s;
    }
    const list = (search?.payload as { canReveal?: CanRevealEntry[] } | null)?.canReveal ?? null;
    const plan = planReservation({ field: input.field, canReveal: list, spentToday, cap: input.cap });
    if (!plan.ok) return plan;
    const [row] = await tx
      .insert(lushaReveal)
      .values({
        personId: input.personId,
        field: input.field,
        searchId: search?.id ?? null,
        lushaContactId: search?.lushaContactId ?? null,
        creditsReserved: plan.credits,
        actorBdId: input.actorBdId,
        at: now,
      })
      .onConflictDoNothing({ target: [lushaReveal.personId, lushaReveal.field], where: sql`state = 'reserved'` })
      .returning({ id: lushaReveal.id });
    return row ? { ok: true, reservationId: row.id, credits: plan.credits, searchId: search?.id ?? null } : { ok: false, reason: "busy" };
  });
}

const inFlight = (id: string) => and(eq(lushaReveal.id, id), eq(lushaReveal.state, "reserved"));

/**
 * Settles a search. `creditsCharged` is billing.creditsCharged; null (unreported) leaves the reserved
 * amount counting. False when the reservation was not in flight (already settled).
 */
export async function settleSearch(
  input: { reservationId: string; outcome: "matched" | "no_match" | "compliance_restricted"; creditsCharged: number | null; lushaContactId?: string | null; payload: unknown },
  database: typeof db = db,
): Promise<boolean> {
  const rows = await database
    .update(lushaReveal)
    .set({ state: "settled", outcome: input.outcome, creditsCharged: input.creditsCharged, lushaContactId: input.lushaContactId ?? null, payload: input.payload ?? {}, settledAt: new Date() })
    .where(inFlight(input.reservationId))
    .returning({ id: lushaReveal.id });
  return rows.length > 0;
}

/**
 * A call that failed or whose outcome is unknown (timeout, 5xx, a 2xx with an unreadable body =
 * `outcome_unknown`). `credits_charged` stays null, so the RESERVED amount keeps counting (D8).
 * A failed row falls out of the in-flight index, so it never blocks a retry.
 */
export async function failReservation(reservationId: string, errorCode: string, payload?: unknown, database: typeof db = db): Promise<boolean> {
  const rows = await database
    .update(lushaReveal)
    // `payload` keeps a paid-for raw value when the settle itself failed: it is merged in, never replacing what is there.
    .set({ state: "failed", errorCode, settledAt: new Date(), ...(payload === undefined ? {} : { payload: sql`${lushaReveal.payload} || ${JSON.stringify(payload)}::jsonb` }) })
    .where(inFlight(reservationId))
    .returning({ id: lushaReveal.id });
  return rows.length > 0;
}

/** "No es mi contacto": marks the latest matched search rejected. Charges nothing and never touches credits_charged (D5). */
export async function rejectMatch(personId: string, bdId: string, database: typeof db = db): Promise<boolean> {
  const latest = sql`(select s.id from lusha_reveal s where s.person_id = ${personId} and s.field = 'search' and s.state = 'settled' order by s.at desc limit 1)`;
  const rows = await database
    .update(lushaReveal)
    .set({ outcome: "match_rejected", rejectedByBdId: bdId, rejectedAt: new Date() })
    .where(and(eq(lushaReveal.id, latest), eq(lushaReveal.state, "settled"), eq(lushaReveal.outcome, "matched")))
    .returning({ id: lushaReveal.id });
  return rows.length > 0;
}

export interface RevealSettlement {
  /** `already_held`: the paid phone is a number the Contact already had. Recorded honestly, nothing written. */
  outcome: "revealed" | "no_value" | "compliance_restricted" | "already_held";
  value: string | null;
  /** The person column written, or null when nothing was (ineligible, both phone columns occupied, unparsable). */
  written: "email" | "phone" | "mobilePhone" | null;
  /** Another live Contact that already holds the revealed email; the pair was enqueued for the admin (D12). */
  duplicate: { personId: string; name: string } | null;
  /** The Contact write failed and was rolled back; the paid value is still on the ledger. */
  writeFailed: boolean;
}

const searchRow = alias(lushaReveal, "search_row");

/**
 * The company domains a revealed email of this Contact should be on, STRONGEST FIRST: ours (what the
 * search asked Lusha about), then the one Lusha matched, which is Lusha's opinion of the employer and
 * must not outrank ours when they disagree (pickEmail ranks by this position). Read from the ledger row
 * itself rather than taken from the caller, so the recovery path (applyStoredReveal, days later) chooses
 * exactly like the live settle. Empty for a Contact with no company domain, which only restores the
 * previous order-of-arrival behaviour.
 */
async function companyDomainsOf(reader: Reader, ledgerId: string): Promise<string[]> {
  const [row] = await reader
    .select({ own: company.domain, matched: searchRow.payload })
    .from(lushaReveal)
    .innerJoin(person, eq(person.id, lushaReveal.personId))
    .leftJoin(company, eq(company.companyKey, person.companyKey))
    // NULL on a search row (it has no search_id), so a search settle simply gets our own domain.
    .leftJoin(searchRow, eq(searchRow.id, lushaReveal.searchId))
    .where(eq(lushaReveal.id, ledgerId))
    .limit(1);
  const identity = (row?.matched as { identity?: { domain?: unknown } } | null)?.identity;
  return [row?.own, identity?.domain].filter((d): d is string => typeof d === "string" && d.trim() !== "");
}

/**
 * Settles a reveal in ONE transaction: ledger, person, history, activity and duplicate candidate. The
 * Contact writes run in a savepoint, so a failure there rolls back only the person side: the paid value
 * and the real charge stay on the ledger and the BD is never charged twice for it. Null when the
 * reservation was not in flight.
 */
export async function settleReveal(
  input: { reservationId: string; actorBdId: string; field: "emails" | "phones"; emails?: unknown; phones?: unknown; creditsCharged: number | null; compliance?: boolean },
  database: typeof db = db,
): Promise<RevealSettlement | null> {
  const raw = input.field === "emails" ? input.emails : input.phones;
  return database.transaction(async (tx) => {
    // Choosing among several revealed emails needs the company domains, so the pick happens here, not
    // before the transaction. A compliance settle short-circuits it: there is no value to choose.
    const pick = input.compliance ? null : input.field === "emails" ? pickEmail(raw, await companyDomainsOf(tx, input.reservationId)) : pickPhone(raw);
    const outcome = input.compliance ? "compliance_restricted" : pick?.ok ? "revealed" : "no_value";
    const value = pick?.ok ? pick.value : null;
    const normalized = value === null ? null : input.field === "emails" ? value.trim().toLowerCase() : value.replace(/\D/g, "");
    const [row] = await tx
      .update(lushaReveal)
      .set({
        state: "settled",
        outcome,
        value,
        valueNormalized: normalized,
        creditsCharged: input.creditsCharged,
        payload: input.compliance ? {} : { [input.field]: raw ?? null }, // the FULL raw array: the first phone reveal is the measurement (D17)
        errorCode: pick && !pick.ok && pick.reason === "unparsable_value" ? "unparsable_value" : null,
        settledAt: new Date(),
      })
      .where(inFlight(input.reservationId))
      .returning({ personId: lushaReveal.personId, lushaContactId: lushaReveal.lushaContactId });
    if (!row) return null;
    const result: RevealSettlement = { outcome, value, written: null, duplicate: null, writeFailed: false };
    if (!pick?.ok) return result;
    try {
      await tx.transaction(async (sp) => {
        const applied = await writeToContact(sp, { ledgerId: input.reservationId, personId: row.personId, field: input.field, pick, normalized, actorBdId: input.actorBdId, lushaId: row.lushaContactId ?? "", creditsCharged: input.creditsCharged });
        if (applied.alreadyHeld) result.outcome = "already_held";
        result.written = applied.written;
        result.duplicate = applied.duplicate;
      });
    } catch (e) {
      result.written = null;
      result.duplicate = null;
      result.writeFailed = true;
      // Keep the cause: a programming error must be diagnosable from the ledger, not silent.
      const cause = JSON.stringify({ writeError: { code: (e as { code?: unknown })?.code ?? null, message: String((e as Error)?.message ?? e).slice(0, 300) } });
      await tx.update(lushaReveal).set({ errorCode: "write_failed", payload: sql`${lushaReveal.payload} || ${cause}::jsonb` }).where(eq(lushaReveal.id, input.reservationId));
    }
    return result;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The Contact side of a paid reveal, shared by the settle and by the no-Lusha recovery: person, history, activity
 * and duplicate candidate. Runs inside the caller's (savepoint) transaction and throws when it cannot write.
 */
async function writeToContact(
  sp: Tx,
  i: { ledgerId: string; personId: string; field: "emails" | "phones"; pick: Extract<ReturnType<typeof pickEmail>, { ok: true }>; normalized: string | null; actorBdId: string; lushaId: string; creditsCharged: number | null },
): Promise<{ alreadyHeld: boolean; written: RevealSettlement["written"]; duplicate: RevealSettlement["duplicate"] }> {
  const [p] = await sp.select().from(person).where(eq(person.id, i.personId)).for("update");
  if (!p) throw new Error("person not found");
  const plan = (i.field === "emails" ? planRevealedEmailWrite : planRevealedPhoneWrite)(p, i.pick, { actorBdId: i.actorBdId, lushaId: i.lushaId, creditsCharged: i.creditsCharged });
  if (plan.alreadyHeld) await sp.update(lushaReveal).set({ outcome: "already_held", errorCode: "phone_already_held" }).where(eq(lushaReveal.id, i.ledgerId));
  if (plan.personUpdate) await sp.update(person).set(plan.personUpdate).where(eq(person.id, p.id));
  if (plan.historyRows.length) await sp.insert(personPropertyHistory).values(plan.historyRows);
  // Direct insert, not createActivityInTx: the type is status-neutral by construction (D15).
  if (plan.activity) await sp.insert(activity).values(plan.activity);
  const written: RevealSettlement["written"] = !plan.personUpdate ? null : i.field === "emails" ? "email" : "mobilePhone" in plan.personUpdate ? "mobilePhone" : "phone";
  const out = { alreadyHeld: plan.alreadyHeld === true, written, duplicate: null as RevealSettlement["duplicate"] };
  if (written !== "email" || !i.normalized) return out;
  const [other] = await sp
    .select({ id: person.id, first: person.firstName, last: person.lastName })
    .from(person)
    .where(and(eq(person.emailNormalized, i.normalized), ne(person.id, p.id), isNull(person.mergedIntoId)))
    .limit(1);
  if (!other) return out;
  const [personAId, personBId] = [p.id, other.id].sort();
  await sp.insert(duplicateCandidate).values({ personAId, personBId, reason: "lusha_reveal_email", matchKey: i.normalized }).onConflictDoNothing();
  return { ...out, duplicate: { personId: other.id, name: [other.first, other.last].filter(Boolean).join(" ") } };
}

/**
 * Task 6.11: the credit was spent and the Contact write failed, so the value sits on the ledger and reserve() will
 * (correctly) never pay for it again. This applies THAT value with no Lusha call, no reservation and no change to
 * credits_charged, in one transaction, then clears the error. Refused for a row that did not fail to write.
 */
export async function applyStoredReveal(
  input: { personId: string; field: "emails" | "phones"; actorBdId: string },
  database: typeof db = db,
): Promise<{ ok: true; value: string | null; written: RevealSettlement["written"]; duplicate: RevealSettlement["duplicate"] } | { ok: false; reason: "not_applicable" }> {
  return database.transaction(async (tx) => {
    // Two parked shapes: a settled `revealed` row whose Contact write failed, and a `failed` row whose settle itself failed
    // (reveal keeps the raw paid value in its payload). Both hold a value that was already paid for.
    const [row] = await tx
      .select()
      .from(lushaReveal)
      .where(
        and(
          eq(lushaReveal.personId, input.personId),
          eq(lushaReveal.field, input.field),
          or(
            and(eq(lushaReveal.state, "settled"), eq(lushaReveal.outcome, "revealed"), eq(lushaReveal.errorCode, "write_failed")),
            and(eq(lushaReveal.state, "failed"), eq(lushaReveal.errorCode, "settle_failed")),
          ),
        ),
      )
      .orderBy(desc(lushaReveal.at))
      .limit(1)
      .for("update");
    if (!row) return { ok: false, reason: "not_applicable" } as const;
    const payload = (row.payload as Record<string, unknown> | null) ?? {};
    const pick = input.field === "emails" ? pickEmail(payload[input.field], await companyDomainsOf(tx, row.id)) : pickPhone(payload[input.field]);
    // The pick is the single source of truth for what gets written, and the row is updated to match it
    // below: a row settled before the company-domain ranking existed re-picks differently, and a ledger
    // that disagreed with the Contact (and with the duplicate check, which runs on `normalized`) would
    // be an audit trail of a value nobody holds.
    const value = pick.ok ? pick.value : null;
    const normalized = value === null ? null : input.field === "emails" ? value.trim().toLowerCase() : value.replace(/\D/g, "");
    // A failed row is settled now, from what was parked: the charge Lusha reported (else the reserved amount keeps counting).
    const charged = row.state === "failed" ? (typeof payload.creditsCharged === "number" ? payload.creditsCharged : null) : row.creditsCharged;
    if (row.state === "failed") {
      await tx.update(lushaReveal).set({ state: "settled", outcome: pick.ok ? "revealed" : "no_value", value, valueNormalized: normalized, creditsCharged: charged, errorCode: pick.ok ? null : "unparsable_value", settledAt: new Date() }).where(eq(lushaReveal.id, row.id));
    }
    if (!pick.ok) return { ok: false, reason: "not_applicable" } as const;
    const applied = await writeToContact(tx, { ledgerId: row.id, personId: row.personId, field: input.field, pick, normalized, actorBdId: input.actorBdId, lushaId: row.lushaContactId ?? "", creditsCharged: charged });
    await tx.update(lushaReveal).set({ value, valueNormalized: normalized, errorCode: applied.alreadyHeld ? "phone_already_held" : null, payload: sql`${lushaReveal.payload} - 'writeError'` }).where(eq(lushaReveal.id, row.id));
    return { ok: true, value, written: applied.written, duplicate: applied.duplicate } as const;
  });
}

/**
 * The latest ledger row per field for the CURRENT search, except that a paid (`revealed`) row of any search wins
 * its field: at most three rows, one scan of
 * (person_id, field, at desc). `complianceBlocked` covers every search of the Contact (D6).
 */
export async function getRevealState(personId: string, reader: Pick<typeof db, "selectDistinctOn"> = db): Promise<LatestRows> {
  const latestSearch = sql`(select s.id from lusha_reveal s where s.person_id = ${personId} and s.field = 'search' and s.state = 'settled' order by s.at desc limit 1)`;
  const rows = await reader
    .selectDistinctOn([lushaReveal.field], {
      id: lushaReveal.id,
      searchId: lushaReveal.searchId,
      at: lushaReveal.at,
      field: lushaReveal.field,
      state: lushaReveal.state,
      errorCode: lushaReveal.errorCode,
      outcome: lushaReveal.outcome,
      value: lushaReveal.value,
      payload: lushaReveal.payload,
      // Display-only columns, in the same statement (no extra round trip). Table-qualified as literal text: see PERFORMANCE.md.
      actorName: sql<string | null>`(select b.name from bd b where b.id = lusha_reveal.actor_bd_id)`,
      settledAt: lushaReveal.settledAt,
      twin: sql<{ id: string; name: string } | null>`(select json_build_object('id', p.id, 'name', btrim(concat_ws(' ', p.first_name, p.last_name))) from person p where lusha_reveal.field = 'emails' and lusha_reveal.state = 'settled' and lusha_reveal.outcome = 'revealed' and p.email_normalized = lusha_reveal.value_normalized and p.id <> lusha_reveal.person_id and p.merged_into_id is null limit 1)`,
      blocked: sql<boolean>`exists(select 1 from lusha_reveal c where c.person_id = ${personId} and c.outcome = 'compliance_restricted')`,
    })
    .from(lushaReveal)
    .where(
      and(
        eq(lushaReveal.personId, personId),
        // The current search's rows, plus any paid value of ANY search: a revealed value is person-level (a merge can leave it on an older search).
        or(eq(lushaReveal.field, "search"), sql`${lushaReveal.searchId} = ${latestSearch}`, and(eq(lushaReveal.state, "settled"), eq(lushaReveal.outcome, "revealed")), and(eq(lushaReveal.state, "failed"), eq(lushaReveal.errorCode, "settle_failed"))),
      ),
    )
    .orderBy(
      lushaReveal.field,
      // A paid value first; for `search`, a settled row before any failed attempt, so a 429 never hides the last settled search.
      sql`((${lushaReveal.state} = 'settled' and (${lushaReveal.outcome} = 'revealed' or ${lushaReveal.field} = 'search')) or ${lushaReveal.errorCode} = 'settle_failed') desc`,
      desc(lushaReveal.at),
    );
  return toLatestRows(rows as Parameters<typeof toLatestRows>[0]);
}

/** What a search and the eligibility checks need about one Contact: names, held contact values, LinkedIn and the company domain. */
export async function loadRevealSubject(personId: string, reader: Pick<typeof db, "select"> = db): Promise<Subject | null> {
  const [row] = await reader
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      emailStatus: person.emailStatus,
      emailSource: person.emailSource,
      phone: person.phone,
      mobilePhone: person.mobilePhone,
      mergedIntoId: person.mergedIntoId,
      profileKey: person.profileKey,
      companyDomain: company.domain,
    })
    .from(person)
    .leftJoin(company, eq(company.companyKey, person.companyKey))
    .where(eq(person.id, personId));
  if (!row) return null;
  const { profileKey, ...rest } = row;
  return { ...rest, linkedinUrl: linkedinProfileHref(profileKey) };
}

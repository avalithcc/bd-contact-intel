// DB twin of the Lusha ledger (D7): the reservation, the settles and the two reads. This module never
// imports client.ts: the HTTP call is the caller's job and must happen between reserve() and a settle,
// OUTSIDE any transaction and never under the lock. The cap is read from this ledger only, never from
// Lusha's eventually consistent /v3/account/usage.

import { and, desc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, company, duplicateCandidate, lushaReveal, person, personPropertyHistory } from "@/db/schema";
import { linkedinProfileHref } from "@/lib/contacts/linkedinProfile";
import { artDayWindow, planReservation } from "./cap";
import { pickEmail, pickPhone } from "./parse";
import type { CanRevealEntry, LushaField } from "./pricing";
import { planRevealedEmailWrite, planRevealedPhoneWrite } from "./revealPlan";
import type { Subject } from "./reveal";
import { toLatestRows, type LatestRows } from "./revealState";

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
  | { ok: false; reason: "busy" | "no_search" | "no_price_list" | "not_revealable" | "merged" | "not_found" | "already_revealed" };

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
    // FOR SHARE makes mergeContacts' FOR UPDATE wait for this reservation instead of racing it (credits on a tombstone).
    // The same read answers "do we already own this value": a settled `revealed` row of ANY search blocks a second payment.
    const [owner] = await tx
      .select({
        mergedIntoId: person.mergedIntoId,
        owned: sql<boolean>`exists(select 1 from lusha_reveal r where r.person_id = ${input.personId} and r.field = ${input.field} and r.state = 'settled' and r.outcome = 'revealed')`,
      })
      .from(person)
      .where(eq(person.id, input.personId))
      .for("share");
    if (!owner) return { ok: false, reason: "not_found" };
    if (owner.mergedIntoId) return { ok: false, reason: "merged" };
    if (owner.owned) return { ok: false, reason: "already_revealed" };
    const spentToday = await getDailySpend(now, tx);
    let search: { id: string; lushaContactId: string | null; payload: unknown } | null = null;
    if (input.field !== "search") {
      const [s] = await tx
        .select()
        .from(lushaReveal)
        .where(and(eq(lushaReveal.personId, input.personId), eq(lushaReveal.field, "search")))
        .orderBy(desc(lushaReveal.at))
        .limit(1);
      if (!s || s.state !== "settled" || s.outcome !== "matched") return { ok: false, reason: "no_search" };
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
  const latest = sql`(select s.id from lusha_reveal s where s.person_id = ${personId} and s.field = 'search' order by s.at desc limit 1)`;
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
  const pick = input.compliance ? null : input.field === "emails" ? pickEmail(raw) : pickPhone(raw);
  const outcome = input.compliance ? "compliance_restricted" : pick?.ok ? "revealed" : "no_value";
  const value = pick?.ok ? pick.value : null;
  const normalized = value === null ? null : input.field === "emails" ? value.trim().toLowerCase() : value.replace(/\D/g, "");
  return database.transaction(async (tx) => {
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
        const [p] = await sp.select().from(person).where(eq(person.id, row.personId)).for("update");
        if (!p) throw new Error("person not found");
        const plan = (input.field === "emails" ? planRevealedEmailWrite : planRevealedPhoneWrite)(p, pick, {
          actorBdId: input.actorBdId,
          lushaId: row.lushaContactId ?? "",
          creditsCharged: input.creditsCharged,
        });
        if (plan.alreadyHeld) {
          result.outcome = "already_held";
          await sp.update(lushaReveal).set({ outcome: "already_held", errorCode: "phone_already_held" }).where(eq(lushaReveal.id, input.reservationId));
        }
        if (plan.personUpdate) await sp.update(person).set(plan.personUpdate).where(eq(person.id, p.id));
        if (plan.historyRows.length) await sp.insert(personPropertyHistory).values(plan.historyRows);
        // Direct insert, not createActivityInTx: the type is status-neutral by construction (D15).
        if (plan.activity) await sp.insert(activity).values(plan.activity);
        result.written = !plan.personUpdate ? null : input.field === "emails" ? "email" : "mobilePhone" in plan.personUpdate ? "mobilePhone" : "phone";
        if (result.written !== "email" || !normalized) return;
        const [other] = await sp
          .select({ id: person.id, first: person.firstName, last: person.lastName })
          .from(person)
          .where(and(eq(person.emailNormalized, normalized), ne(person.id, p.id), isNull(person.mergedIntoId)))
          .limit(1);
        if (!other) return;
        const [personAId, personBId] = [p.id, other.id].sort();
        await sp.insert(duplicateCandidate).values({ personAId, personBId, reason: "lusha_reveal_email", matchKey: normalized }).onConflictDoNothing();
        result.duplicate = { personId: other.id, name: [other.first, other.last].filter(Boolean).join(" ") };
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

/**
 * The latest ledger row per field for the CURRENT search, except that a paid (`revealed`) row of any search wins
 * its field: at most three rows, one scan of
 * (person_id, field, at desc). `complianceBlocked` covers every search of the Contact (D6).
 */
export async function getRevealState(personId: string, reader: Pick<typeof db, "selectDistinctOn"> = db): Promise<LatestRows> {
  const latestSearch = sql`(select s.id from lusha_reveal s where s.person_id = ${personId} and s.field = 'search' order by s.at desc limit 1)`;
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
      blocked: sql<boolean>`exists(select 1 from lusha_reveal c where c.person_id = ${personId} and c.outcome = 'compliance_restricted')`,
    })
    .from(lushaReveal)
    .where(
      and(
        eq(lushaReveal.personId, personId),
        // The current search's rows, plus any paid value of ANY search: a revealed value is person-level (a merge can leave it on an older search).
        or(eq(lushaReveal.field, "search"), sql`${lushaReveal.searchId} = ${latestSearch}`, and(eq(lushaReveal.state, "settled"), eq(lushaReveal.outcome, "revealed"))),
      ),
    )
    .orderBy(lushaReveal.field, sql`(${lushaReveal.state} = 'settled' and ${lushaReveal.outcome} = 'revealed') desc`, desc(lushaReveal.at));
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

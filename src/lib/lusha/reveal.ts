// The reveal orchestration: gate -> editable -> eligibility -> state -> reserve -> ONE call -> settle.
// Every collaborator is an injected port, so this file imports no DB, no client and no env: tests drive it with
// fakes and it can never spend a credit by accident. Nothing is retried, for any error kind: a retry on a paid
// endpoint is a second charge. The HTTP call always happens between reserve() and a settle, outside any transaction.

import { isReachable } from "@/lib/sequences/rosterGuards";
import type { LushaConfigResult } from "./config";
import { LushaError, isPermanent, isRetryableByBd } from "./errors";
import { parseEnrichResponse, parseSearchResponse, pickEmail, pickPhone, type LushaIdentity } from "./parse";
import { expectedCost, type CanRevealEntry } from "./pricing";
import { reasonForKind, type LushaReason } from "./reasons";
import type { LushaResponse, RevealField, SearchInput } from "./client";
import type { RevealSettlement, ReserveResult } from "./revealDb";
import { isOutcomeUnknown, resolveRevealState, type LatestRows } from "./revealState";

export interface Subject {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailStatus: string;
  emailSource: string | null;
  phone: string | null;
  mobilePhone: string | null;
  mergedIntoId: string | null;
  linkedinUrl: string | null;
  companyDomain: string | null;
}

export interface RevealPorts {
  config: LushaConfigResult;
  cap: number;
  /** Throws ContactNotFoundError / ContactMergedError (assertContactEditableById). */
  assertEditable(personId: string): Promise<void>;
  loadSubject(personId: string): Promise<Subject | null>;
  getRevealState(personId: string): Promise<LatestRows>;
  getDailySpend(): Promise<number>;
  reserve(input: { personId: string; field: "search" | RevealField; actorBdId: string; cap: number }): Promise<ReserveResult>;
  settleSearch(input: { reservationId: string; outcome: "matched" | "no_match" | "compliance_restricted"; creditsCharged: number | null; lushaContactId?: string | null; payload: unknown }): Promise<boolean>;
  settleReveal(input: { reservationId: string; actorBdId: string; field: RevealField; emails?: unknown; phones?: unknown; creditsCharged: number | null; compliance?: boolean }): Promise<RevealSettlement | null>;
  /** `payload` is merged into the row: it carries a paid-for raw value when the settle itself failed. */
  failReservation(reservationId: string, errorCode: string, payload?: unknown): Promise<boolean>;
  rejectMatch(personId: string, bdId: string): Promise<boolean>;
  searchContact(input: SearchInput): Promise<LushaResponse>;
  enrichContact(lushaId: string, field: RevealField): Promise<LushaResponse>;
  getAccountUsage(): Promise<{ ok: true; body: unknown } | { ok: false }>;
}

export type RevealFailReason = LushaReason | "merged" | "not_found";
export interface RevealFailure {
  ok: false;
  reason: RevealFailReason;
  /** A BD may deliberately try again (never automatic). */
  retryable: boolean;
  permanent: boolean;
  /** Credits left in today's budget, when the reason is the cap. */
  remaining?: number;
}

export type SearchResult = RevealFailure | { ok: true; outcome: "no_match" | "compliance_restricted" } | { ok: true; outcome: "matched"; identity: LushaIdentity; price: number | null; reused: boolean; /** The ledger row holding the match: a reveal is confirmed against it. */ searchId: string };

export type RevealResult =
  | RevealFailure
  | {
      ok: true;
      /** `already_held`: Lusha returned a phone the Contact already had (5 credits spent, nothing written). */
      outcome: "revealed" | "no_value" | "already_held";
      value: string | null;
      /** The person column written; null when nothing was (both phone columns occupied, unreadable, write failed). */
      written: RevealSettlement["written"];
      duplicate: RevealSettlement["duplicate"];
      /** The credit was spent and the Contact write failed: the paid value sits on the ledger (PR 6, task 6.11 applies it with no Lusha call). */
      writeFailed: boolean;
      /** Lusha returned data we could not read: charged, recorded, nothing written (D17). */
      unreadable: boolean;
      fromLedger: boolean;
    };

const no = (reason: RevealFailReason, extra: Partial<RevealFailure> = {}): RevealFailure => ({ ok: false, reason, retryable: reason === "lusha_busy", permanent: false, ...extra });

function eligible(s: Subject, field: RevealField): boolean {
  if (s.mergedIntoId) return false;
  if (field === "phones") return !(s.phone && s.mobilePhone); // nothing could be placed otherwise (D11); never offered over a held number
  // The same guard the Sequence roster uses: a Contact that can already be sequenced is never offered a purchase (D10).
  return !isReachable({ personId: s.id, email: s.email, emailStatus: s.emailStatus, emailSource: s.emailSource, mergedIntoId: s.mergedIntoId, companyKey: null, clientStatus: null });
}

type Prepared = { subject: Subject; rows: LatestRows; state: ReturnType<typeof resolveRevealState> };

async function prepare(personId: string, field: RevealField, p: RevealPorts): Promise<RevealFailure | Prepared> {
  if (!p.config.ok) return no(p.config.reason === "not_production" ? "lusha_off" : "lusha_unconfigured");
  await p.assertEditable(personId); // a merged or missing Contact is refused here, before anything is read or reserved
  const subject = await p.loadSubject(personId);
  if (!subject || !eligible(subject, field)) return no("lusha_not_eligible");
  const [rows, spentToday] = await Promise.all([p.getRevealState(personId), p.getDailySpend()]);
  return { subject, rows, state: resolveRevealState(field, rows, { spentToday, cap: p.cap }, p.config) };
}

/** One failure path for every LushaError: the reservation is settled or failed exactly once, the call is never repeated. */
async function failFrom(err: unknown, reservationId: string, p: RevealPorts, settleBlocked: () => Promise<unknown>): Promise<RevealFailure> {
  if (!(err instanceof LushaError)) {
    await p.failReservation(reservationId, "unexpected").catch(() => undefined);
    throw err;
  }
  // Compliance is permanent (D6): persist it as an outcome so the control never comes back; every other kind keeps its reservation as `failed`.
  if (isPermanent(err.kind)) {
    try {
      await settleBlocked();
    } catch (e) {
      // A reservation left `reserved` would answer `busy` for this person and field forever: release it, keep the spend counted.
      await p.failReservation(reservationId, err.kind).catch(() => undefined);
      throw e;
    }
  } else await p.failReservation(reservationId, err.kind); // outcome_unknown included: credits_charged stays null, the reserved amount keeps counting
  return no(reasonForKind(err.kind), { retryable: isRetryableByBd(err.kind, err.httpStatus), permanent: isPermanent(err.kind) });
}

const payloadOf = (row: { payload: unknown } | null | undefined): Record<string, unknown> =>
  typeof row?.payload === "object" && row.payload !== null ? (row.payload as Record<string, unknown>) : {};

export async function searchLushaContact(input: { personId: string; field: RevealField; actorBdId: string }, p: RevealPorts): Promise<SearchResult> {
  const prep = await prepare(input.personId, input.field, p);
  if ("ok" in prep) return prep;
  const { subject, rows, state } = prep;
  switch (state.kind) {
    case "blocked":
      return no("lusha_protected", { permanent: true });
    case "capped":
      return no("lusha_cap_reached", { remaining: state.remaining });
    case "revealed":
      return no("lusha_not_eligible");
    case "unavailable":
      // Only a no-match / no-value re-search is ever offered; already_held and not_revealable never reach a paid call.
      if (!state.retry) return no("lusha_not_eligible");
      break;
    case "revealable": {
      // The paid call for this field may already have been billed (outcome_unknown): only a new, paid search reopens it.
      if (isOutcomeUnknown(rows[input.field])) break;
      // A valid stored match: serve it, no network, no charge.
      const stored = payloadOf(rows.search);
      return { ok: true, outcome: "matched", identity: stored.identity as LushaIdentity, price: state.price, reused: true, searchId: rows.search!.id };
    }
  }
  const { firstName, lastName } = subject;
  if (!firstName || !lastName || (!subject.companyDomain && !subject.linkedinUrl)) return no("lusha_insufficient_data");
  const reservation = await p.reserve({ personId: subject.id, field: "search", actorBdId: input.actorBdId, cap: p.cap });
  if (!reservation.ok) return reserveFailure(reservation);
  const id = reservation.reservationId;
  try {
    const response = await p.searchContact({
      personId: subject.id,
      firstName,
      lastName,
      companyDomain: subject.companyDomain ?? undefined,
      linkedinUrl: subject.linkedinUrl ?? undefined,
    });
    const out = parseSearchResponse(response.body, subject.id);
    if (out.outcome === "no_match") {
      await settleOrBusy(p.settleSearch({ reservationId: id, outcome: "no_match", creditsCharged: out.creditsCharged, payload: { lowBalance: out.lowBalance } }), id, p);
      return { ok: true, outcome: "no_match" };
    }
    const payload = { lushaContactId: out.lushaId, identity: out.identity, canReveal: out.canReveal, lowBalance: out.lowBalance };
    await settleOrBusy(p.settleSearch({ reservationId: id, outcome: "matched", creditsCharged: out.creditsCharged, lushaContactId: out.lushaId, payload }), id, p);
    const price = expectedCost(input.field, out.canReveal as CanRevealEntry[]);
    return { ok: true, outcome: "matched", identity: out.identity, price: price.ok ? price.credits : null, reused: false, searchId: id };
  } catch (err) {
    if (err instanceof SettleLostError) return no("lusha_busy", { retryable: true });
    return failFrom(err, id, p, () => p.settleSearch({ reservationId: id, outcome: "compliance_restricted", creditsCharged: null, payload: {} }));
  }
}

class SettleLostError extends Error {}

/** A settle that finds the row no longer in flight lost a race; a settle that throws leaves a reserved row, so fail it (the money stays counted). */
async function settleOrBusy(settle: Promise<boolean>, id: string, p: RevealPorts): Promise<void> {
  let settled: boolean;
  try {
    settled = await settle;
  } catch (e) {
    await p.failReservation(id, "settle_failed").catch(() => undefined);
    throw e;
  }
  if (!settled) throw new SettleLostError();
}

function reserveFailure(r: Extract<ReserveResult, { ok: false }>): RevealFailure {
  switch (r.reason) {
    case "cap_exceeded":
      return no("lusha_cap_reached", { remaining: r.remaining });
    case "busy":
      return no("lusha_busy");
    case "outcome_unknown":
      return no("lusha_outcome_unknown"); // reserve() just reaped this very field: the paid call may already be billed
    case "merged":
    case "not_found":
      return no(r.reason);
    default: // no_search, no_price_list, not_revealable, already_revealed
      return no("lusha_not_eligible");
  }
}

/** `expect` is what the BD confirmed on screen: the search the match belongs to and the price shown. Anything else is refused. */
export async function revealLushaField(input: { personId: string; field: RevealField; actorBdId: string; expect: { searchId: string; price: number } }, p: RevealPorts): Promise<RevealResult> {
  const { personId, field, actorBdId } = input;
  const prep = await prepare(personId, field, p);
  if ("ok" in prep) return prep;
  const { rows, state } = prep;
  switch (state.kind) {
    case "revealed": {
      // Owned already: served from the ledger with no network and no charge. A failed Contact write is visible here (task 6.11).
      const paid = rows[field];
      return { ok: true, outcome: "revealed", value: state.value, written: null, duplicate: null, writeFailed: "writeError" in payloadOf(paid), unreadable: false, fromLedger: true };
    }
    case "blocked":
      return no("lusha_protected", { permanent: true });
    case "capped":
      return no("lusha_cap_reached", { remaining: state.remaining });
    case "revealable":
      // outcome_unknown may already have been billed: only an explicit new search (a conscious spend) reopens the field.
      if (isOutcomeUnknown(rows[field])) return no("lusha_outcome_unknown");
      // A paid value parked by a failed settle is applied for free (task 6.11), never bought again.
      if (rows[field]?.errorCode === "settle_failed") return no("lusha_not_eligible");
      if (rows.search?.id !== input.expect.searchId || state.price !== input.expect.price) return no("lusha_stale");
      break;
    default: // searchable, rejected, unavailable, off, unconfigured: there is no valid stored match to reveal against
      return no("lusha_not_eligible");
  }
  const search = rows.search;
  const lushaId = payloadOf(search).lushaContactId;
  if (!search || typeof lushaId !== "string") return no("lusha_not_eligible");
  const reservation = await p.reserve({ personId, field, actorBdId, cap: p.cap });
  if (!reservation.ok) return reserveFailure(reservation);
  const id = reservation.reservationId;
  // The reservation re-read the search inside its lock: if the match changed meanwhile, never reveal against the old id.
  if (reservation.searchId !== search.id) {
    await p.failReservation(id, "stale_search");
    return no("lusha_busy");
  }
  try {
    const response = await p.enrichContact(lushaId, field);
    const out = parseEnrichResponse(response.body, lushaId);
    const raw = field === "emails" ? out.emails : out.phones;
    const settlement = await p.settleReveal({ reservationId: id, actorBdId, field, emails: out.emails, phones: out.phones, creditsCharged: out.creditsCharged }).catch(async (e) => {
      // The credit is spent: keep the raw paid value on the ledger row so it can be applied later with no second charge.
      await p.failReservation(id, "settle_failed", { emails: out.emails, phones: out.phones, creditsCharged: out.creditsCharged }).catch(() => undefined);
      throw e;
    });
    if (!settlement) return no("lusha_busy", { retryable: true });
    const pick = field === "emails" ? pickEmail(raw) : pickPhone(raw);
    return {
      ok: true,
      outcome: settlement.outcome === "revealed" || settlement.outcome === "already_held" ? settlement.outcome : "no_value",
      value: settlement.value,
      written: settlement.written,
      duplicate: settlement.duplicate,
      writeFailed: settlement.writeFailed,
      unreadable: !pick.ok && pick.reason === "unparsable_value",
      fromLedger: false,
    };
  } catch (err) {
    return failFrom(err, id, p, () => p.settleReveal({ reservationId: id, actorBdId, field, creditsCharged: null, compliance: true }));
  }
}

export async function rejectLushaMatch(input: { personId: string; actorBdId: string }, p: RevealPorts): Promise<{ ok: true } | RevealFailure> {
  await p.assertEditable(input.personId);
  // Only a settled `matched` search can be rejected (the UPDATE says so); it charges nothing (D5).
  return (await p.rejectMatch(input.personId, input.actorBdId)) ? { ok: true } : no("lusha_not_eligible");
}

export interface UsageSnapshot {
  total: number | null;
  used: number | null;
  remaining: number | null;
}

function findNumber(node: unknown, key: string, depth = 0): number | null {
  if (typeof node !== "object" || node === null || depth > 3) return null;
  const rec = node as Record<string, unknown>;
  if (typeof rec[key] === "number" && Number.isFinite(rec[key])) return rec[key] as number;
  for (const v of Object.values(rec)) {
    const hit = findNumber(v, key, depth + 1);
    if (hit !== null) return hit;
  }
  return null;
}

/** Free and display-only (eventually consistent, never enforcement). A failure here never blocks a reveal. */
export async function getLushaUsage(p: RevealPorts): Promise<{ ok: true; usage: UsageSnapshot } | RevealFailure> {
  if (!p.config.ok) return no(p.config.reason === "not_production" ? "lusha_off" : "lusha_unconfigured");
  const res = await p.getAccountUsage();
  if (!res.ok) return no("lusha_unavailable", { retryable: true });
  return { ok: true, usage: { total: findNumber(res.body, "total"), used: findNumber(res.body, "used"), remaining: findNumber(res.body, "remaining") } };
}

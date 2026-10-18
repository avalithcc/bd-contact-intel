// Pure planners for writing a revealed value onto a Contact. They produce the shape
// planPropertyEdit produces ({ personUpdate, historyRows }) plus the activity row, but
// never go through the manual edit path: that path hardcodes emailStatus='none' /
// emailSource='manual', which isReachable rejects. Inputs are never mutated.

import type { NewActivity, NewPerson, NewPersonPropertyHistory, Person } from "@/db/schema";
import { isValidPhoneFormat } from "@/lib/phone";
import { normalizePhoneForWrite } from "@/lib/phoneNormalize";
import { isReachable } from "@/lib/sequences/rosterGuards";
import { isMobileType, type Pick as Picked } from "./parse";

export type RevealPerson = Pick<Person, "id" | "email" | "emailNormalized" | "emailStatus" | "emailSource" | "emailConfidence" | "mergedIntoId" | "phone" | "mobilePhone"> & { sourceKey?: string | null; country?: string | null };

/** The value to store in `column`: E.164 when it can be, else as the provider sent it. */
const storedPhone = (person: RevealPerson, column: "phone" | "mobilePhone", value: string) =>
  normalizePhoneForWrite(value, { column, source: person.sourceKey, country: person.country });

export interface RevealMeta {
  actorBdId: string;
  lushaId: string;
  /** billing.creditsCharged; null when Lusha did not report it. */
  creditsCharged: number | null;
}

type HistoryRow = Omit<NewPersonPropertyHistory, "id" | "at">;
type RevealActivity = Omit<NewActivity, "metadata"> & { metadata: { field: "emails" | "phones"; creditsCharged: number | null; lushaId: string } };

export interface RevealWritePlan {
  personUpdate: Partial<NewPerson> | null;
  historyRows: HistoryRow[];
  /** Null when nothing was revealed. A phone that could not be placed is still an activity. */
  activity: RevealActivity | null;
  /** The revealed phone is a number the Contact already holds: nothing to write, but the credit was spent. */
  alreadyHeld?: true;
}

const NOTHING: RevealWritePlan = { personUpdate: null, historyRows: [], activity: null };

const activityOf = (p: RevealPerson, field: "emails" | "phones", m: RevealMeta): RevealActivity => ({
  type: "lusha_reveal",
  personId: p.id,
  actorBdId: m.actorBdId,
  metadata: { field, creditsCharged: m.creditsCharged, lushaId: m.lushaId },
});

function changes(p: RevealPerson, m: RevealMeta, next: Record<string, string | number | null>): HistoryRow[] {
  const current = p as unknown as Record<string, string | number | null>;
  return Object.entries(next)
    .filter(([k, v]) => k !== "emailConfidence" && (current[k] ?? null) !== v)
    .map(([k, v]) => ({
      personId: p.id,
      property: k,
      oldValue: current[k] == null ? null : String(current[k]),
      newValue: v == null ? null : String(v),
      changedByBdId: m.actorBdId,
      source: "lusha_reveal",
    }));
}

/** Eligible only when the Sequence roster guard would refuse the current email (D10). */
export function planRevealedEmailWrite(person: RevealPerson, pick: Picked, meta: RevealMeta): RevealWritePlan {
  const reachable = isReachable({ personId: person.id, email: person.email, emailStatus: person.emailStatus, emailSource: person.emailSource, mergedIntoId: person.mergedIntoId, companyKey: null, clientStatus: null });
  if (!pick.ok || person.mergedIntoId || reachable) return NOTHING;
  // The address that bounced is not a "new" email, however a vendor grades it.
  if (person.emailStatus === "bounced" && pick.value.trim().toLowerCase() === person.emailNormalized) return NOTHING;
  const next = { email: pick.value, emailNormalized: pick.value.trim().toLowerCase(), emailStatus: "probable", emailSource: "lusha", emailConfidence: pick.confidence };
  return {
    personUpdate: { ...next, updatedAt: new Date(), updatedByBdId: meta.actorBdId },
    historyRows: changes(person, meta, next),
    activity: activityOf(person, "emails", meta),
  };
}

/** D11: mobile -> mobilePhone, else phone; the occupied target falls back to the other column; both occupied writes nothing. */
export function planRevealedPhoneWrite(person: RevealPerson, pick: Picked, meta: RevealMeta): RevealWritePlan {
  if (!pick.ok || person.mergedIntoId || !isValidPhoneFormat(pick.value)) return NOTHING;
  // Digits only, so formatting differences do not hide a number we already hold.
  const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");
  if ([person.phone, person.mobilePhone].some((held) => digits(held) !== "" && digits(held) === digits(pick.value))) return { ...NOTHING, alreadyHeld: true };
  const [first, other] = isMobileType(pick.type) ? (["mobilePhone", "phone"] as const) : (["phone", "mobilePhone"] as const);
  const column = !person[first] ? first : !person[other] ? other : null;
  const activity = activityOf(person, "phones", meta);
  if (!column) return { personUpdate: null, historyRows: [], activity };
  const value = storedPhone(person, column, pick.value);
  return {
    personUpdate: { [column]: value, updatedAt: new Date(), updatedByBdId: meta.actorBdId },
    historyRows: changes(person, meta, { [column]: value }),
    activity,
  };
}

/**
 * One reveal, up to two numbers: mobile -> mobilePhone, anything else -> phone, each only into an EMPTY column and only
 * when its digits are not already held (nor placed twice). With a single number left to place the D11 fallback applies;
 * with two there is no fallback, so a full column simply skips its number. Never overwrites a value from another source.
 */
export function planRevealedPhonesWrite(person: RevealPerson, picks: readonly Picked[], meta: RevealMeta): RevealWritePlan {
  const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");
  const seen = new Set([person.phone, person.mobilePhone].map(digits).filter(Boolean));
  const ok = picks.filter((p): p is Extract<Picked, { ok: true }> => p.ok && isValidPhoneFormat(p.value));
  if (person.mergedIntoId || ok.length === 0) return NOTHING;
  const fresh = ok.filter((p) => !seen.has(digits(p.value)) && seen.add(digits(p.value)));
  if (fresh.length === 0) return { ...NOTHING, alreadyHeld: true };
  if (fresh.length === 1) return planRevealedPhoneWrite(person, fresh[0], meta);
  const next: Record<string, string> = {};
  for (const p of fresh) {
    const column = isMobileType(p.type) ? "mobilePhone" : "phone";
    if (!person[column] && !(column in next)) next[column] = storedPhone(person, column, p.value);
  }
  const activity = activityOf(person, "phones", meta);
  if (Object.keys(next).length === 0) return { personUpdate: null, historyRows: [], activity };
  return { personUpdate: { ...next, updatedAt: new Date(), updatedByBdId: meta.actorBdId }, historyRows: changes(person, meta, next), activity };
}

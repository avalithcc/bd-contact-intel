/**
 * Pure planner for scripts/extract-signature-phones.ts: turns per-message
 * extractions into per-person fills. No I/O; never mutates its inputs.
 *
 * Rules, per person, over the DISTINCT numbers their messages carried (the
 * kind of a number comes from its label only, see extract.ts):
 *  - one number: filled into `mobile_phone` if every label said mobile, else
 *    `phone`; skipped when the person already has any number (fill empty only).
 *  - several numbers and any of them has an unstated kind: ambiguous, no write.
 *  - several numbers, all kinds stated: a labelled landline and a labelled
 *    mobile are two facts and fill `phone` / `mobile_phone` independently,
 *    each only if empty and not already stored in the other column. Two
 *    different numbers of the SAME kind are a real conflict: no write for that
 *    column, left for a human (no "most frequent").
 * `supportingMessages` records how many distinct messages carried the written
 * number. Numbers are compared with `phoneKey`, the same key builder the
 * extractor dedupes with.
 */
import { phoneKey, type PhoneCandidate, type PhoneKind } from "./extract";

export interface ExtractedMessage {
  messageId: string;
  personId: string;
  phones: readonly PhoneCandidate[];
}
export interface PersonPhoneState {
  phone: string | null;
  mobilePhone: string | null;
}
export interface SignaturePhoneFill {
  personId: string;
  column: "phone" | "mobilePhone";
  value: string;
  supportingMessages: number;
}
export interface SignaturePhonePlan {
  fills: SignaturePhoneFill[];
  skippedHasNumber: number;
  /** Persons with two different numbers of the same stated kind. */
  skippedConflict: number;
  /** Persons with several numbers where at least one label did not state the kind. */
  skippedConflictKindUnstated: number;
  /** Persons that got both `phone` and `mobile_phone` written. */
  bothWritten: number;
  /** Known persons with at least one extracted number, before any skip. */
  personsWithNumbers: number;
}

const blank = (v: string | null) => (v ?? "").trim() === "";
type Found = { value: string; kinds: Set<PhoneKind>; messageIds: Set<string> };
const kindOf = (n: Found): PhoneKind => (n.kinds.size === 1 ? [...n.kinds][0]! : "generic");
const fillOf = (personId: string, column: SignaturePhoneFill["column"], n: Found): SignaturePhoneFill => ({ personId, column, value: n.value, supportingMessages: n.messageIds.size });

export function planSignaturePhones(messages: readonly ExtractedMessage[], persons: ReadonlyMap<string, PersonPhoneState>): SignaturePhonePlan {
  const byPerson = new Map<string, Map<string, Found>>();
  for (const message of messages) {
    if (!persons.has(message.personId)) continue;
    for (const phone of message.phones) {
      const numbers = byPerson.get(message.personId) ?? new Map<string, Found>();
      byPerson.set(message.personId, numbers);
      const key = phoneKey(phone.value);
      const entry = numbers.get(key) ?? { value: phone.value, kinds: new Set<PhoneKind>(), messageIds: new Set<string>() };
      numbers.set(key, entry);
      entry.kinds.add(phone.kind);
      entry.messageIds.add(message.messageId);
    }
  }

  const plan: SignaturePhonePlan = { fills: [], skippedHasNumber: 0, skippedConflict: 0, skippedConflictKindUnstated: 0, bothWritten: 0, personsWithNumbers: byPerson.size };
  for (const [personId, numbers] of byPerson) {
    const state = persons.get(personId)!;
    const found = [...numbers.values()];
    const hasAny = !blank(state.phone) || !blank(state.mobilePhone);
    if (found.length === 1 || found.some((n) => kindOf(n) === "generic")) {
      if (hasAny) plan.skippedHasNumber++;
      else if (found.length > 1) plan.skippedConflictKindUnstated++;
      else plan.fills.push(fillOf(personId, kindOf(found[0]!) === "mobile" ? "mobilePhone" : "phone", found[0]!));
      continue;
    }
    const mobiles = found.filter((n) => kindOf(n) === "mobile");
    const landlines = found.filter((n) => kindOf(n) === "landline");
    const conflict = mobiles.length > 1 || landlines.length > 1;
    const wanted: [SignaturePhoneFill["column"], Found][] = [];
    if (landlines.length === 1 && blank(state.phone)) wanted.push(["phone", landlines[0]!]);
    if (mobiles.length === 1 && blank(state.mobilePhone)) wanted.push(["mobilePhone", mobiles[0]!]);
    // Never store a number the other column already holds.
    const written = wanted.filter(([column, n]) => phoneKey(n.value) !== phoneKey((column === "phone" ? state.mobilePhone : state.phone) ?? ""));
    plan.fills.push(...written.map(([column, n]) => fillOf(personId, column, n)));
    if (written.length === 2) plan.bothWritten++;
    if (conflict) plan.skippedConflict++;
    else if (!written.length) plan.skippedHasNumber++;
  }
  return plan;
}

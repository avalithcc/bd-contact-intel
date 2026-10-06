/**
 * Pure planner for scripts/extract-signature-phones.ts: turns per-message
 * extractions into per-person fills. No I/O; never mutates its inputs.
 *
 * Rules: a person who already has `phone` or `mobile_phone` is skipped (fill
 * empty only); a person whose messages yield two or more DIFFERENT numbers is
 * skipped as a conflict (no guessing, no "most frequent"); otherwise the one
 * number is filled and `supportingMessages` records how many distinct messages
 * carried it. Numbers are compared with `phoneKey`, the same key builder the
 * extractor dedupes with.
 */
import { phoneKey, type PhoneCandidate } from "./extract";

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
  skippedConflict: number;
  /** Known persons with at least one extracted number, before any skip. */
  personsWithNumbers: number;
}

const blank = (v: string | null) => (v ?? "").trim() === "";

export function planSignaturePhones(messages: readonly ExtractedMessage[], persons: ReadonlyMap<string, PersonPhoneState>): SignaturePhonePlan {
  // personId -> phoneKey -> { first-seen value, kinds, distinct message ids }
  const byPerson = new Map<string, Map<string, { value: string; kinds: Set<string>; messageIds: Set<string> }>>();
  for (const message of messages) {
    if (!persons.has(message.personId)) continue;
    for (const phone of message.phones) {
      const numbers = byPerson.get(message.personId) ?? new Map();
      byPerson.set(message.personId, numbers);
      const key = phoneKey(phone.value);
      const entry = numbers.get(key) ?? { value: phone.value, kinds: new Set<string>(), messageIds: new Set<string>() };
      numbers.set(key, entry);
      entry.kinds.add(phone.kind);
      entry.messageIds.add(message.messageId);
    }
  }

  const plan: SignaturePhonePlan = { fills: [], skippedHasNumber: 0, skippedConflict: 0, personsWithNumbers: byPerson.size };
  for (const [personId, numbers] of byPerson) {
    const state = persons.get(personId)!;
    if (!blank(state.phone) || !blank(state.mobilePhone)) plan.skippedHasNumber++;
    else if (numbers.size > 1) plan.skippedConflict++;
    else {
      const [only] = [...numbers.values()];
      plan.fills.push({ personId, column: only!.kinds.size === 1 && only!.kinds.has("mobile") ? "mobilePhone" : "phone", value: only!.value, supportingMessages: only!.messageIds.size });
    }
  }
  return plan;
}

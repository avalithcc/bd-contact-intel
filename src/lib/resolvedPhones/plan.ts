/**
 * Pure planner behind scripts/apply-resolved-phones.ts.
 *
 * scripts/extract-signature-phones.ts deliberately writes nothing when one
 * person's signatures yield two or more different numbers: contradictory
 * evidence is not a number to guess at. It reports those people and leaves
 * them for a human. This applies the human's answer.
 *
 * KIND decides the column, exactly as the extractor does: `mobile` ->
 * mobile_phone, `landline` and `generic` -> phone. `generic` means the
 * signature's label did not say which it was (a bare "Tel:", or an unlabelled
 * "+" number); it is NEVER inferred from the digits, because AR mobile
 * detection by prefix is wrong often enough to poison the column.
 *
 * FILL-EMPTY ONLY. A person who already has a number in the target column is a
 * refusal, not a skip: the input is a human's explicit decision, so a collision
 * means the input and the database disagree and somebody must look.
 */
export const PHONE_KINDS = ["mobile", "landline", "generic"] as const;
export type PhoneKind = (typeof PHONE_KINDS)[number];

export type PhoneColumn = "phone" | "mobilePhone";

export interface ResolvedPhoneInput {
  personId: string;
  number: string;
  kind: PhoneKind;
}

/** The person as the database holds them right now. */
export interface ResolvedPhonePerson {
  id: string;
  phone: string | null;
  mobilePhone: string | null;
}

export interface ResolvedPhoneWrite {
  personId: string;
  column: PhoneColumn;
  value: string;
}

export class ResolvedPhoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolvedPhoneError";
  }
}

export function isPhoneKind(value: unknown): value is PhoneKind {
  return typeof value === "string" && (PHONE_KINDS as readonly string[]).includes(value);
}

/** mobile -> mobile_phone; landline and generic -> phone (the extractor's own rule). */
export function columnFor(kind: PhoneKind): PhoneColumn {
  return kind === "mobile" ? "mobilePhone" : "phone";
}

const isEmpty = (v: string | null) => !(v ?? "").trim();

/**
 * Throws on any disagreement rather than returning a partial plan: a typo in a
 * person id, a number the validator rejects, or a column that is already taken
 * each stop the whole run. Nothing here is best-effort.
 */
export function planResolvedPhones(
  inputs: readonly ResolvedPhoneInput[],
  persons: readonly ResolvedPhonePerson[],
  isValidNumber: (value: string) => boolean,
): ResolvedPhoneWrite[] {
  if (!inputs.length) throw new ResolvedPhoneError("No entries: nothing to apply.");

  const seen = new Set<string>();
  for (const input of inputs) {
    const key = `${input.personId}:${columnFor(input.kind)}`;
    if (seen.has(key)) throw new ResolvedPhoneError(`Two entries target the same column of person ${input.personId}.`);
    seen.add(key);
  }

  const byId = new Map(persons.map((p) => [p.id, p]));
  return inputs.map((input) => {
    const value = input.number.trim();
    if (!value) throw new ResolvedPhoneError(`Entry for person ${input.personId} has an empty number.`);
    if (!isValidNumber(value)) throw new ResolvedPhoneError(`Not a valid phone number for person ${input.personId}: refusing the whole run.`);

    const person = byId.get(input.personId);
    if (!person) throw new ResolvedPhoneError(`No live person ${input.personId}: refusing the whole run rather than skipping an entry.`);

    const column = columnFor(input.kind);
    const current = column === "phone" ? person.phone : person.mobilePhone;
    if (!isEmpty(current)) {
      throw new ResolvedPhoneError(
        `Person ${input.personId} already has a ${column === "phone" ? "phone" : "mobile"} number. ` +
          "This input is a human decision, so a collision means it disagrees with the database: refusing rather than overwriting.",
      );
    }
    return { personId: input.personId, column, value };
  });
}

/** Parses the --json file. Shape errors name the entry index, since JSON has no lines. */
export function parseResolvedPhonesJson(text: string): ResolvedPhoneInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ResolvedPhoneError(`--json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed)) throw new ResolvedPhoneError('--json must be an array of {"personId","number","kind"}.');

  return parsed.map((raw, i) => {
    const entry = raw as Record<string, unknown>;
    const personId = typeof entry?.personId === "string" ? entry.personId.trim() : "";
    const number = typeof entry?.number === "string" ? entry.number.trim() : "";
    const kind = entry?.kind;
    if (!personId) throw new ResolvedPhoneError(`--json entry ${i + 1}: missing "personId".`);
    if (!number) throw new ResolvedPhoneError(`--json entry ${i + 1}: missing "number".`);
    if (!isPhoneKind(kind)) throw new ResolvedPhoneError(`--json entry ${i + 1}: "kind" must be one of ${PHONE_KINDS.join(", ")}.`);
    return { personId, number, kind };
  });
}

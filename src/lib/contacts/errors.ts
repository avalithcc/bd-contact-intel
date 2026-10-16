/**
 * Small shared error types for the Contact record write paths (fresh-review
 * WARNING fixes) — kept separate from mergeGuard.ts/propertyEdit.ts so both
 * can import this without a circular dependency.
 */
export class ContactNotFoundError extends Error {
  constructor(personId: string) {
    super(`Contact not found: ${personId}`);
    this.name = "ContactNotFoundError";
  }
}

/** The contact that already holds a LinkedIn profile key. */
export interface ProfileKeyOwner {
  id: string;
  name: string;
  /**
   * Set when the holder was already merged into another contact (the unique
   * constraint still counts its key). The UI links to this survivor instead
   * and does not suggest merging: no merge can free that key.
   */
  mergedInto?: { id: string; name: string };
}

/**
 * Thrown when a `profile_key` edit collides with `person_profile_key_unique`.
 * Carries the OTHER contact so the UI can name it and link to it: nothing is
 * merged automatically (a merge is irreversible; that call belongs to the
 * Duplicados screen).
 */
export class ProfileKeyTakenError extends Error {
  constructor(public readonly owner: ProfileKeyOwner) {
    super(`LinkedIn profile already belongs to contact ${owner.id}`);
    this.name = "ProfileKeyTakenError";
  }
}

/**
 * True for a postgres unique violation (23505) on `person_profile_key_unique`.
 * Drizzle may wrap the driver error, so the `cause` chain is walked.
 */
export function isProfileKeyUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let hop = 0; e && typeof e === "object" && hop < 5; hop++) {
    const { code, constraint_name: constraint, cause } = e as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (code === "23505" && constraint === "person_profile_key_unique") return true;
    e = cause;
  }
  return false;
}

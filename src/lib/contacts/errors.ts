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

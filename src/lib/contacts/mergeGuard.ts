/**
 * Write guard for a merged-away Contact (fresh-review WARNING): the
 * property-edit and quick-action server actions had no check against
 * `person.mergedIntoId`, so a stale tab open on a Contact that has since
 * lost a merge could still write to the losing row. Reads already redirect
 * to the survivor (src/lib/contacts/queries.ts#getContactRecord); this
 * covers the write path the same way.
 */
export class ContactMergedError extends Error {
  constructor() {
    super("Contact has been merged into another one");
    this.name = "ContactMergedError";
  }
}

export function assertContactEditable(person: { mergedIntoId: string | null }): void {
  if (person.mergedIntoId) throw new ContactMergedError();
}

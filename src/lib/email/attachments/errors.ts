/**
 * Thrown when the files a scheduled email was meant to hold could not all be linked to it (a path that is gone, removed, or
 * already held by another email). The surrounding transaction rolls back, so an email is never scheduled with fewer files than
 * the BD attached. Own pure module so `actionErrors.ts` can map it without importing the database layer.
 */
export class AttachmentLinkError extends Error {
  constructor(public readonly expected: number, public readonly linked: number) {
    super(`Expected ${expected} attachments to be linked, ${linked} were`);
    this.name = "AttachmentLinkError";
  }
}

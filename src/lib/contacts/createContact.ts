/**
 * "Nuevo contacto" dialog (mockups/contacts.html `#new-contact`). Pure
 * field-building and identity-match classification only — no DB. Reuses
 * the SAME matcher every ingestion path uses (@/lib/identity/matcher
 * matchIdentity) instead of a bespoke duplicate check, per owner decision:
 * "build it as the mockup shows, going through the identity resolver."
 *
 * This does NOT reuse the bulk ingest planner in @/lib/identity/resolve.ts
 * (planIdentityWrites/buildIdentityWriteRows) — that machinery is shaped
 * around a chunk of rows migrating from a real legacy `contact`/`lead` row
 * (`legacyTable`/`legacyId`), which a manually-typed new contact has none
 * of. Reusing `matchIdentity` directly (the actual matching algorithm/
 * precedence) is the smallest faithful way to honor "go through the
 * identity resolver" without inventing a fake legacy row just to satisfy
 * that pipeline's shape — see createContactActions.ts's doc comment for
 * the DB-side rest of this decision.
 */
import { normalizeProfileKey } from "@/lib/csv";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import type { EmailStatus, MatchableRow, MatchResult, ReviewReason } from "@/lib/identity/matcher";

export interface NewContactFormInput {
  firstName: string;
  lastName: string;
  linkedinUrl: string;
  email: string;
  company: string;
}

export interface NewContactFields {
  firstName: string | null;
  lastName: string | null;
  profileKey: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  company: string | null;
  companyKey: string | null;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * A manually typed email is NEVER "verified" — this quick-add path does no
 * Hunter lookup (that only runs on the async enrichment paths), so a typed
 * address is "probable" until something else verifies it, same convention
 * CSV-imported rows with no verification source already use.
 */
export function buildNewContactFields(input: NewContactFormInput): NewContactFields {
  const email = blankToNull(input.email);
  const company = blankToNull(input.company);
  return {
    firstName: blankToNull(input.firstName),
    lastName: blankToNull(input.lastName),
    profileKey: normalizeProfileKey(input.linkedinUrl),
    email,
    emailStatus: email ? "probable" : "none",
    company,
    companyKey: company ? normalizeCompanyKey(company) : null,
  };
}

export function matchableRowFromFields(fields: NewContactFields): MatchableRow {
  return {
    profileKey: fields.profileKey,
    email: fields.email,
    emailStatus: fields.emailStatus,
    firstName: fields.firstName,
    lastName: fields.lastName,
    company: fields.company,
  };
}

export type CreateContactDecision =
  // profile_key/verified_email says this IS the same person — mockup's
  // "Abrir el existente" with no "crear de todas formas" (there is
  // nothing weak about this match to override).
  | { action: "existing_match"; existingPersonId: string }
  // name+company (or conflicting strong keys) — mockup's exact banner:
  // "Nunca se fusionan automáticamente... Abrir el existente o crear de
  // todas formas; un administrador lo revisará."
  | { action: "needs_confirmation"; existingPersonId: string; reason: ReviewReason }
  | { action: "blocked_own_company" }
  | { action: "create" };

/** Maps the matcher's generic MatchResult to what the create-contact
 * dialog should show/do — the ingest planner's outcome vocabulary (auto/
 * review/new/skip) doesn't map 1:1 onto "should I create a row right now",
 * so this is its own small decision table rather than reusing
 * IdentityRowMethod. */
export function classifyMatchResultForCreate(result: MatchResult): CreateContactDecision {
  switch (result.kind) {
    case "auto":
      return { action: "existing_match", existingPersonId: result.personId };
    case "review":
      return { action: "needs_confirmation", existingPersonId: result.personIds[0], reason: result.reason };
    case "skip_own_company":
      return { action: "blocked_own_company" };
    case "new":
      return { action: "create" };
  }
}

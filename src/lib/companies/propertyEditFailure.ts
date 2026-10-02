/**
 * The typed, user-correctable ways a single-property company edit can fail,
 * as plain data. `updateCompanyPropertyAction` returns one of these instead of
 * throwing: Next.js replaces a thrown server-action message with a generic
 * one in production, so a thrown validation error never reaches the BD.
 * Anything not recognised here is NOT a failure of this kind and must be
 * rethrown by the caller so a real bug still fails loudly.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { CompanyNotFoundError } from "@/lib/companies/errors";
import { InvalidCompanyLinkedinUrlError, linkedinUrlErrorMessage, type LinkedinUrlRejection } from "@/lib/companies/linkedinUrl";
import { InvalidClientStatusError, InvalidOwnerError } from "@/lib/companies/propertyEdit";

export type PropertyEditFailure =
  | { kind: "linkedin"; reason: LinkedinUrlRejection }
  | { kind: "client_status" }
  | { kind: "owner" }
  | { kind: "not_found" };

/** Maps a thrown error to a failure, or null when it is unexpected. */
export function propertyEditFailureOf(err: unknown): PropertyEditFailure | null {
  if (err instanceof InvalidCompanyLinkedinUrlError) return { kind: "linkedin", reason: err.reason };
  if (err instanceof InvalidClientStatusError) return { kind: "client_status" };
  if (err instanceof InvalidOwnerError) return { kind: "owner" };
  if (err instanceof CompanyNotFoundError) return { kind: "not_found" };
  return null;
}

export type PropertyEditFailureLabels = Pick<
  Dictionary["companyRecord"],
  "editErrorClientStatus" | "editErrorOwner" | "editErrorCompanyNotFound"
> &
  Parameters<typeof linkedinUrlErrorMessage>[1];

/** The message is chosen by failure kind, never by assumption. */
export function propertyEditFailureMessage(failure: PropertyEditFailure, l: PropertyEditFailureLabels): string {
  switch (failure.kind) {
    case "linkedin":
      return linkedinUrlErrorMessage(failure.reason, l);
    case "client_status":
      return l.editErrorClientStatus;
    case "owner":
      return l.editErrorOwner;
    case "not_found":
      return l.editErrorCompanyNotFound;
  }
}

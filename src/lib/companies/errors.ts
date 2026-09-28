/**
 * Small shared error type for the Company record write path, mirroring
 * src/lib/contacts/errors.ts.
 */
export class CompanyNotFoundError extends Error {
  constructor(companyKey: string) {
    super(`Company not found: ${companyKey}`);
    this.name = "CompanyNotFoundError";
  }
}

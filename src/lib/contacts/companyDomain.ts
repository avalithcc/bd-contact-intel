/**
 * Right panel "Empresa" card domain (contact-record.html:160-163;
 * mockup-port r20 follow-up). `company.domain` (hubspot-import migration,
 * drizzle/0015_company_domain.sql) is now the real, owner-maintained field
 * for a company's domain — prefer it. Fall back to deriving one from this
 * Contact's own verified email domain only when the company has none on
 * file (e.g. a company created before the hubspot import, or one hubspot
 * never resolved a domain for). Pure — no DB.
 */
import { splitEmail } from "@/lib/emailPatterns";

export function resolveCompanyDomain(
  companyDomain: string | null | undefined,
  email: string | null | undefined,
): string | null {
  if (companyDomain) return companyDomain;
  if (!email) return null;
  return splitEmail(email)?.domain ?? null;
}

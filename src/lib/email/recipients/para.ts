import { checkRecipientShape, MAX_REPLY_RECIPIENTS } from "@/lib/gmail/recipient";

/**
 * "Para" of a composed email, decided on the server. Owner decision: the record's contact plus other contacts of the
 * SAME company; the client sends person ids, never free addresses. The reader (queries.ts) supplies live survivors with
 * their company key already canonicalised through company_alias; this module only applies the rules. Pure.
 *
 * - every recipient must exist as a live contact and have a usable email;
 * - all canonical company keys equal the record's; a record without company can only send to itself;
 * - duplicates (same person, or same normalised email) collapse, keeping the first;
 * - at most MAX_PARA after dedupe.
 */
export const MAX_PARA = MAX_REPLY_RECIPIENTS;

export interface ParaPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailNormalized: string | null;
  /** Canonical company key (aliases resolved), null when the contact has no company. */
  canonicalCompanyKey: string | null;
}

export interface ParaRecipient {
  personId: string;
  email: string;
  name: string;
}

export type ParaRefusal = "recipient_unavailable" | "recipient_no_email" | "recipient_other_company" | "too_many_recipients" | "invalid_email";

export type ParaResult = { ok: true; recipients: ParaRecipient[]; to: string } | { ok: false; reason: ParaRefusal };

const displayName = (p: ParaPerson) => [p.firstName, p.lastName].filter(Boolean).join(" ");

/** `others` keeps the order the BD picked them in; `undefined` stands for an id that did not resolve to a live contact. */
export function evaluatePara(primary: ParaPerson | undefined, others: readonly (ParaPerson | undefined)[]): ParaResult {
  if (!primary) return { ok: false, reason: "recipient_unavailable" };
  // An empty or blank key is "no company" (imports have left '' behind), never a company shared by everyone who has one.
  const companyOf = (p: ParaPerson) => p.canonicalCompanyKey?.trim() || null;
  const primaryCompany = companyOf(primary);
  const recipients: ParaRecipient[] = [];
  const seenPeople = new Set<string>();
  const seenEmails = new Set<string>();
  for (const person of [primary, ...others]) {
    if (!person) return { ok: false, reason: "recipient_unavailable" };
    if (person !== primary && (primaryCompany === null || companyOf(person) !== primaryCompany)) {
      return { ok: false, reason: "recipient_other_company" };
    }
    const email = person.email?.trim() ?? "";
    if (!email) return { ok: false, reason: "recipient_no_email" };
    if (!checkRecipientShape(email).ok) return { ok: false, reason: "invalid_email" };
    const normalized = (person.emailNormalized?.trim() || email).toLowerCase();
    if (seenPeople.has(person.id) || seenEmails.has(normalized)) continue;
    seenPeople.add(person.id);
    seenEmails.add(normalized);
    recipients.push({ personId: person.id, email, name: displayName(person) });
  }
  if (recipients.length > MAX_PARA) return { ok: false, reason: "too_many_recipients" };
  return { ok: true, recipients, to: recipients.map((r) => r.email).join(", ") };
}

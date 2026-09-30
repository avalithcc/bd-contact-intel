/**
 * Pure classifier for one already-parsed Gmail message (email-sync brief,
 * slice 2). Decides direction, extracts participant addresses, applies the
 * per-BD never-log list, and picks the CRM person(s) it matches. Touches no
 * I/O — the caller (`/api/gmail/sync`, slice 3) resolves `knownPersons` and
 * `neverLogRules` from the DB for the syncing BD only, and passes them in.
 *
 * Multi-match decision: `email_message` has `unique(bd_id, gmail_message_id)`
 * — exactly one row per Gmail message — so a message matching several CRM
 * persons cannot be one row per person. This classifier instead returns
 * every match in `matches[]`; the write path (slice 3) inserts one
 * `email_message_person` join row per match (see src/db/schema.ts), and the
 * first entry in `matches` becomes `email_message.person_id` as a
 * convenience column for the common single-match case. This keeps the
 * message-level uniqueness intact while still writing one activity
 * (`reply_received`/`email_sent`) and one status recompute for EVERY
 * matched person, not just the first — see
 * src/lib/gmail/buildSyncedActivities.ts.
 */
import type { ParsedGmailMessage } from "./parseMessage";

export type MatchConfidence = "exact" | "inferred";

/** One CRM person's known address, pre-fetched by the caller for exactly the syncing BD's owned persons. */
export interface KnownPersonEmail {
  personId: string;
  emailNormalized: string;
  // 'inferred' when the person's `email_source` is 'pattern_inferred'
  // (owner decision, 2026-09-30 brief) — 'exact' otherwise.
  confidence: MatchConfidence;
}

/** One row of the per-BD `email_never_log` table (src/db/schema.ts), already normalized lowercase. */
export interface NeverLogRule {
  kind: "address" | "domain";
  value: string;
}

export interface ClassifiedMatch {
  personId: string;
  matchedEmail: string;
  matchConfidence: MatchConfidence;
}

export interface ClassifiedMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  direction: "inbound" | "outbound";
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  // Never HTML — see src/lib/gmail/htmlToText.ts's doc comment.
  bodyText: string | null;
  bodyTruncated: boolean;
  sentAt: Date;
  /** Every CRM person this message matches, never-log already applied. Empty means "do not store". */
  matches: ClassifiedMatch[];
  /** True when this gmailMessageId already has an `email_sent` activity from src/lib/gmail/send.ts. */
  isPlatformSent: boolean;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Extracts every email address out of a raw header value, regardless of
 * display-name format ("Name <email>"), quoting ("Doe, John" <email>, which
 * would otherwise split on the comma inside the quotes), or a plain
 * comma-separated list of bare addresses. Matching email-shaped tokens
 * directly sidesteps writing a full RFC 5322 address-list parser for a
 * classifier that only needs the addresses, never the display names.
 */
export function extractEmailAddresses(headerValue: string | null | undefined): string[] {
  if (!headerValue) return [];
  const matches = headerValue.match(EMAIL_REGEX) ?? [];
  return matches.map(normalizeEmailAddress);
}

function extractFirstEmailAddress(headerValue: string | null | undefined): string {
  return extractEmailAddresses(headerValue)[0] ?? "";
}

function isNeverLogged(address: string, rules: readonly NeverLogRule[]): boolean {
  const domain = address.split("@")[1];
  return rules.some(
    (rule) =>
      (rule.kind === "address" && rule.value === address) ||
      (rule.kind === "domain" && domain !== undefined && rule.value === domain),
  );
}

export interface ClassifyGmailMessageInput {
  message: ParsedGmailMessage;
  bdEmail: string;
  knownPersons: readonly KnownPersonEmail[];
  neverLogRules: readonly NeverLogRule[];
  platformSentGmailMessageIds?: ReadonlySet<string>;
}

export function classifyGmailMessage(input: ClassifyGmailMessageInput): ClassifiedMessage {
  const { message, knownPersons, neverLogRules } = input;
  const bdEmail = normalizeEmailAddress(input.bdEmail);

  const fromAddress = extractFirstEmailAddress(message.from);
  const toAddresses = extractEmailAddresses(message.to);
  const ccAddresses = extractEmailAddresses(message.cc);

  const direction: "inbound" | "outbound" = fromAddress === bdEmail ? "outbound" : "inbound";

  const personByEmail = new Map(knownPersons.map((p) => [p.emailNormalized, p] as const));

  // Every header address is a match candidate for either direction — a CRM
  // contact can be CC'd without ever appearing in From/To (CC-only match).
  // The BD's own address is excluded so a self-sent message never matches
  // itself as a "contact" even if it happens to share a person row's email.
  const candidateAddresses = [...new Set([fromAddress, ...toAddresses, ...ccAddresses])].filter(
    (address) => address !== "" && address !== bdEmail,
  );

  const matches: ClassifiedMatch[] = [];
  const seenPersonIds = new Set<string>();
  for (const address of candidateAddresses) {
    if (isNeverLogged(address, neverLogRules)) continue;
    const person = personByEmail.get(address);
    if (!person || seenPersonIds.has(person.personId)) continue;
    seenPersonIds.add(person.personId);
    matches.push({ personId: person.personId, matchedEmail: address, matchConfidence: person.confidence });
  }

  return {
    gmailMessageId: message.gmailMessageId,
    gmailThreadId: message.gmailThreadId,
    direction,
    fromAddress,
    toAddresses,
    ccAddresses,
    subject: message.subject,
    bodyText: message.bodyText,
    bodyTruncated: message.bodyTruncated,
    sentAt: message.sentAt,
    matches,
    isPlatformSent: input.platformSentGmailMessageIds?.has(message.gmailMessageId) ?? false,
  };
}

/** Only threads with at least one surviving CRM match are stored (owner decision, 2026-09-30 brief). */
export function shouldStoreClassifiedMessage(classified: ClassifiedMessage): boolean {
  return classified.matches.length > 0;
}

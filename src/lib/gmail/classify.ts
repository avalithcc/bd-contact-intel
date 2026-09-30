/**
 * Pure classifier for one already-parsed Gmail message (email-sync brief,
 * slice 2). Decides direction, extracts participant addresses, applies the
 * per-BD never-log list, and picks the CRM person(s) it matches. Touches no
 * I/O — the caller (`/api/gmail/sync`, slice 3) resolves `knownPersons` and
 * `neverLogRules` from the DB for the syncing BD only, and passes them in.
 *
 * Never-log applies to the WHOLE MESSAGE, not per address (owner decision,
 * 2026-09-30, see openspec/decisions/2026-09-30-email-sync-brief.md). If ANY
 * participant address in From/To/Cc matches a never-log rule (exact address
 * or exact domain, case-insensitive), the entire message is excluded — no
 * `matches` for any CRM person, even ones that would otherwise match cleanly
 * on a different address. A message CC'ing both a never-logged address and a
 * known CRM contact is not stored or logged at all.
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
 *
 * Direction-scoped matching (HubSpot-like, owner decision 2026-09-30, fixing
 * a bug where a CRM person only in To/Cc of an automated inbound email — an
 * accounting system CC'ing them on a transfer receipt — was recorded as
 * having replied): for an INBOUND message only the sender (From) can match,
 * so `matches` has at most one entry and a `reply_received` activity is only
 * ever written for the person who actually sent the message. The multi-match
 * scenario above (several `matches[]` entries, several join rows) only
 * happens for OUTBOUND messages, where every To/Cc recipient is still a
 * candidate.
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

/**
 * Whole-message never-log check (owner decision, 2026-09-30): true when ANY
 * From/To/Cc participant — including the BD's own address, in the unlikely
 * case a rule targets it — matches a never-log rule. Callers must treat a
 * `true` result as "suppress the entire message for every person", not just
 * the matching address.
 */
function isMessageNeverLogged(addresses: readonly string[], rules: readonly NeverLogRule[]): boolean {
  return addresses.some((address) => isNeverLogged(address, rules));
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

  // Match candidates depend on direction (HubSpot-like semantics, owner
  // decision 2026-09-30, fixing the misattributed-inbound-sender bug where a
  // CRM person only in To/Cc of an automated inbound email — e.g. an
  // accounting system CC'ing a contact on a transfer receipt — was recorded
  // as having replied):
  //  - INBOUND: only the sender (From address) can match a CRM person. A
  //    person who merely appears in To/Cc of an inbound message did not
  //    reply, so they are never matched here, and the message is stored (see
  //    shouldStoreClassifiedMessage) only when the sender itself matches.
  //  - OUTBOUND: every To/Cc recipient is still a match candidate, same
  //    multi-person join semantics as before (a BD can legitimately email
  //    several CRM contacts on one thread).
  // The BD's own address is excluded so a self-sent message never matches
  // itself as a "contact" even if it happens to share a person row's email.
  const candidateAddresses = (
    direction === "inbound" ? [fromAddress] : [...new Set([...toAddresses, ...ccAddresses])]
  ).filter((address) => address !== "" && address !== bdEmail);

  // Whole-message never-log: checked over every raw participant address
  // (including the BD's own, unfiltered), not the deduped match candidates —
  // a never-logged address anywhere in From/To/Cc suppresses the message for
  // every person, not just itself.
  const allParticipantAddresses = [fromAddress, ...toAddresses, ...ccAddresses].filter((address) => address !== "");

  const matches: ClassifiedMatch[] = [];
  if (!isMessageNeverLogged(allParticipantAddresses, neverLogRules)) {
    const seenPersonIds = new Set<string>();
    for (const address of candidateAddresses) {
      const person = personByEmail.get(address);
      if (!person || seenPersonIds.has(person.personId)) continue;
      seenPersonIds.add(person.personId);
      matches.push({ personId: person.personId, matchedEmail: address, matchConfidence: person.confidence });
    }
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

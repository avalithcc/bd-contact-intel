/**
 * Decides which parsed delivery notifications may be acted on. Pure: inputs are never mutated.
 *
 * The security rule: a notification counts only when it links to a message THIS BD sent, to THAT address. Linking is by
 * Gmail thread id or by Message-ID (In-Reply-To / References / the embedded original), and the address must be one the
 * message was really sent to. Anything else is a stranger (or a forgery) telling us a contact is dead, and is ignored,
 * otherwise anyone could suppress any contact by emailing a fake notification.
 */
import type { BounceReasonKey, BounceSeverity, ParsedBounce } from "./parseBounce";

export interface OutboundCandidate {
  gmailThreadId: string;
  rfcMessageId: string | null;
  /** To and Cc, normalized. */
  recipients: readonly string[];
  subject: string | null;
}

export interface BounceEvent {
  dsnGmailMessageId: string;
  /** The address the CRM holds and we sent to (not necessarily the one the notification names). */
  address: string;
  severity: BounceSeverity;
  statusCode: string | null;
  reasonKey: BounceReasonKey;
  diagnostic: string | null;
  originalSubject: string | null;
  occurredAt: Date;
}

export interface BouncePlan {
  events: BounceEvent[];
  unlinked: number;
  duplicates: number;
}

/** THE key of one recorded notification for one address: the writer stores it, the planner reads it. */
export const bounceKey = (dsnGmailMessageId: string, address: string): string => `${dsnGmailMessageId}|${address}`;

export function planBounces(bounces: readonly ParsedBounce[], outbound: readonly OutboundCandidate[], recorded: ReadonlySet<string>): BouncePlan {
  const plan: BouncePlan = { events: [], unlinked: 0, duplicates: 0 };
  for (const bounce of bounces) {
    const linked = outbound.filter((o) => o.gmailThreadId === bounce.gmailThreadId || (o.rfcMessageId !== null && bounce.linkRfcIds.includes(o.rfcMessageId)));
    for (const r of bounce.recipients) {
      const named = [r.address, r.originalAddress].filter((a): a is string => a !== null);
      const message = linked.find((o) => named.some((a) => o.recipients.includes(a)));
      const address = message ? named.find((a) => message.recipients.includes(a)) : undefined;
      if (!message || !address) {
        plan.unlinked += 1;
        continue;
      }
      if (recorded.has(bounceKey(bounce.dsnGmailMessageId, address))) {
        plan.duplicates += 1;
        continue;
      }
      plan.events.push({
        dsnGmailMessageId: bounce.dsnGmailMessageId,
        address,
        severity: r.severity,
        statusCode: r.statusCode,
        reasonKey: r.reasonKey,
        diagnostic: r.diagnostic,
        originalSubject: bounce.originalSubject ?? message.subject,
        occurredAt: bounce.occurredAt,
      });
    }
  }
  return plan;
}

/** What a hard bounce did to the address's other records, reported on its timeline entry. */
export interface BounceEffects {
  sequenceNames: string[];
  scheduledCancelled: number;
  discarded: number;
}

export type BounceEntryMetadata = {
  severity: BounceSeverity;
  address: string;
  statusCode: string | null;
  reasonKey: BounceReasonKey;
  diagnostic: string | null;
  originalSubject: string | null;
  dsnGmailMessageId: string;
  occurredAt: string;
  source: "gmail_sync";
  /** Hard bounces only. */
  sequenceNames?: string[];
  scheduledCancelled?: number;
  suppressed?: true;
}

/** THE writer of an `email_bounced` entry's metadata (readBounceMetadata is its reader). */
export function buildBounceMetadata(event: BounceEvent, effects: BounceEffects | undefined): BounceEntryMetadata {
  return {
    severity: event.severity,
    address: event.address,
    statusCode: event.statusCode,
    reasonKey: event.reasonKey,
    diagnostic: event.diagnostic,
    originalSubject: event.originalSubject,
    dsnGmailMessageId: event.dsnGmailMessageId,
    occurredAt: event.occurredAt.toISOString(),
    source: "gmail_sync",
    ...(event.severity === "hard" ? { sequenceNames: effects?.sequenceNames ?? [], scheduledCancelled: effects?.scheduledCancelled ?? 0, suppressed: true as const } : {}),
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function readBounceMetadata(metadata: Record<string, unknown> | null | undefined): BounceEntryMetadata | null {
  if (!metadata || (metadata.severity !== "hard" && metadata.severity !== "soft")) return null;
  const address = str(metadata.address);
  if (!address) return null;
  return {
    severity: metadata.severity,
    address,
    statusCode: str(metadata.statusCode),
    reasonKey: (str(metadata.reasonKey) ?? "other") as BounceReasonKey,
    diagnostic: str(metadata.diagnostic),
    originalSubject: str(metadata.originalSubject),
    dsnGmailMessageId: str(metadata.dsnGmailMessageId) ?? "",
    occurredAt: str(metadata.occurredAt) ?? "",
    source: "gmail_sync",
    sequenceNames: Array.isArray(metadata.sequenceNames) ? metadata.sequenceNames.filter((n): n is string => typeof n === "string") : undefined,
    scheduledCancelled: typeof metadata.scheduledCancelled === "number" ? metadata.scheduledCancelled : undefined,
    suppressed: metadata.suppressed === true ? true : undefined,
  };
}

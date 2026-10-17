/**
 * Pure text for a bounce, shared by the timeline body (timelineEntryBody.ts), the dedicated timeline card and the email
 * property row. The stored address is complete; the UI shows it masked ("l***@acme.com") like the mockup.
 */
import { readBounceMetadata, type BounceEntryMetadata } from "@/lib/gmail/bouncePlan";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { fill } from "@/lib/sequences/viewText";

export function maskAddress(address: string): string {
  const at = address.indexOf("@");
  return at < 1 ? address : `${address[0]}***${address.slice(at)}`;
}

const REASON_KEY = {
  mailbox_not_found: "bounceReasonMailboxNotFound",
  domain_not_found: "bounceReasonDomainNotFound",
  mailbox_full: "bounceReasonMailboxFull",
  blocked: "bounceReasonBlocked",
  too_large: "bounceReasonTooLarge",
  other: "bounceReasonOther",
} as const satisfies Record<string, keyof ContactRecordLabels>;

export function bounceReasonText(reasonKey: string, l: ContactRecordLabels): string {
  return l[REASON_KEY[reasonKey as keyof typeof REASON_KEY] ?? "bounceReasonOther"] as string;
}

/** "casilla inexistente (5.1.1)", or the reason alone when the notification carried no code. */
export function reasonWithCode(meta: { reasonKey: string; statusCode: string | null }, l: ContactRecordLabels): string {
  const reason = bounceReasonText(meta.reasonKey, l);
  return meta.statusCode ? `${reason} (${meta.statusCode})` : reason;
}

export interface HardBounceFact {
  occurredAt: Date;
  reasonKey: string;
  statusCode: string | null;
}

/**
 * The newest HARD bounce among a person's activity rows, for the email row's hint. The record page already reads every
 * activity row of the person, so this adds no query. It reads all viewers' rows (not the redacted timeline): the fact that
 * the address bounced is team-wide, the original subject is not exposed here.
 */
export function latestHardBounce(rows: readonly { type: string; metadata: unknown }[]): HardBounceFact | null {
  let best: HardBounceFact | null = null;
  for (const row of rows) {
    if (row.type !== "email_bounced") continue;
    const meta = readBounceMetadata(row.metadata as Record<string, unknown> | null);
    if (!meta || meta.severity !== "hard") continue;
    const at = new Date(meta.occurredAt);
    if (Number.isNaN(at.getTime()) || (best && at <= best.occurredAt)) continue;
    best = { occurredAt: at, reasonKey: meta.reasonKey, statusCode: meta.statusCode };
  }
  return best;
}

export function emailBounceHint(fact: HardBounceFact, l: ContactRecordLabels, formatDate: (d: Date) => string): string {
  return fill(l.emailBouncedHint, { date: formatDate(fact.occurredAt), reason: reasonWithCode(fact, l) });
}

export function bounceEntryText(meta: BounceEntryMetadata, l: ContactRecordLabels): { headline: string; body: string } {
  const vars = { address: maskAddress(meta.address), reason: bounceReasonText(meta.reasonKey, l), code: meta.statusCode ?? "" };
  // "{reason} ()" would read as a bug: drop the empty parentheses when there is no code.
  const clean = (text: string) => text.replace(/\s*\(\)/g, "");
  return meta.severity === "hard"
    ? { headline: clean(fill(l.timelineBouncedHard, vars)), body: clean(fill(l.timelineBouncedHardBody, vars)) }
    : { headline: clean(fill(l.timelineBouncedSoft, vars)), body: `${fill(l.timelineBouncedSoftBody, vars)} ${l.timelineBouncedSoftNote}` };
}

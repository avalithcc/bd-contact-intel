/**
 * What the runner hands to the send port for one member. Pure. Built BEFORE the claim, so a message that cannot be
 * built never leaves a claim behind.
 *
 * The List-Unsubscribe pair is derived from the link already in the body: the token is stored only as a hash
 * (unsubscribeToken.ts), so the body is the one place the raw link survives, and the header can never name a different
 * token than the footer. The reminder threads on step 1's stored Message-ID and Gmail thread; the preSendChecks
 * `no_thread_headers` hold means the throw below is unreachable from the runner, and stays as the last guard against an
 * unthreaded reminder. The link is read from the RAW stored body BEFORE any composition. The subject is the approved draft's, verbatim: what the BD approved is what goes out.
 */
import type { MessageContent } from "@/lib/gmail/rawMessage";
import { composeReleaseBody } from "./composeRelease";
import { COMPLIANCE_CONFIG } from "./config";
import { extractUnsubscribeUrl } from "./preSendChecks";
import { buildUnsubscribeHeaders } from "./unsubscribeHeaders";

export interface ReleaseMessageFacts {
  id: string;
  sequenceId: string;
  personId: string;
  step: 1 | 2;
  email: string | null;
  subject: string;
  body: string;
  /** The sending BD's stored signature (bd.signature_html), or null. Appended ABOVE the footer by composeReleaseBody. */
  signatureHtml: string | null;
  accountEmail: string;
  step1RfcMessageId: string | null;
  step1ThreadId: string | null;
}

export type ReleaseMessage = {
  to: string;
  subject: string;
  personId: string;
  extraHeaders: string[];
  reply?: { inReplyTo: string; references: string; threadId: string };
  activityMetadata: { sequenceId: string; sequenceMemberId: string; step: 1 | 2 };
} & MessageContent;

export function buildReleaseMessage(f: ReleaseMessageFacts): ReleaseMessage {
  const link = extractUnsubscribeUrl(f.body);
  if (!link) throw new Error("Refusing to send: the body has no unsubscribe link");
  if (f.step === 2 && (!f.step1RfcMessageId || !f.step1ThreadId)) throw new Error("Refusing to send an unthreaded reminder");
  return {
    to: (f.email ?? "").trim(),
    subject: f.subject,
    ...composeReleaseBody(f.body, f.signatureHtml, link, COMPLIANCE_CONFIG),
    personId: f.personId,
    extraHeaders: buildUnsubscribeHeaders(link, f.accountEmail),
    ...(f.step === 2 ? { reply: { inReplyTo: f.step1RfcMessageId!, references: f.step1RfcMessageId!, threadId: f.step1ThreadId! } } : {}),
    activityMetadata: { sequenceId: f.sequenceId, sequenceMemberId: f.id, step: f.step },
  };
}

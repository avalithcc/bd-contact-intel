/**
 * Builds, for a message this app just sent, the same `ClassifiedMessage` the
 * Gmail sync would produce when it later reads that message — by feeding a
 * `ParsedGmailMessage` through the REAL `classifyGmailMessage` (direction,
 * address normalisation, never-log, person matching) and the real
 * `truncateBodyText`, instead of re-deriving any of it. Pure.
 */
import { classifyGmailMessage, type ClassifiedMessage, type KnownPersonEmail, type NeverLogRule } from "./classify";
import type { ParsedGmailMessage } from "./parseMessage";
import { plainTextPart, type MessageContent } from "./rawMessage";
import type { SentMessageMetadata } from "./sentMessageMetadata";
import { truncateBodyText } from "./truncateBodyText";

export interface SentMessageInput {
  bdEmail: string;
  /** The raw `To` header value the app sent. */
  to: string;
  subject: string;
  content: MessageContent;
  gmailMessageId: string;
  gmailThreadId: string;
  /** Null when the Message-ID read-back failed. */
  metadata: SentMessageMetadata | null;
  /** Fallback `sentAt` when there is no read-back. */
  now: Date;
}

export function buildSentParsedMessage(input: SentMessageInput): ParsedGmailMessage {
  const text = plainTextPart(input.content);
  // Same rule as parseGmailMessage: an empty text/plain part is "no body".
  const body = text === "" ? { text: null, truncated: false } : truncateBodyText(text);
  return {
    gmailMessageId: input.gmailMessageId,
    gmailThreadId: input.gmailThreadId,
    from: input.bdEmail,
    to: input.to,
    cc: "",
    subject: input.subject || null,
    bodyText: body.text,
    bodyTruncated: body.truncated,
    sentAt: input.metadata?.sentAt ?? input.now,
    rfcMessageId: input.metadata?.rfcMessageId ?? null,
    references: input.metadata?.references ?? null,
  };
}

export interface ClassifySentMessageInput extends SentMessageInput {
  knownPersons: readonly KnownPersonEmail[];
  neverLogRules: readonly NeverLogRule[];
}

export function classifySentMessage(input: ClassifySentMessageInput): ClassifiedMessage {
  return classifyGmailMessage({
    message: buildSentParsedMessage(input),
    bdEmail: input.bdEmail,
    knownPersons: input.knownPersons,
    neverLogRules: input.neverLogRules,
    // The caller writes the platform `email_sent` activity itself.
    platformSentGmailMessageIds: new Set([input.gmailMessageId]),
  });
}

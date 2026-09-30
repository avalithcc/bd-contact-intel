/**
 * First-sync backfill for a newly-(re)connected account (email-sync brief,
 * slice 4): pulls the last `windowDays` (90, per owner decision) of mail via
 * `users.messages.list`, one page at a time, resumable across cron runs via
 * a stored `pageToken` (email_account.backfill_page_token). Once the last
 * page is drained, seeds `historyId` from `getCurrentHistoryId()` so future
 * runs switch to incremental `history.list` polling
 * (src/lib/gmail/syncAccount.ts). Every dependency is injected, same DI
 * shape as syncAccount.ts, so this is fully unit-testable against fakes.
 */
import {
  classifyGmailMessage,
  extractEmailAddresses,
  shouldStoreClassifiedMessage,
  type ClassifiedMessage,
  type KnownPersonEmail,
  type NeverLogRule,
} from "./classify";
import { parseGmailMessage, type ParsedGmailMessage } from "./parseMessage";
import type { GmailClient } from "./client";

export interface BackfillAccountDeps {
  client: GmailClient;
  bdId: string;
  bdEmail: string;
  /** Resume cursor from a previous, budget-truncated run; null to start from the most recent mail. */
  pageToken: string | null;
  deadlineAt: number;
  windowDays: number;
  now: Date;
  getKnownPersons(addresses: string[]): Promise<KnownPersonEmail[]>;
  getNeverLogRules(): Promise<NeverLogRule[]>;
  getPlatformSentIds(gmailMessageIds: string[]): Promise<Set<string>>;
  writeMessages(classified: ClassifiedMessage[]): Promise<{ inserted: number }>;
}

export interface BackfillAccountResult {
  status: "in_progress" | "complete";
  /** Persist to email_account.backfill_page_token; null on "complete" (nothing left to resume). */
  nextPageToken: string | null;
  /** Persist to email_account.history_id once "complete"; null while "in_progress". */
  finalHistoryId: string | null;
  messagesFetched: number;
  messagesStored: number;
}

/** Gmail search syntax only supports whole days, so the boundary is always UTC-midnight `windowDays` ago. */
export function buildBackfillQuery(windowDays: number, now: Date): string {
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const y = cutoff.getUTCFullYear();
  const m = String(cutoff.getUTCMonth() + 1).padStart(2, "0");
  const d = String(cutoff.getUTCDate()).padStart(2, "0");
  return `after:${y}/${m}/${d}`;
}

export async function backfillAccountFirstSync(deps: BackfillAccountDeps): Promise<BackfillAccountResult> {
  const query = buildBackfillQuery(deps.windowDays, deps.now);
  const page = await deps.client.listMessages(query, deps.pageToken ?? undefined);

  const rawMessages: ParsedGmailMessage[] = [];
  let fullyFetched = true;
  for (const id of page.messageIds) {
    if (Date.now() >= deps.deadlineAt) {
      fullyFetched = false;
      break;
    }
    rawMessages.push(parseGmailMessage(await deps.client.getMessage(id)));
  }

  const candidateAddresses = [
    ...new Set(
      rawMessages.flatMap((m) => [
        ...extractEmailAddresses(m.from),
        ...extractEmailAddresses(m.to),
        ...extractEmailAddresses(m.cc),
      ]),
    ),
  ];

  const knownPersons = await deps.getKnownPersons(candidateAddresses);
  const neverLogRules = await deps.getNeverLogRules();
  const platformSentGmailMessageIds = await deps.getPlatformSentIds(rawMessages.map((m) => m.gmailMessageId));

  const classified = rawMessages.map((message) =>
    classifyGmailMessage({ message, bdEmail: deps.bdEmail, knownPersons, neverLogRules, platformSentGmailMessageIds }),
  );
  const toStore = classified.filter(shouldStoreClassifiedMessage);
  const writeResult = toStore.length > 0 ? await deps.writeMessages(toStore) : { inserted: 0 };

  // Only advance past this page once every one of its messages was actually
  // fetched — a budget cutoff mid-page must resume the SAME page next run
  // (ON CONFLICT DO NOTHING makes reprocessing already-fetched ids safe).
  if (!fullyFetched) {
    return {
      status: "in_progress",
      nextPageToken: deps.pageToken,
      finalHistoryId: null,
      messagesFetched: rawMessages.length,
      messagesStored: writeResult.inserted,
    };
  }

  if (page.nextPageToken) {
    return {
      status: "in_progress",
      nextPageToken: page.nextPageToken,
      finalHistoryId: null,
      messagesFetched: rawMessages.length,
      messagesStored: writeResult.inserted,
    };
  }

  const finalHistoryId = await deps.client.getCurrentHistoryId();
  return {
    status: "complete",
    nextPageToken: null,
    finalHistoryId,
    messagesFetched: rawMessages.length,
    messagesStored: writeResult.inserted,
  };
}

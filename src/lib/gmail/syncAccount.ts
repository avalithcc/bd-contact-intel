/**
 * Per-BD incremental sync orchestration (email-sync brief, slice 3). Every
 * dependency is injected (`SyncAccountDeps`) — a `GmailClient` plus plain
 * DB-reading/writing functions — so this stays fully unit-testable
 * (tests/unit/gmailSyncAccount.test.ts) with fakes, never a real Gmail
 * mailbox or a live DB. `/api/gmail/sync` (src/app/api/gmail/sync/route.ts)
 * wires up the real client and real queries and calls this once per
 * connected BD, sequentially — never `Promise.all` across mailboxes
 * (PERFORMANCE.md; prod pool `max: 3`).
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

export interface SyncAccountDeps {
  client: GmailClient;
  bdId: string;
  bdEmail: string;
  /** Null means "no baseline yet" — the caller (slice 4) must run the first-sync backfill instead. */
  historyId: string | null;
  /** `Date.now()`-based wall-clock cutoff for this BD's turn (per-BD time budget). */
  deadlineAt: number;
  getKnownPersons(addresses: string[]): Promise<KnownPersonEmail[]>;
  getNeverLogRules(): Promise<NeverLogRule[]>;
  getPlatformSentIds(gmailMessageIds: string[]): Promise<Set<string>>;
  writeMessages(classified: ClassifiedMessage[]): Promise<{ inserted: number }>;
}

export interface SyncAccountResult {
  status: "ok" | "needs_baseline";
  /** Only set once every page for this run was drained AND every message fetched — see the loop below. */
  newHistoryId: string | null;
  messagesFetched: number;
  messagesStored: number;
}

export async function syncAccountIncremental(deps: SyncAccountDeps): Promise<SyncAccountResult> {
  if (!deps.historyId) {
    return { status: "needs_baseline", newHistoryId: null, messagesFetched: 0, messagesStored: 0 };
  }

  const messageIds = new Set<string>();
  let latestHistoryId: string | null = null;
  let pageToken: string | undefined;
  let exhausted = false;

  while (Date.now() < deps.deadlineAt) {
    const result = await deps.client.historyList(deps.historyId, pageToken);
    if (!result.ok) {
      return { status: "needs_baseline", newHistoryId: null, messagesFetched: 0, messagesStored: 0 };
    }
    for (const record of result.page.historyRecords) {
      for (const added of record.messagesAdded ?? []) messageIds.add(added.message.id);
    }
    latestHistoryId = result.page.historyId;
    pageToken = result.page.nextPageToken;
    if (!pageToken) {
      exhausted = true;
      break;
    }
  }

  const ids = [...messageIds];
  const rawMessages: ParsedGmailMessage[] = [];
  // Ids we actually ASKED Gmail about. Distinct from `rawMessages.length`,
  // which counts only the ones that came back — see the cursor rule below.
  let attempted = 0;
  for (const id of ids) {
    if (Date.now() >= deps.deadlineAt) break;
    attempted += 1;
    // `null` = gone from the mailbox between history.list and this fetch.
    // Skipping it is the whole point: before this, ONE such message threw and
    // aborted the entire run for that BD, every 15 minutes, while
    // `last_synced_at` still advanced and the account still read "connected" —
    // so the sync looked healthy and stored nothing. (Observed in production
    // 2026-10-01: all three BDs, every tick, `messages.get failed: 404`.)
    const raw = await deps.client.getMessage(id);
    if (raw === null) continue;
    rawMessages.push(parseGmailMessage(raw));
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

  // Sequential, not Promise.all — this is one BD's own turn, but keeping
  // every DB round trip serialized here too avoids ever depending on the
  // full 3-connection pool budget for a single background sync tick while
  // interactive page requests may be running concurrently.
  const knownPersons = await deps.getKnownPersons(candidateAddresses);
  const neverLogRules = await deps.getNeverLogRules();
  const platformSentGmailMessageIds = await deps.getPlatformSentIds(rawMessages.map((m) => m.gmailMessageId));

  const classified = rawMessages.map((message) =>
    classifyGmailMessage({ message, bdEmail: deps.bdEmail, knownPersons, neverLogRules, platformSentGmailMessageIds }),
  );
  const toStore = classified.filter(shouldStoreClassifiedMessage);
  const writeResult = toStore.length > 0 ? await deps.writeMessages(toStore) : { inserted: 0 };

  return {
    status: "ok",
    // Only advance the cursor once every page was drained AND every id the
    // history reported was ATTEMPTED — otherwise the next run must resume
    // from the SAME startHistoryId so a message that ran out of budget is
    // never silently skipped. Reprocessing already-fetched ids is safe:
    // `email_message`'s own `unique(bd_id, gmail_message_id)`
    // (`ON CONFLICT DO NOTHING`) makes the whole write, including its
    // activity rows, idempotent (see buildSyncedActivities.ts).
    //
    // The test is `attempted`, NOT `rawMessages.length`: a 404 means that
    // message is GONE and will never come back, so it must not pin the
    // cursor forever. Only the deadline break — ids we never asked about —
    // may hold it. Using `rawMessages.length` here would trade the crash
    // this file just fixed for a cursor stuck against a deleted message,
    // re-reading the same window every 15 minutes until Gmail expires the
    // history and forces a full re-baseline.
    newHistoryId: exhausted && attempted === ids.length ? latestHistoryId : null,
    messagesFetched: rawMessages.length,
    messagesStored: writeResult.inserted,
  };
}

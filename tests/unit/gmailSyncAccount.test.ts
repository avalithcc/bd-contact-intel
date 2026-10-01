/**
 * Unit tests for src/lib/gmail/syncAccount.ts — the per-BD incremental sync
 * orchestration. Every dependency (Gmail client, DB reads/writes) is
 * injected as a fake; no network, no DB (HARD RULE: never call the Gmail
 * API against real mailboxes, no production DB writes from a test).
 * Run with: npx tsx --test tests/unit/gmailSyncAccount.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { syncAccountIncremental, type SyncAccountDeps } from "@/lib/gmail/syncAccount";
import type { GmailClient, GmailHistoryResult } from "@/lib/gmail/client";
import type { GmailApiMessage } from "@/lib/gmail/parseMessage";
import type { ClassifiedMessage, KnownPersonEmail, NeverLogRule } from "@/lib/gmail/classify";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function fixtureRawMessage(id: string, from: string, to: string): GmailApiMessage {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: "1700000000000",
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
      ],
      mimeType: "text/plain",
      body: { data: b64url("hi") },
    },
  };
}

interface FakeClientOptions {
  historyPages?: GmailHistoryResult[];
  messagesById?: Record<string, GmailApiMessage>;
  /** Ids Gmail answers 404 for — deleted/expunged between list and get. */
  goneMessageIds?: string[];
}

function fakeClient(opts: FakeClientOptions): GmailClient & { getMessageCalls: string[] } {
  const pages = opts.historyPages ?? [];
  let pageIndex = 0;
  const getMessageCalls: string[] = [];
  return {
    getMessageCalls,
    async historyList() {
      const page = pages[pageIndex];
      pageIndex += 1;
      return page ?? { ok: true, page: { historyRecords: [], historyId: "999" } };
    },
    async listMessages() {
      return { messageIds: [] };
    },
    async getMessage(id: string) {
      getMessageCalls.push(id);
      // `goneMessageIds` models Gmail answering 404: the real client returns
      // null for those (src/lib/gmail/client.ts), it does not throw.
      if (opts.goneMessageIds?.includes(id)) return null;
      const message = opts.messagesById?.[id];
      if (!message) throw new Error(`no fixture for message ${id}`);
      return message;
    },
    async getCurrentHistoryId() {
      return "999";
    },
  };
}

function baseDeps(overrides: Partial<SyncAccountDeps> = {}): SyncAccountDeps {
  return {
    client: fakeClient({}),
    bdId: "bd-1",
    bdEmail: "cristian@avalith.net",
    historyId: "100",
    deadlineAt: Date.now() + 10_000,
    getKnownPersons: async () => [],
    getNeverLogRules: async () => [],
    getPlatformSentIds: async () => new Set(),
    writeMessages: async () => ({ inserted: 0 }),
    ...overrides,
  };
}

test("no stored historyId yet returns needs_baseline without calling history.list", async () => {
  let called = false;
  const client = fakeClient({});
  const originalHistoryList = client.historyList.bind(client);
  client.historyList = async (...args) => {
    called = true;
    return originalHistoryList(...args);
  };
  const result = await syncAccountIncremental(baseDeps({ client, historyId: null }));
  assert.equal(result.status, "needs_baseline");
  assert.equal(called, false);
});

test("a 404/stale history response returns needs_baseline", async () => {
  const client = fakeClient({ historyPages: [{ ok: false, staleHistory: true }] });
  const result = await syncAccountIncremental(baseDeps({ client }));
  assert.equal(result.status, "needs_baseline");
});

test("an exhausted single page with no new messages advances historyId", async () => {
  const client = fakeClient({ historyPages: [{ ok: true, page: { historyRecords: [], historyId: "150" } }] });
  const result = await syncAccountIncremental(baseDeps({ client }));
  assert.equal(result.status, "ok");
  assert.equal(result.newHistoryId, "150");
  assert.equal(result.messagesFetched, 0);
});

test("fetches and classifies a new inbound message, storing only CRM-matched ones", async () => {
  const raw = fixtureRawMessage("msg-1", "jane@prospect.com", "cristian@avalith.net");
  const client = fakeClient({
    historyPages: [
      {
        ok: true,
        page: {
          historyRecords: [{ messagesAdded: [{ message: { id: "msg-1", threadId: "thread-msg-1" } }] }],
          historyId: "200",
        },
      },
    ],
    messagesById: { "msg-1": raw },
  });

  const writeCalls: ClassifiedMessage[][] = [];
  const knownPersons: KnownPersonEmail[] = [{ personId: "person-1", emailNormalized: "jane@prospect.com", confidence: "exact" }];

  const result = await syncAccountIncremental(
    baseDeps({
      client,
      getKnownPersons: async () => knownPersons,
      writeMessages: async (classified) => {
        writeCalls.push(classified);
        return { inserted: classified.length };
      },
    }),
  );

  assert.equal(result.status, "ok");
  assert.equal(result.messagesFetched, 1);
  assert.equal(result.messagesStored, 1);
  assert.equal(result.newHistoryId, "200");
  assert.equal(writeCalls[0]?.length, 1);
  assert.equal(writeCalls[0]?.[0]?.matches[0]?.personId, "person-1");
});

test("a message with no CRM match is fetched but never passed to writeMessages", async () => {
  const raw = fixtureRawMessage("msg-2", "stranger@example.com", "cristian@avalith.net");
  const client = fakeClient({
    historyPages: [
      {
        ok: true,
        page: {
          historyRecords: [{ messagesAdded: [{ message: { id: "msg-2", threadId: "thread-msg-2" } }] }],
          historyId: "201",
        },
      },
    ],
    messagesById: { "msg-2": raw },
  });

  let writeCalled = false;
  const result = await syncAccountIncremental(
    baseDeps({
      client,
      getKnownPersons: async () => [],
      writeMessages: async (classified) => {
        writeCalled = true;
        return { inserted: classified.length };
      },
    }),
  );

  assert.equal(result.status, "ok");
  assert.equal(result.messagesFetched, 1);
  assert.equal(result.messagesStored, 0);
  assert.equal(writeCalled, false);
});

test("never-log rules from the syncing BD suppress a match before storage", async () => {
  const raw = fixtureRawMessage("msg-3", "jane@prospect.com", "cristian@avalith.net");
  const client = fakeClient({
    historyPages: [
      {
        ok: true,
        page: {
          historyRecords: [{ messagesAdded: [{ message: { id: "msg-3", threadId: "thread-msg-3" } }] }],
          historyId: "202",
        },
      },
    ],
    messagesById: { "msg-3": raw },
  });

  const neverLogRules: NeverLogRule[] = [{ kind: "address", value: "jane@prospect.com" }];
  let writeCalled = false;
  const result = await syncAccountIncremental(
    baseDeps({
      client,
      getKnownPersons: async () => [{ personId: "person-1", emailNormalized: "jane@prospect.com", confidence: "exact" }],
      getNeverLogRules: async () => neverLogRules,
      writeMessages: async () => {
        writeCalled = true;
        return { inserted: 0 };
      },
    }),
  );

  assert.equal(result.messagesStored, 0);
  assert.equal(writeCalled, false);
});

test("does not advance historyId when the deadline passes before the last page is drained", async () => {
  const client = fakeClient({
    historyPages: [
      { ok: true, page: { historyRecords: [], nextPageToken: "p2", historyId: "300" } },
      { ok: true, page: { historyRecords: [], historyId: "301" } },
    ],
  });
  // Deadline already passed — the loop must stop before requesting page 2.
  const result = await syncAccountIncremental(baseDeps({ client, deadlineAt: Date.now() - 1 }));
  assert.equal(result.status, "ok");
  assert.equal(result.newHistoryId, null);
});

test("platformSentGmailMessageIds flows through to the classifier via getPlatformSentIds", async () => {
  const raw = fixtureRawMessage("msg-4", "cristian@avalith.net", "jane@prospect.com");
  const client = fakeClient({
    historyPages: [
      {
        ok: true,
        page: {
          historyRecords: [{ messagesAdded: [{ message: { id: "msg-4", threadId: "thread-msg-4" } }] }],
          historyId: "203",
        },
      },
    ],
    messagesById: { "msg-4": raw },
  });

  const writeCalls: ClassifiedMessage[][] = [];
  await syncAccountIncremental(
    baseDeps({
      client,
      getKnownPersons: async () => [{ personId: "person-1", emailNormalized: "jane@prospect.com", confidence: "exact" }],
      getPlatformSentIds: async () => new Set(["msg-4"]),
      writeMessages: async (classified) => {
        writeCalls.push(classified);
        return { inserted: classified.length };
      },
    }),
  );

  assert.equal(writeCalls[0]?.[0]?.isPlatformSent, true);
});

/**
 * Production outage, 2026-10-01: `messages.get` returned 404 for one message
 * and the thrown error aborted the ENTIRE run, for all three BDs, every 15
 * minutes — while `last_synced_at` still advanced and the account still read
 * "connected". The sync looked healthy and stored nothing for hours.
 *
 * A message can always vanish between `history.list` naming it and the fetch.
 * That must cost exactly that one message, never the run.
 */
test("a message that 404s is skipped and the rest of the batch still syncs", async () => {
  const good = fixtureRawMessage("msg-ok", "jane@prospect.com", "cristian@avalith.net");
  const client = fakeClient({
    historyPages: [
      {
        ok: true,
        page: {
          historyRecords: [
            { messagesAdded: [{ message: { id: "msg-gone", threadId: "thread-gone" } }] },
            { messagesAdded: [{ message: { id: "msg-ok", threadId: "thread-msg-ok" } }] },
          ],
          historyId: "301",
        },
      },
    ],
    messagesById: { "msg-ok": good },
    goneMessageIds: ["msg-gone"],
  });

  const writeCalls: ClassifiedMessage[][] = [];
  const result = await syncAccountIncremental(
    baseDeps({
      client,
      getKnownPersons: async () => [
        { personId: "person-1", emailNormalized: "jane@prospect.com", confidence: "exact" } as KnownPersonEmail,
      ],
      writeMessages: async (classified) => {
        writeCalls.push(classified);
        return { inserted: classified.length };
      },
    }),
  );

  // The run completes rather than throwing, and the surviving message is stored.
  assert.equal(result.status, "ok");
  assert.deepEqual(client.getMessageCalls, ["msg-gone", "msg-ok"]);
  assert.equal(writeCalls.length, 1);
  assert.equal(writeCalls[0]!.length, 1);
  assert.equal(writeCalls[0]![0]!.gmailMessageId, "msg-ok");
  // The cursor still advances: the vanished message is never coming back.
  assert.equal(result.newHistoryId, "301");
});

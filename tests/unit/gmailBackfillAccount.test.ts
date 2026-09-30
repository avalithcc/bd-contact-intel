/**
 * Unit tests for src/lib/gmail/backfillAccount.ts — the first-sync 90-day
 * backfill (email-sync brief slice 4). Every dependency is injected; no
 * network, no DB.
 * Run with: npx tsx --test tests/unit/gmailBackfillAccount.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { backfillAccountFirstSync, buildBackfillQuery, type BackfillAccountDeps } from "@/lib/gmail/backfillAccount";
import type { GmailClient, GmailMessagesListPage } from "@/lib/gmail/client";
import type { GmailApiMessage } from "@/lib/gmail/parseMessage";
import type { ClassifiedMessage, KnownPersonEmail } from "@/lib/gmail/classify";

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
  listPages?: GmailMessagesListPage[];
  messagesById?: Record<string, GmailApiMessage>;
  currentHistoryId?: string;
}

function fakeClient(opts: FakeClientOptions): GmailClient {
  const pages = opts.listPages ?? [];
  let pageIndex = 0;
  return {
    async historyList() {
      throw new Error("not used by backfill");
    },
    async listMessages() {
      const page = pages[pageIndex];
      pageIndex += 1;
      return page ?? { messageIds: [] };
    },
    async getMessage(id: string) {
      const message = opts.messagesById?.[id];
      if (!message) throw new Error(`no fixture for message ${id}`);
      return message;
    },
    async getCurrentHistoryId() {
      return opts.currentHistoryId ?? "999";
    },
  };
}

function baseDeps(overrides: Partial<BackfillAccountDeps> = {}): BackfillAccountDeps {
  return {
    client: fakeClient({}),
    bdId: "bd-1",
    bdEmail: "cristian@avalith.net",
    pageToken: null,
    deadlineAt: Date.now() + 10_000,
    windowDays: 90,
    now: new Date("2026-09-30T00:00:00Z"),
    getKnownPersons: async () => [],
    getNeverLogRules: async () => [],
    getPlatformSentIds: async () => new Set(),
    writeMessages: async () => ({ inserted: 0 }),
    ...overrides,
  };
}

test("buildBackfillQuery renders an after: filter windowDays before now", () => {
  const query = buildBackfillQuery(90, new Date("2026-09-30T00:00:00Z"));
  assert.equal(query, "after:2026/07/02");
});

test("a single exhausted page with no messages completes the backfill and seeds historyId", async () => {
  const client = fakeClient({ listPages: [{ messageIds: [] }], currentHistoryId: "500" });
  const result = await backfillAccountFirstSync(baseDeps({ client }));
  assert.equal(result.status, "complete");
  assert.equal(result.finalHistoryId, "500");
  assert.equal(result.nextPageToken, null);
});

test("fetches, classifies and stores CRM-matched messages from a page", async () => {
  const raw = fixtureRawMessage("msg-1", "jane@prospect.com", "cristian@avalith.net");
  const client = fakeClient({
    listPages: [{ messageIds: ["msg-1"] }],
    messagesById: { "msg-1": raw },
  });
  const knownPersons: KnownPersonEmail[] = [{ personId: "person-1", emailNormalized: "jane@prospect.com", confidence: "exact" }];
  const writeCalls: ClassifiedMessage[][] = [];

  const result = await backfillAccountFirstSync(
    baseDeps({
      client,
      getKnownPersons: async () => knownPersons,
      writeMessages: async (classified) => {
        writeCalls.push(classified);
        return { inserted: classified.length };
      },
    }),
  );

  assert.equal(result.status, "complete");
  assert.equal(result.messagesFetched, 1);
  assert.equal(result.messagesStored, 1);
  assert.equal(writeCalls[0]?.[0]?.matches[0]?.personId, "person-1");
});

test("a message with no CRM match is fetched but never stored", async () => {
  const raw = fixtureRawMessage("msg-2", "stranger@example.com", "cristian@avalith.net");
  const client = fakeClient({ listPages: [{ messageIds: ["msg-2"] }], messagesById: { "msg-2": raw } });
  let writeCalled = false;
  const result = await backfillAccountFirstSync(
    baseDeps({
      client,
      writeMessages: async (classified) => {
        writeCalled = true;
        return { inserted: classified.length };
      },
    }),
  );
  assert.equal(result.messagesStored, 0);
  assert.equal(writeCalled, false);
});

test("more pages remain (nextPageToken present) returns in_progress with a resumable cursor", async () => {
  const client = fakeClient({ listPages: [{ messageIds: [], nextPageToken: "page-2" }] });
  const result = await backfillAccountFirstSync(baseDeps({ client }));
  assert.equal(result.status, "in_progress");
  assert.equal(result.nextPageToken, "page-2");
  assert.equal(result.finalHistoryId, null);
});

test("resumes from the stored pageToken by passing it to listMessages", async () => {
  let receivedPageToken: string | undefined;
  const client: GmailClient = {
    ...fakeClient({ listPages: [{ messageIds: [] }] }),
    async listMessages(_query, pageToken) {
      receivedPageToken = pageToken;
      return { messageIds: [] };
    },
  };
  await backfillAccountFirstSync(baseDeps({ client, pageToken: "resume-here" }));
  assert.equal(receivedPageToken, "resume-here");
});

test("deadline passing before the page is drained returns in_progress without advancing the cursor", async () => {
  const client = fakeClient({ listPages: [{ messageIds: ["msg-1"], nextPageToken: "page-2" }] });
  const result = await backfillAccountFirstSync(baseDeps({ client, deadlineAt: Date.now() - 1 }));
  assert.equal(result.status, "in_progress");
  // Stays on the SAME page (not advanced to "page-2") since it never finished fetching this page's messages.
  assert.equal(result.nextPageToken, null);
});

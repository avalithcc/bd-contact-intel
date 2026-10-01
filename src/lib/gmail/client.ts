/**
 * The one interface /api/gmail/sync talks to Gmail through. Unit tests
 * (tests/unit/gmailSyncAccount.test.ts) implement a fake `GmailClient` and
 * never call Google (HARD RULE: never call the Gmail API against real
 * mailboxes). `createGmailClient` is the real fetch-based implementation,
 * wired up only in src/app/api/gmail/sync/route.ts at runtime.
 */
import type { GmailApiMessage } from "./parseMessage";

export interface GmailHistoryRecord {
  messagesAdded?: { message: { id: string; threadId: string } }[];
}

export interface GmailHistoryPage {
  historyRecords: GmailHistoryRecord[];
  nextPageToken?: string;
  // The mailbox's CURRENT historyId. Only safe to persist once the caller
  // has drained every page for this run (no nextPageToken left) — see
  // syncAccount.ts.
  historyId: string;
}

export type GmailHistoryResult = { ok: true; page: GmailHistoryPage } | { ok: false; staleHistory: true };

export interface GmailMessagesListPage {
  messageIds: string[];
  nextPageToken?: string;
}

export interface GmailClient {
  /** `users.history.list`. Returns `{ ok: false, staleHistory: true }` on a 404 (startHistoryId too old). */
  historyList(startHistoryId: string, pageToken?: string): Promise<GmailHistoryResult>;
  /** `users.messages.list` — used only for the first-sync/re-baseline bounded pull (slice 4). */
  listMessages(query: string, pageToken?: string): Promise<GmailMessagesListPage>;
  /**
   * `users.messages.get?format=full`. Returns `null` on a 404 — the message
   * was deleted or expunged between `history.list` naming it and this fetch,
   * which is normal and must NOT fail the run. Mirrors `historyList`'s own
   * 404 handling. Any other non-ok status still throws: a 401 needs reauth
   * and a 429 needs backoff, and swallowing those would hide a real outage.
   */
  getMessage(id: string): Promise<GmailApiMessage | null>;
  /** `users.getProfile` — the mailbox's current historyId, used to seed a fresh baseline. */
  getCurrentHistoryId(): Promise<string>;
}

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export function createGmailClient(accessToken: string): GmailClient {
  async function apiGet(path: string): Promise<Response> {
    return fetch(`${GMAIL_API_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  }

  return {
    async historyList(startHistoryId, pageToken) {
      const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await apiGet(`/history?${params.toString()}`);
      if (res.status === 404) return { ok: false, staleHistory: true };
      if (!res.ok) throw new Error(`Gmail history.list failed: ${res.status} ${await res.text()}`);
      const body = await res.json();
      return {
        ok: true,
        page: { historyRecords: body.history ?? [], nextPageToken: body.nextPageToken, historyId: body.historyId },
      };
    },
    async listMessages(query, pageToken) {
      const params = new URLSearchParams({ q: query, maxResults: "50" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await apiGet(`/messages?${params.toString()}`);
      if (!res.ok) throw new Error(`Gmail messages.list failed: ${res.status} ${await res.text()}`);
      const body = await res.json();
      return {
        messageIds: ((body.messages ?? []) as { id: string }[]).map((m) => m.id),
        nextPageToken: body.nextPageToken,
      };
    },
    async getMessage(id) {
      const res = await apiGet(`/messages/${id}?format=full`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Gmail messages.get failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async getCurrentHistoryId() {
      const res = await apiGet(`/profile`);
      if (!res.ok) throw new Error(`Gmail getProfile failed: ${res.status} ${await res.text()}`);
      const body = await res.json();
      return String(body.historyId);
    },
  };
}

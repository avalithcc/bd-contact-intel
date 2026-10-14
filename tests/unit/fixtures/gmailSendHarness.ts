import { mock } from "node:test";

// Shared fake world for the send-path tests (gmailSendCharacterization,
// gmailSendFromAccount). postgres-js connects lazily, so a placeholder URL is
// enough to import `@/db`; `db.select/update/transaction` and `fetch` are
// stubbed so the REAL send code runs end to end without a network or a database.
process.env.DATABASE_URL ??= "postgres://unit:unit@127.0.0.1:1/unit";
process.env.GMAIL_TOKEN_ENCRYPTION_KEY ??= "unit-test-key";
process.env.GOOGLE_OAUTH_CLIENT_ID ??= "client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET ??= "client-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI ??= "https://example.test/callback";

export type FakeFetchCall = { url: string; init: RequestInit };
export type FakeResponse = { ok: boolean; status?: number; body: unknown };

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export async function makeAccountRow(over: Record<string, unknown> = {}) {
  const { encryptToken } = await import("@/lib/gmail/crypto");
  return {
    bdId: "bd-1",
    id: "acct-1",
    emailAddress: "sender@avalith.test",
    refreshTokenEncrypted: encryptToken("refresh-token-1"),
    status: "connected",
    lastErrorMessage: null,
    grantedScopes: null,
    ...over,
  };
}

/**
 * `accountRows` is what the account lookup returns. Any later `db.select`
 * (recordSentEmail's classification read) throws, which that function already
 * tolerates by falling back to the activity-only write; that fallback is what
 * the tests observe through `insertedActivities`.
 */
export async function installFakeWorld(opts: {
  accountRows: unknown[];
  token?: FakeResponse;
  send?: FakeResponse;
}) {
  const { db } = await import("@/db");
  const selectCalls: number[] = [];
  const updates: Record<string, unknown>[] = [];
  const insertedActivities: Record<string, unknown>[] = [];
  const fetchCalls: FakeFetchCall[] = [];

  const stubs = [
    mock.method(db, "select", (() => {
      selectCalls.push(1);
      if (selectCalls.length > 1) throw new Error("no database in unit tests");
      return { from: () => ({ where: async () => opts.accountRows }) };
    }) as unknown as typeof db.select),
    mock.method(db, "update", (() => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => undefined };
      },
    })) as unknown as typeof db.update),
    mock.method(db, "transaction", (async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            insertedActivities.push(v);
            return { returning: async () => [{ ...v }] };
          },
        }),
      })) as unknown as typeof db.transaction),
    mock.method(globalThis, "fetch", (async (url: string, init: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      const r = String(url) === TOKEN_URL ? opts.token : opts.send;
      if (!r) throw new Error(`unexpected fetch ${url}`);
      const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 400), text: async () => text, json: async () => r.body };
    }) as unknown as typeof fetch),
    mock.method(console, "error", () => undefined),
  ];

  return {
    selectCalls,
    updates,
    insertedActivities,
    fetchCalls,
    restore: () => stubs.forEach((s) => s.mock.restore()),
  };
}

/** The decoded RFC 5322 message inside a recorded `messages.send` request. */
export function decodeSentRaw(call: FakeFetchCall): { raw: string; threadId?: string } {
  const { raw, threadId } = JSON.parse(String(call.init.body)) as { raw: string; threadId?: string };
  return { raw: Buffer.from(raw, "base64url").toString("utf8"), threadId };
}

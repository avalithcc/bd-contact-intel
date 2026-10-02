/**
 * Orchestration behind runRfcBackfill, exercised through injected fakes (no
 * database, no Gmail, no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { executeRfcBackfill, type RfcBackfillDeps } from "@/lib/gmail/rfcBackfillCore";
import { parseGmailMessage, type ParsedGmailMessage } from "@/lib/gmail/parseMessage";
import type { BackfillCandidate, BackfillUpdate } from "@/lib/gmail/rfcBackfill";

function parsed(gmailId: string, messageId: string | null): ParsedGmailMessage {
  const headers = messageId ? [{ name: "Message-ID", value: messageId }] : [];
  return parseGmailMessage({ id: gmailId, threadId: "t", internalDate: "1700000000000", payload: { headers } });
}

interface Harness {
  deps: RfcBackfillDeps;
  logs: string[];
  written: { batches: BackfillUpdate[][]; audit: Record<string, unknown> | null };
}

function harness(
  candidates: BackfillCandidate[],
  overrides: Partial<RfcBackfillDeps> = {},
  returnedIds?: (ids: string[]) => string[],
): Harness {
  const logs: string[] = [];
  const written: Harness["written"] = { batches: [], audit: null };
  const deps: RfcBackfillDeps = {
    selectCandidates: async () => candidates,
    loadAccount: async () => ({ connected: true, refreshTokenEncrypted: "enc" }),
    decryptToken: () => "refresh",
    refreshAccessToken: async () => ({ ok: true, accessToken: "access" }),
    openMailbox: () => async (gmailId) => parsed(gmailId, `<${gmailId}@x>`),
    writeUpdates: async (batches, buildAudit) => {
      written.batches = batches;
      const ids = batches.flat().map((u) => u.id);
      const returned = returnedIds ? returnedIds(ids) : ids;
      written.audit = buildAudit(returned);
      return returned;
    },
    logError: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, logs, written };
}

const cand = (id: string, bdId: string): BackfillCandidate => ({ id, bdId, gmailMessageId: `g-${id}` });

test("a decrypt failure skips only that BD, is labelled truthfully and is logged without token material", async () => {
  const candidates = [cand("1", "bad"), cand("2", "good")];
  const h = harness(candidates, {
    loadAccount: async (bdId) => ({ connected: true, refreshTokenEncrypted: `enc-${bdId}` }),
    decryptToken: (enc) => {
      if (enc === "enc-bad") throw new Error("Unsupported state or unable to authenticate data");
      return "refresh-secret";
    },
  });
  const result = await executeRfcBackfill(h.deps, { limit: 10 });
  assert.equal(result.skippedBds, 1);
  assert.deepEqual(result.skipReasons, { no_account: 0, account_lookup_failed: 0, token_decrypt_failed: 1, token_refresh_failed: 0, fetch_failed: 0 });
  assert.equal(result.updated, 1);
  assert.deepEqual(h.written.batches.flat().map((u) => u.id), ["2"]);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], /bd=bad/);
  assert.match(h.logs[0], /stage=token_decrypt_failed/);
  assert.match(h.logs[0], /Error: Unsupported state/);
  assert.doesNotMatch(h.logs.join(" "), /enc-bad|refresh-secret/);
});

test("each stage is labelled with the step that actually failed", async () => {
  const run = async (overrides: Partial<RfcBackfillDeps>) => {
    const h = harness([cand("1", "a")], overrides);
    return executeRfcBackfill(h.deps, { limit: 10 });
  };
  const lookup = await run({ loadAccount: async () => { throw new Error("db down"); } });
  assert.equal(lookup.skipReasons.account_lookup_failed, 1);
  const none = await run({ loadAccount: async () => null });
  assert.equal(none.skipReasons.no_account, 1);
  const disconnected = await run({ loadAccount: async () => ({ connected: false, refreshTokenEncrypted: "e" }) });
  assert.equal(disconnected.skipReasons.no_account, 1);
  const refreshFalse = await run({ refreshAccessToken: async () => ({ ok: false, kind: "revoked" }) });
  assert.equal(refreshFalse.skipReasons.token_refresh_failed, 1);
  const refreshThrows = await run({ refreshAccessToken: async () => { throw new Error("network"); } });
  assert.equal(refreshThrows.skipReasons.token_refresh_failed, 1);
  const fetchThrows = await run({ openMailbox: () => async () => { throw new Error("429"); } });
  assert.equal(fetchThrows.skipReasons.fetch_failed, 1);
});

test("a fetch failure logs the status prefix but never the Gmail response body", async () => {
  const h = harness([cand("1", "a")], {
    openMailbox: () => async () => {
      throw new Error('Gmail messages.get failed: 403 {"error":{"message":"SECRET-BODY"}}');
    },
  });
  await executeRfcBackfill(h.deps, { limit: 10 });
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], /stage=fetch_failed Error: Gmail messages\.get failed: 403$/);
  assert.doesNotMatch(h.logs[0], /SECRET-BODY/);
  const odd = harness([cand("1", "a")], { openMailbox: () => async () => { throw new Error("weird SECRET-BODY"); } });
  await executeRfcBackfill(odd.deps, { limit: 10 });
  assert.doesNotMatch(odd.logs[0], /SECRET-BODY/);
});

test("the audit metadata separates the written count from the planned one", async () => {
  const h = harness([cand("1", "a"), cand("2", "a")], {}, (ids) => ids.slice(0, 1));
  await executeRfcBackfill(h.deps, { limit: 10 });
  const audit = h.written.audit as { updated: number; counts: { update: number } };
  assert.equal(audit.updated, 1);
  assert.equal(audit.counts.update, 2);
});

test("numbers are honest: skipped BD rows are their own figure and the parts sum to the candidates", async () => {
  const candidates = [cand("1", "ok"), cand("2", "ok"), cand("3", "ok"), cand("4", "skipped"), cand("5", "skipped")];
  const h = harness(candidates, {
    loadAccount: async (bdId) => (bdId === "skipped" ? null : { connected: true, refreshTokenEncrypted: "e" }),
    openMailbox: () => async (gmailId) => (gmailId === "g-2" ? null : gmailId === "g-3" ? parsed(gmailId, null) : parsed(gmailId, "<m@x>")),
  });
  const { counts } = await executeRfcBackfill(h.deps, { limit: 10 });
  assert.deepEqual(counts, { candidates: 5, update: 1, notFoundInGmail: 1, noMessageIdHeader: 1, skippedBdRows: 2 });
  assert.equal(counts.update + counts.notFoundInGmail + counts.noMessageIdHeader + counts.skippedBdRows, counts.candidates);
});

test("updated and updatedIds come from the rows the UPDATE returned, not from the plan", async () => {
  const candidates = [cand("1", "a"), cand("2", "a"), cand("3", "a")];
  const h = harness(candidates, {}, (ids) => ids.filter((id) => id !== "2"));
  const result = await executeRfcBackfill(h.deps, { limit: 10 });
  assert.equal(result.updated, 2);
  assert.deepEqual((h.written.audit as { updatedIds: string[] }).updatedIds, ["1", "3"]);
  assert.equal(result.counts.update, 3);
});

test("the audit metadata carries counts, skippedBds, skipReasons and updatedIds", async () => {
  const h = harness([cand("1", "a")]);
  await executeRfcBackfill(h.deps, { limit: 10 });
  assert.deepEqual(Object.keys(h.written.audit!).sort(), ["counts", "skipReasons", "skippedBds", "updated", "updatedIds"]);
});

test("updates beyond 200 are written in batches of at most 200", async () => {
  const candidates = Array.from({ length: 450 }, (_, i) => cand(String(i), "a"));
  const h = harness(candidates);
  const result = await executeRfcBackfill(h.deps, { limit: 500 });
  assert.deepEqual(h.written.batches.map((b) => b.length), [200, 200, 50]);
  assert.equal(result.updated, 450);
});

test("nothing is written when there is nothing to update", async () => {
  let writes = 0;
  const h = harness([cand("1", "a")], {
    openMailbox: () => async () => null,
    writeUpdates: async () => { writes++; return []; },
  });
  const result = await executeRfcBackfill(h.deps, { limit: 10 });
  assert.equal(writes, 0);
  assert.equal(result.updated, 0);
});

test("the candidates are not mutated and two runs over the same input agree", async () => {
  const candidates = [cand("1", "a"), cand("2", "b")];
  const snapshot = JSON.parse(JSON.stringify(candidates));
  const first = await executeRfcBackfill(harness(candidates).deps, { limit: 10 });
  const second = await executeRfcBackfill(harness(candidates).deps, { limit: 10 });
  assert.deepEqual(first, second);
  assert.deepEqual(candidates, snapshot);
});

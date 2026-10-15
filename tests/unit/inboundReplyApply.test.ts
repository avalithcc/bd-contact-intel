import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { classifyGmailMessage, type ClassifiedMessage, type KnownPersonEmail } from "../../src/lib/gmail/classify";
import { parseGmailMessage } from "../../src/lib/gmail/parseMessage";
import { applyReplyVerification, type ReplyTx } from "../../src/lib/gmail/inboundReplyVerificationDb";
import { planInboundReplyBatch } from "../../src/lib/gmail/inboundReplyVerification";
import { assertWithinBackfillCap, BACKFILL_ROW_CAP, planReplyBackfill } from "../../src/lib/gmail/inboundReplyBackfillPlan";
import { executeSyncedMessageWrite, type SyncWriteStore } from "../../src/lib/gmail/syncWriteCore";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const BD_EMAIL = "mariel@avalith.net";

// Fake transaction that EVALUATES the real generated WHERE (rendered with PgDialect) against a
// table, so the status guard and the address guard are exercised, not assumed.
function fakeTx(table: { id: string; emailNormalized: string | null; emailStatus: string }[]) {
  const history: unknown[] = [];
  const dialect = new PgDialect();
  const tx = {
    update: () => ({
      set: (values: { emailStatus: string }) => ({
        where: (cond: SQL) => ({
          returning: async () => {
            const { sql: text, params } = dialect.sqlToQuery(cond);
            assert.match(text, /"email_normalized"/);
            const status = params[params.length - 1];
            const pairs = params.slice(0, -1);
            const hit = table.filter((row) => {
              for (let i = 0; i < pairs.length; i += 2) if (pairs[i] === row.id && pairs[i + 1] === row.emailNormalized) return row.emailStatus === status;
              return false;
            });
            hit.forEach((row) => (row.emailStatus = values.emailStatus));
            return hit.map((row) => ({ id: row.id }));
          },
        }),
      }),
    }),
    insert: () => ({ values: async (rows: unknown[]) => void history.push(...rows) }),
  };
  return { tx: tx as unknown as ReplyTx, history };
}

const promo = (id: string, status: string, address: string) =>
  planInboundReplyBatch([{ person: { id, emailNormalized: address, emailStatus: status, mergedIntoId: null, liveHolders: 1 }, message: { direction: "inbound", fromAddress: address } }]);

test("a person the UPDATE changed gets exactly one history row, one it did not change gets none", async () => {
  const table = [
    { id: P1, emailNormalized: "a@x.com", emailStatus: "probable" },
    { id: P2, emailNormalized: "b@x.com", emailStatus: "verified" }, // verified by someone else after our read
  ];
  const { tx, history } = fakeTx(table);
  const changed = await applyReplyVerification(tx, [...promo(P1, "probable", "a@x.com"), ...promo(P2, "probable", "b@x.com")]);
  assert.deepEqual(changed, [P1]);
  assert.equal(history.length, 1);
  assert.equal((history[0] as { personId: string }).personId, P1);
  assert.equal(table[0]!.emailStatus, "verified");
});

test("an email edited to another address after the read (none -> none) is NOT verified and gets no history", async () => {
  const table = [{ id: P1, emailNormalized: "b@x.com", emailStatus: "none" }]; // replied from a@x.com, edited to b@x.com
  const { tx, history } = fakeTx(table);
  const changed = await applyReplyVerification(tx, promo(P1, "none", "a@x.com"));
  assert.deepEqual(changed, []);
  assert.deepEqual(history, []);
  assert.equal(table[0]!.emailStatus, "none");
});

test("planReplyBackfill promotes only exact replies and never mutates its input", () => {
  const input = Object.freeze([
    Object.freeze({ id: P1, emailNormalized: "a@x.com", emailStatus: "probable", emailSource: "pattern_inferred", replyFrom: "a@x.com", liveHolders: 1 }),
    Object.freeze({ id: P2, emailNormalized: "b@x.com", emailStatus: "none", emailSource: null, replyFrom: "other@x.com", liveHolders: 1 }),
  ]);
  const plan = planReplyBackfill(input);
  assert.deepEqual(plan.map((p) => [p.historyRow.personId, p.historyRow.oldValue, p.historyRow.source, p.historyRow.changedByBdId]), [[P1, "probable", "inbound_reply", null]]);
  assert.deepEqual(planReplyBackfill(input), plan);
});

test("planReplyBackfill refuses shared addresses (generic local part, or held by two live Contacts)", () => {
  const plan = planReplyBackfill([
    { id: P1, emailNormalized: "info@x.com", emailStatus: "probable", emailSource: null, replyFrom: "info@x.com", liveHolders: 1 },
    { id: P2, emailNormalized: "jane@x.com", emailStatus: "probable", emailSource: null, replyFrom: "jane@x.com", liveHolders: 2 },
  ]);
  assert.deepEqual(plan, []);
});

test("the backfill cap: exactly the cap passes, one more refuses", () => {
  assertWithinBackfillCap(new Array(BACKFILL_ROW_CAP).fill(0));
  assert.throws(() => assertWithinBackfillCap(new Array(BACKFILL_ROW_CAP + 1).fill(0)), /candidates/);
});

// ---- sync ordering and gating, with real classifier output ----
function msg(from: string, to: string, gid: string, known: KnownPersonEmail[]): ClassifiedMessage {
  const parsed = parseGmailMessage({
    id: gid, threadId: `t-${gid}`, internalDate: String(Date.UTC(2026, 9, 2)),
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: "s" }], body: { data: Buffer.from("hi").toString("base64url") } },
  });
  return classifyGmailMessage({ message: parsed, bdEmail: BD_EMAIL, knownPersons: known, neverLogRules: [], platformSentGmailMessageIds: new Set() });
}
const KNOWN: KnownPersonEmail[] = [
  { personId: P1, emailNormalized: "a@x.com", confidence: "exact" },
  { personId: P2, emailNormalized: "b@x.com", confidence: "exact" },
];

function logStore(insertNothing = false) {
  const log: string[] = [];
  const verified: unknown[] = [];
  const store: SyncWriteStore = {
    async insertMessages(rows) {
      log.push("insertMessages");
      return insertNothing ? [] : rows.map((r, i) => ({ id: `m-${i}`, gmailMessageId: r.gmailMessageId, gmailThreadId: r.gmailThreadId, direction: r.direction, sentAt: r.sentAt }));
    },
    async fillRfcIds() { return 0; },
    async insertPersonLinks() {},
    async linkPlatformActivity() {},
    async insertActivities() { log.push("insertActivities"); },
    async verifyRepliedAddresses(c) { log.push("verify"); verified.push(...c); },
  };
  return { store, log, verified };
}

test("verifyRepliedAddresses is not called when nothing was inserted (re-sync)", async () => {
  const { store, log } = logStore(true);
  await executeSyncedMessageWrite(store, "bd", [msg("a@x.com", BD_EMAIL, "g1", KNOWN)]);
  assert.ok(!log.includes("verify"));
});

test("verifyRepliedAddresses runs after insertActivities", async () => {
  const { store, log } = logStore();
  await executeSyncedMessageWrite(store, "bd", [msg("a@x.com", BD_EMAIL, "g1", KNOWN)]);
  assert.ok(log.indexOf("verify") > log.indexOf("insertActivities") && log.includes("insertActivities"));
});

test("a mixed inbound/outbound batch hands the store only the inbound sender", async () => {
  const { store, verified } = logStore();
  await executeSyncedMessageWrite(store, "bd", [msg("a@x.com", BD_EMAIL, "g1", KNOWN), msg(BD_EMAIL, "b@x.com", "g2", KNOWN)]);
  assert.deepEqual(verified, [{ personId: P1, fromAddress: "a@x.com" }]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { bounceKey, planBounces, type OutboundCandidate } from "@/lib/gmail/bouncePlan";
import { parseBounce } from "@/lib/gmail/parseBounce";
import { ORIGINAL_ID, ORIGINAL_SUBJECT, dsn, exchangeNdr, failedWith, gmailDelay422, gmailHard511 } from "./bounceFixtures";

const sent = (over: Partial<OutboundCandidate> = {}): OutboundCandidate => ({
  gmailThreadId: "thread-out-1",
  rfcMessageId: ORIGINAL_ID,
  recipients: ["lucia@acme-ejemplo.test"],
  subject: ORIGINAL_SUBJECT,
  ...over,
});
const parsed = (m: ReturnType<typeof gmailHard511>) => parseBounce(m)!;

test("a notification for a message this BD sent to that address becomes an event", () => {
  const plan = planBounces([parsed(gmailHard511())], [sent()], new Set());
  assert.equal(plan.events.length, 1);
  assert.deepEqual(
    { ...plan.events[0], diagnostic: undefined },
    { dsnGmailMessageId: "dsn-1", address: "lucia@acme-ejemplo.test", severity: "hard", statusCode: "5.1.1", reasonKey: "mailbox_not_found", diagnostic: undefined, originalSubject: ORIGINAL_SUBJECT, occurredAt: new Date(1792000000000) },
  );
});

test("a spoofed notification (nothing we sent, or sent to someone else) does nothing", () => {
  assert.deepEqual(planBounces([parsed(gmailHard511())], [], new Set()).events, []);
  const elsewhere = sent({ recipients: ["otra@acme-ejemplo.test"] });
  const plan = planBounces([parsed(gmailHard511())], [elsewhere], new Set());
  assert.equal(plan.events.length, 0);
  assert.equal(plan.unlinked, 1);
});

test("a thread match alone no longer links: our own Message-ID must appear in the notification", () => {
  const byThread = sent({ rfcMessageId: null });
  assert.equal(planBounces([parsed(gmailHard511())], [byThread], new Set()).events.length, 0);
  const otherId = sent({ rfcMessageId: "<someone-elses@mail.gmail.com>" });
  assert.equal(planBounces([parsed(gmailHard511())], [otherId], new Set()).events.length, 0);
  const byRfc = sent({ gmailThreadId: "another-thread" });
  assert.equal(planBounces([parsed(gmailHard511())], [byRfc], new Set()).events.length, 1);
  const neither = sent({ gmailThreadId: "another-thread", rfcMessageId: "<other@x>" });
  assert.equal(planBounces([parsed(gmailHard511())], [neither], new Set()).events.length, 0);
});

test("the address acted on is the one we sent to, even when the notification names the forwarded one", () => {
  const ndr = parsed(exchangeNdr());
  const plan = planBounces([ndr], [sent({ gmailThreadId: "t", recipients: ["jane.doe@contoso-ejemplo.test"] })], new Set());
  assert.equal(plan.events[0]?.address, "jane.doe@contoso-ejemplo.test");
});

test("a notification already recorded is skipped, built from the same key the writer uses", () => {
  const b = parsed(gmailDelay422());
  const key = bounceKey(b.dsnGmailMessageId, "lucia@acme-ejemplo.test");
  const plan = planBounces([b], [sent()], new Set([key]));
  assert.equal(plan.events.length, 0);
  assert.equal(plan.duplicates, 1);
});

test("the planner mutates nothing and gives the same answer twice", () => {
  const bounces = [parsed(gmailHard511()), parsed(gmailDelay422())];
  const outbound = [sent()];
  const seen = new Set<string>();
  const snapshot = JSON.stringify({ bounces, outbound });
  const first = planBounces(bounces, outbound, seen);
  assert.deepEqual(planBounces(bounces, outbound, seen), first);
  assert.equal(JSON.stringify({ bounces, outbound }), snapshot);
  assert.equal(seen.size, 0);
});

test("two notifications for the same address in one run produce one event per notification", () => {
  const second = parseBounce(dsn({ id: "dsn-9", extraHeaders: { "In-Reply-To": ORIGINAL_ID }, parts: gmailHard511().payload!.parts! }))!;
  assert.equal(planBounces([parsed(gmailHard511()), second], [sent()], new Set()).events.length, 2);
});

test("a notification not sent by mailer-daemon or postmaster is ignored, even when it links to our mail", () => {
  const human = parseBounce(failedWith("5.1.1", "no such user", { from: "Lucia <lucia@acme-ejemplo.test>" }))!;
  const plan = planBounces([human], [sent()], new Set());
  assert.equal(plan.events.length, 0);
  assert.equal(plan.unlinked, 1);
  const postmaster = parseBounce(failedWith("5.1.1", "no such user", { from: "Postmaster <PostMaster@otro-dominio.test>" }))!;
  assert.equal(planBounces([postmaster], [sent()], new Set()).events.length, 1);
});

test("a Return-Path with a real address means a person wrote it: only an absent or null path passes", () => {
  const withPath = (value: string) => parseBounce(failedWith("5.1.1", "no such user", { extraHeaders: { "Return-Path": value } }))!;
  assert.equal(planBounces([withPath("<attacker@evil.test>")], [sent()], new Set()).events.length, 0);
  assert.equal(planBounces([withPath("<>")], [sent()], new Set()).events.length, 1);
  for (const path of ["<MAILER-DAEMON>", "<mailer-daemon@mx.example.test>", "<postmaster@contoso-ejemplo.test>", " < > "]) {
    assert.equal(planBounces([withPath(path)], [sent()], new Set()).events.length, 1, path);
  }
  // Counted on its own, not as an unlinked notification.
  const rejected = planBounces([withPath("<attacker@evil.test>")], [sent()], new Set());
  assert.equal(rejected.returnPathRejected, 1);
  assert.equal(rejected.unlinked, 0);
  assert.equal(planBounces([withPath("")], [sent()], new Set()).events.length, 1);
  assert.equal(planBounces([parseBounce(failedWith("5.1.1", "no such user"))!], [sent()], new Set()).events.length, 1);
});

test("a thread match alone is not enough: the notification must also carry a Message-ID reference", () => {
  const noRefs = parseBounce(dsn({ parts: gmailHard511().payload!.parts!.filter((p) => p.mimeType !== "message/rfc822") }))!;
  assert.deepEqual(noRefs.linkRfcIds, []);
  const plan = planBounces([noRefs], [sent()], new Set());
  assert.equal(plan.events.length, 0);
  assert.equal(plan.unlinked, 1);
});

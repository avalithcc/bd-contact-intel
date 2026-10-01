/**
 * Replying on a synced thread (reply-to-thread): the planner that derives
 * recipient / subject / threading headers from stored messages, and the MIME
 * + request body that carry them. A reply that lacks In-Reply-To/References/
 * threadId looks fine in the CRM and starts a NEW thread in the recipient's
 * mailbox, so every header is asserted on the decoded bytes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRawMessage, buildSendPayload } from "@/lib/gmail/rawMessage";
import { composeEmailBody } from "@/lib/signature/compose";
import { GmailSendError } from "@/lib/gmail/errors";
import { planThreadReply, replySubject, replyView, type ReplySourceMessage } from "@/lib/gmail/replyThread";

const FROM = "bd@avalith.net";
const TO = "jane@prospect.com";

/** Decodes `raw` and returns top-level headers with folded lines unfolded. */
function headersOf(raw: string): Record<string, string> {
  const message = Buffer.from(raw, "base64url").toString("utf8");
  const head = message.slice(0, message.indexOf("\r\n\r\n")).replace(/\r\n[ \t]+/g, " ");
  const out: Record<string, string> = {};
  for (const line of head.split("\r\n")) {
    const colon = line.indexOf(":");
    out[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return out;
}

// --- byte-identity for a brand-new email ------------------------------------

test("no reply context: the message and the request body are exactly what they were before", () => {
  // Golden value produced by the pre-feature builder for this input.
  const legacy = buildRawMessage(FROM, TO, "Hello", { body: "x" });
  const withUndefined = buildRawMessage(FROM, TO, "Hello", { body: "x" }, undefined, undefined);
  assert.equal(withUndefined, legacy);
  const decoded = Buffer.from(legacy, "base64url").toString("utf8");
  assert.ok(!/in-reply-to|references/i.test(decoded));
  assert.equal(
    decoded,
    [
      `From: ${FROM}`,
      `To: ${TO}`,
      `Subject: =?UTF-8?B?${Buffer.from("Hello").toString("base64")}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      "eA==",
    ].join("\r\n"),
  );
  assert.equal(buildSendPayload(FROM, TO, "Hello", { body: "x" }), JSON.stringify({ raw: legacy }));
});

// --- a reply carries the threading headers and the threadId -----------------

test("a reply emits In-Reply-To and References and puts threadId in the request body", () => {
  const reply = { threadId: "thr-1", inReplyTo: "<m2@x>", references: "<m1@x> <m2@x>" };
  const payload = JSON.parse(buildSendPayload(FROM, TO, "Re: Hello", { body: "x" }, reply));
  assert.equal(payload.threadId, "thr-1");
  const h = headersOf(payload.raw);
  assert.equal(h["in-reply-to"], "<m2@x>");
  assert.equal(h.references, "<m1@x> <m2@x>");
});

test("a long References chain is folded below the line limit and unfolds to the same value", () => {
  const ids = Array.from({ length: 20 }, (_, i) => `<${"a".repeat(40)}${i}@mail.example.com>`);
  const raw = buildRawMessage(FROM, TO, "S", { body: "x" }, undefined, {
    inReplyTo: ids[19],
    references: ids.join(" "),
  });
  const message = Buffer.from(raw, "base64url").toString("utf8");
  for (const line of message.split("\r\n")) assert.ok(line.length <= 78, `line too long: ${line.length}`);
  assert.equal(headersOf(raw).references, ids.join(" "));
});

test("the signature still composes on a reply (multipart/alternative + threading headers)", () => {
  const content = composeEmailBody("Thanks!", "<b>Cristian</b>");
  const raw = buildRawMessage(FROM, TO, "Re: Hello", content, undefined, { inReplyTo: "<m@x>", references: "<m@x>" });
  const h = headersOf(raw);
  assert.match(h["content-type"], /^multipart\/alternative/);
  assert.equal(h["in-reply-to"], "<m@x>");
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const html = Buffer.from(decoded.split('text/html; charset="UTF-8"')[1].split("\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.ok(html.includes("Thanks!") && html.includes("<b>Cristian</b>"));
});

// --- header injection --------------------------------------------------------

const BAD: [string, string][] = [
  ["CR", "<a@x>\r<b@x>"],
  ["LF", "<a@x>\n<b@x>"],
  ["CRLF", "<a@x>\r\nBcc: evil@x.com"],
  ["NUL", "<a@x>\0<b@x>"],
];
for (const [name, bad] of BAD) {
  for (const field of ["inReplyTo", "references"] as const) {
    test(`header guard: ${name} in ${field} is rejected and nothing is built`, () => {
      const reply = { inReplyTo: "<ok@x>", references: "<ok@x>", [field]: bad };
      let built: string | undefined;
      assert.throws(
        () => {
          built = buildSendPayload(FROM, TO, "S", { body: "x" }, { threadId: "t", ...reply });
        },
        (err: unknown) => err instanceof GmailSendError && err.kind === "invalid_header",
      );
      assert.equal(built, undefined);
    });
  }
}

// --- Re: handling ------------------------------------------------------------

test("replySubject adds one 'Re: ' and never stacks it", () => {
  assert.equal(replySubject("Hello"), "Re: Hello");
  assert.equal(replySubject("Re: Hello"), "Re: Hello");
  assert.equal(replySubject("RE: Hello"), "Re: Hello");
  assert.equal(replySubject("re:re: RE:  Hello"), "Re: Hello");
  assert.equal(replySubject("  Re : Hello "), "Re: Hello");
  assert.equal(replySubject("Reunion Re: plan"), "Re: Reunion Re: plan");
  assert.equal(replySubject(null), "Re:");
  assert.equal(replySubject(""), "Re:");
});

// --- planner -----------------------------------------------------------------

function msg(over: Partial<ReplySourceMessage> & { n: number }): ReplySourceMessage {
  return {
    gmailThreadId: "thr-1",
    direction: "inbound",
    fromAddress: TO,
    toAddresses: [FROM],
    subject: "Hello",
    sentAt: new Date(Date.UTC(2026, 9, over.n)),
    rfcMessageId: `<m${over.n}@x>`,
    rfcReferences: null,
    ...over,
  };
}

test("planThreadReply replies to the latest message: parent id in In-Reply-To, chain oldest-first in References", () => {
  const m1 = msg({ n: 1, direction: "outbound", fromAddress: FROM, toAddresses: [TO] });
  const m2 = msg({ n: 2, rfcReferences: "<m1@x>" });
  const plan = planThreadReply([m2, m1]); // deliberately out of order
  assert.deepEqual(plan, {
    ok: true,
    threadId: "thr-1",
    to: TO,
    subject: "Re: Hello",
    inReplyTo: "<m2@x>",
    references: "<m1@x> <m2@x>",
  });
});

test("planThreadReply: a parent with no References starts the chain at its own id", () => {
  const plan = planThreadReply([msg({ n: 1 })]);
  assert.ok(plan.ok && plan.references === "<m1@x>");
});

test("planThreadReply does not duplicate the parent id when References already ends with it", () => {
  const plan = planThreadReply([msg({ n: 2, rfcReferences: "<m1@x> <m2@x>" })]);
  assert.ok(plan.ok && plan.references === "<m1@x> <m2@x>");
});

test("planThreadReply caps the chain, keeping the root and the newest ids", () => {
  const refs = Array.from({ length: 30 }, (_, i) => `<r${i}@x>`).join(" ");
  const plan = planThreadReply([msg({ n: 1, rfcReferences: refs })]);
  assert.ok(plan.ok);
  const ids = plan.references.split(" ");
  assert.equal(ids.length, 20);
  assert.equal(ids[0], "<r0@x>");
  assert.equal(ids.at(-1), "<m1@x>");
});

test("planThreadReply to an outbound latest message writes to its recipients, not to the BD", () => {
  const plan = planThreadReply([msg({ n: 1, direction: "outbound", fromAddress: FROM, toAddresses: ["a@x.com", "b@x.com"] })]);
  assert.ok(plan.ok && plan.to === "a@x.com, b@x.com");
});

test("planThreadReply refuses honestly when the latest message has no Message-ID (pre-feature rows)", () => {
  assert.deepEqual(planThreadReply([msg({ n: 1 }), msg({ n: 2, rfcMessageId: null })]), { ok: false, reason: "no_message_id" });
});

test("planThreadReply: empty thread, no recipient, and an unsafe stored header are refusals, not throws", () => {
  assert.deepEqual(planThreadReply([]), { ok: false, reason: "empty_thread" });
  assert.deepEqual(planThreadReply([msg({ n: 1, fromAddress: "" })]), { ok: false, reason: "no_recipient" });
  assert.deepEqual(planThreadReply([msg({ n: 1, rfcMessageId: "<a@x>\r\nBcc: e@x" })]), { ok: false, reason: "unsafe_header" });
  assert.deepEqual(planThreadReply([msg({ n: 1, rfcReferences: "<a@x>\0" })]), { ok: false, reason: "unsafe_header" });
});

test("planThreadReply is pure: the same input twice gives the same plan and the input is untouched", () => {
  const input = [msg({ n: 2, rfcReferences: "<m1@x>" }), msg({ n: 1 })];
  const snapshot = JSON.stringify(input);
  const first = planThreadReply(input);
  const second = planThreadReply(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(input[0].rfcMessageId, "<m2@x>"); // not re-sorted in place
});

test("replyView exposes only recipient and subject to the client, never the threading headers", () => {
  const view = replyView(planThreadReply([msg({ n: 1 })]));
  assert.deepEqual(view, { ok: true, to: TO, subject: "Re: Hello" });
  assert.deepEqual(replyView({ ok: false, reason: "no_message_id" }), { ok: false, reason: "no_message_id" });
});

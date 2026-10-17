import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBounce } from "@/lib/gmail/parseBounce";
import { ORIGINAL_ID, ORIGINAL_SUBJECT, exchangeNdr, gmailDelay422, gmailHard511, outOfOffice, postfixTextBody } from "./bounceFixtures";

test("Gmail failure notification: hard, 5.1.1, mailbox not found, linked through In-Reply-To and the embedded original", () => {
  const b = parseBounce(gmailHard511());
  assert.ok(b);
  assert.equal(b.dsnGmailMessageId, "dsn-1");
  assert.equal(b.gmailThreadId, "thread-out-1");
  assert.equal(b.originalSubject, ORIGINAL_SUBJECT);
  assert.deepEqual(b.linkRfcIds, [ORIGINAL_ID]);
  assert.equal(b.recipients.length, 1);
  assert.deepEqual(
    { ...b.recipients[0], diagnostic: undefined },
    { address: "lucia@acme-ejemplo.test", originalAddress: null, severity: "hard", statusCode: "5.1.1", reasonKey: "mailbox_not_found", diagnostic: undefined },
  );
  assert.match(b.recipients[0]!.diagnostic ?? "", /does not exist/);
});

test("Gmail delay notification: soft, 4.2.2, mailbox full", () => {
  const b = parseBounce(gmailDelay422());
  assert.equal(b?.recipients[0]?.severity, "soft");
  assert.equal(b?.recipients[0]?.statusCode, "4.2.2");
  assert.equal(b?.recipients[0]?.reasonKey, "mailbox_full");
});

test("Exchange NDR: RFC 3464 text body, 5.1.10, keeps the original recipient and reads the original headers part", () => {
  const b = parseBounce(exchangeNdr());
  assert.ok(b);
  assert.equal(b.recipients[0]?.address, "jane@contoso-ejemplo.test");
  assert.equal(b.recipients[0]?.originalAddress, "jane.doe@contoso-ejemplo.test");
  assert.equal(b.recipients[0]?.severity, "hard");
  assert.equal(b.recipients[0]?.statusCode, "5.1.10");
  assert.equal(b.recipients[0]?.reasonKey, "mailbox_not_found");
  assert.deepEqual(b.linkRfcIds, [ORIGINAL_ID]);
  assert.equal(b.originalSubject, ORIGINAL_SUBJECT);
});

test("Postfix without a delivery-status part: X-Failed-Recipients plus the SMTP code in the text", () => {
  const b = parseBounce(postfixTextBody());
  assert.ok(b);
  assert.equal(b.recipients.length, 1);
  assert.equal(b.recipients[0]?.address, "bob@viejo-ejemplo.test");
  assert.equal(b.recipients[0]?.severity, "hard");
  assert.equal(b.recipients[0]?.statusCode, "5.1.1");
  assert.deepEqual(b.linkRfcIds, [ORIGINAL_ID]);
});

test("an out-of-office reply is not a bounce", () => {
  assert.equal(parseBounce(outOfOffice()), null);
});

test("a delivery report that says the mail was delivered is not a bounce", () => {
  const m = gmailHard511();
  const status = m.payload!.parts![1]!.parts![1]!;
  status.headers = [
    { name: "Final-Recipient", value: "rfc822; lucia@acme-ejemplo.test" },
    { name: "Action", value: "delivered" },
    { name: "Status", value: "2.0.0" },
  ];
  assert.equal(parseBounce(m), null);
});

test("parsing twice gives the same result and never touches the payload", () => {
  const m = exchangeNdr();
  const before = JSON.stringify(m);
  assert.deepEqual(parseBounce(m), parseBounce(m));
  assert.equal(JSON.stringify(m), before);
});

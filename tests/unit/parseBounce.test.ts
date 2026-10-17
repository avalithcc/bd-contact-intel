import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBounce } from "@/lib/gmail/parseBounce";
import { ORIGINAL_ID, ORIGINAL_SUBJECT, exchangeNdr, failedWith, gmailDelay422, gmailHard511, outOfOffice, postfixTextBody } from "./bounceFixtures";

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

const severityOf = (status: string, diagnostic: string, action = "failed") => parseBounce(failedWith(status, diagnostic, { action }))?.recipients[0]?.severity;

test("only a bad address (5.1.x) or an explicit unknown-user 5.0.0/550 is hard; everything else is soft", () => {
  assert.equal(severityOf("5.1.1", "550 5.1.1 no such user"), "hard");
  assert.equal(severityOf("5.1.2", "550 5.1.2 host not found"), "hard");
  assert.equal(severityOf("5.0.0", "550 User unknown"), "hard");
  assert.equal(severityOf("5.0.0", "550 Message rejected as spam"), "soft");
  assert.equal(severityOf("5.7.1", "550 5.7.1 blocked by policy"), "soft");
  assert.equal(severityOf("5.2.2", "552 5.2.2 mailbox full"), "soft");
  assert.equal(severityOf("5.4.1", "550 5.4.1 recipient address rejected: access denied"), "soft");
  assert.equal(severityOf("4.4.1", "connection timed out"), "soft");
  assert.equal(severityOf("4.2.2", "mailbox full", "delayed"), "soft");
});

test("'does not exist' and 'mailbox unavailable' alone do not make a bounce hard", () => {
  assert.equal(severityOf("5.7.1", "550 5.7.1 relay access denied, host does not exist"), "soft");
  assert.equal(severityOf("5.0.0", "550 5.0.0 relay host does not exist"), "soft");
  assert.equal(severityOf("5.0.0", "550 mailbox unavailable"), "soft");
  assert.equal(severityOf("5.0.0", "550 The email account does not exist"), "hard");
  assert.equal(severityOf("5.0.0", "550 No such user here"), "hard");
});

test("without a Status field the enhanced code is read from the diagnostic, and a 5.7.x there makes it soft", () => {
  assert.equal(severityOf("", "550 5.7.1 blocked by policy; the user does not exist"), "soft");
  assert.equal(parseBounce(failedWith("", "550 5.7.1 blocked by policy"))?.recipients[0]?.statusCode, "5.7.1");
  assert.equal(severityOf("", "550 5.1.1 no such user"), "hard");
});

test("an IP address is never read as a status code", () => {
  const unknown = parseBounce(failedWith("", "host mx [10.2.45.7] said: 550 user unknown"));
  assert.equal(unknown?.recipients[0]?.statusCode, null, "2.45.7 inside 10.2.45.7 is not a status");
  assert.equal(unknown?.recipients[0]?.severity, "hard", "still hard through the user-unknown text");
  const blocked = parseBounce(failedWith("", "relay 172.5.1.10 said: 550 5.7.1 blocked"));
  assert.equal(blocked?.recipients[0]?.statusCode, "5.7.1");
  assert.equal(blocked?.recipients[0]?.severity, "soft");
});

test("the body-text fallback ignores an IP address too", () => {
  const m = postfixTextBody();
  m.payload!.body = { data: Buffer.from("connect to [10.2.45.7]: 550 5.1.1 <bob@viejo-ejemplo.test>: User unknown", "utf8").toString("base64url") };
  assert.equal(parseBounce(m)?.recipients[0]?.statusCode, "5.1.1");
  m.payload!.body = { data: Buffer.from("connect to [10.2.45.7]: 550 <bob@viejo-ejemplo.test>: User unknown", "utf8").toString("base64url") };
  assert.equal(parseBounce(m)?.recipients[0]?.statusCode, null);
});

test("Spanish and Portuguese unknown-user phrases make a bare 550 hard; a missing domain does not", () => {
  for (const phrase of ["550 usuario no existe", "550 el buzón no existe", "550 usuário não existe", "550 caixa postal não existe"]) assert.equal(severityOf("5.0.0", phrase), "hard", phrase);
  assert.equal(severityOf("5.0.0", "550 address rejected: domain does not exist"), "soft");
  assert.equal(severityOf("5.0.0", "550 the recipient's domain does not exist"), "soft");
});

test("only the bad-address 5.1.x codes are hard", () => {
  for (const code of ["5.1.0", "5.1.1", "5.1.2", "5.1.4", "5.1.5", "5.1.6", "5.1.10"]) assert.equal(severityOf(code, "rejected"), "hard", code);
  for (const code of ["5.1.3", "5.1.7", "5.1.8", "5.1.9"]) assert.equal(severityOf(code, "rejected"), "soft", code);
});

test("the Return-Path header is kept so the plan can refuse a notification that has a real envelope sender", () => {
  assert.equal(parseBounce(failedWith("5.1.1", "x", { extraHeaders: { "Return-Path": "<>" } }))?.returnPath, "<>");
  assert.equal(parseBounce(failedWith("5.1.1", "x", { extraHeaders: { "Return-Path": "<evil@x.test>" } }))?.returnPath, "<evil@x.test>");
  assert.equal(parseBounce(failedWith("5.1.1", "x"))?.returnPath, null);
});

test("control characters never reach a stored string, whatever the notification carries", () => {
  const b = parseBounce(failedWith("5.1.1", "550 5.1.1 gone\u0000\u0007 now", { subject: "Hola\u0000 mundo\u001f" }));
  assert.equal(b?.recipients[0]?.diagnostic, "550 5.1.1 gone now");
  assert.equal(b?.originalSubject, "Hola mundo");
});

test("a missing or garbage internalDate still gives a valid date", () => {
  for (const internalDate of ["", "abc", "NaN"]) {
    const at = parseBounce(failedWith("5.1.1", "no such user", { internalDate }))?.occurredAt;
    assert.ok(at && !Number.isNaN(at.getTime()), internalDate);
  }
});

test("the sender address is kept for the plan's sender check", () => {
  assert.equal(parseBounce(gmailHard511())?.fromAddress, "mailer-daemon@googlemail.com");
  assert.equal(parseBounce(failedWith("5.1.1", "x", { from: "Lucia <lucia@acme-ejemplo.test>" }))?.fromAddress, "lucia@acme-ejemplo.test");
});

test("parsing twice gives the same result and never touches the payload", () => {
  const m = exchangeNdr();
  const before = JSON.stringify(m);
  assert.deepEqual(parseBounce(m), parseBounce(m));
  assert.equal(JSON.stringify(m), before);
});

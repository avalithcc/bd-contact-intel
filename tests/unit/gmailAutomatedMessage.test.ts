// One detector answers "is this machine-generated?" for thread attribution and for Sequence replies
// (task 10.3). Every case goes through the REAL parseGmailMessage so the verdict is the one the sync stores.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isAutomatedMessage } from "../../src/lib/gmail/automatedMessage";
import { parseGmailMessage, type GmailApiHeader } from "../../src/lib/gmail/parseMessage";

function parsed(extra: GmailApiHeader[], o: { from?: string; subject?: string; body?: string; mimeType?: string } = {}) {
  return parseGmailMessage({
    id: "m1",
    threadId: "t1",
    internalDate: String(Date.UTC(2026, 9, 10)),
    payload: {
      mimeType: o.mimeType ?? "text/plain",
      headers: [
        { name: "From", value: o.from ?? "Jonathan <jonathan@guess.com>" },
        { name: "To", value: "bd@avalith.net" },
        { name: "Subject", value: o.subject ?? "Re: senior engineers" },
        ...extra,
      ],
      body: { data: Buffer.from(o.body ?? "thanks, interested").toString("base64url") },
    },
  });
}

test("a plain human reply is not automated", () => {
  assert.equal(parsed([]).automated, false);
});

test("Auto-Submitted other than 'no' is automated; 'no' is not", () => {
  assert.equal(parsed([{ name: "Auto-Submitted", value: "auto-replied" }]).automated, true);
  assert.equal(parsed([{ name: "Auto-Submitted", value: "no" }]).automated, false);
});

test("X-Autoreply and X-Autorespond mark a message automated by presence", () => {
  for (const name of ["X-Autoreply", "X-Autorespond"]) {
    assert.equal(parsed([{ name, value: "yes" }]).automated, true, name);
    assert.equal(parsed([{ name: name.toLowerCase(), value: "All" }]).automated, true, `${name} lowercased`);
  }
});

// X-Auto-Response-Suppress is a request from the SENDER: "do not send me automatic replies to THIS message". It says
// nothing about whether this message is itself an autoresponse. Exchange stamps it (value "All") on ordinary mail, so a
// genuine client reply can carry it. Treating it as a marker would hide that reply and a Sequence would then remind
// someone who already answered (tasks.md gate 0.8). Redmine shipped this exact mistake (bug #19558). Do not re-add it;
// Auto-Submitted (RFC 3834) is the standard signal and already catches real autoresponses.
test("a message carrying ONLY X-Auto-Response-Suppress is NOT automated: the header is a request about replies, not a verdict", () => {
  for (const value of ["All", "DR, RN, NRN, OOF, AutoReply", "OOF"]) {
    assert.equal(parsed([{ name: "X-Auto-Response-Suppress", value }]).automated, false, value);
  }
});

test("Precedence auto_reply, bulk and junk are automated; list and absent are not", () => {
  for (const value of ["auto_reply", "bulk", "junk", " Bulk ", "JUNK"]) {
    assert.equal(parsed([{ name: "Precedence", value }]).automated, true, value);
  }
  assert.equal(parsed([{ name: "Precedence", value: "list" }]).automated, false);
});

test("a mailer-daemon or postmaster sender is automated, matched on the address and not on a display name", () => {
  for (const from of ["Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "postmaster@guess.com", "MAILER-DAEMON@guess.com"]) {
    assert.equal(parsed([], { from }).automated, true, from);
  }
  assert.equal(parsed([], { from: "Postmaster Pat <pat@guess.com>" }).automated, false);
  assert.equal(parsed([], { from: "mailer-daemon-fan@guess.com" }).automated, false);
});

test("a subject prefix is the fallback when a client sets no header: 'Out of Office: Re: senior engineers' is automated", () => {
  assert.equal(parsed([], { subject: "Out of Office: Re: senior engineers" }).automated, true);
  assert.equal(parsed([], { subject: "Automatic reply: senior engineers" }).automated, true);
  assert.equal(parsed([], { subject: "Undeliverable: senior engineers" }).automated, true);
  assert.equal(parsed([], { subject: "Auto: senior engineers" }).automated, true);
});

test("'Re: senior engineers' with a vacation body is NOT automated: a human who happens to be away is still a human", () => {
  assert.equal(parsed([], { subject: "Re: senior engineers", body: "I am out of the office until Monday." }).automated, false);
});

test("the prefix must open the subject: a human subject that merely mentions it is not automated", () => {
  assert.equal(parsed([], { subject: "Re: out of office coverage for your team" }).automated, false);
});

test("the existing protocol signals still hold", () => {
  assert.equal(parsed([{ name: "X-Failed-Recipients", value: "gone@guess.com" }]).automated, true);
  assert.equal(parsed([], { mimeType: "multipart/report" }).automated, true);
  assert.equal(isAutomatedMessage(undefined, undefined), false);
});

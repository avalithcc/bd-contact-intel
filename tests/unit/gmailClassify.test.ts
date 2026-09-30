/**
 * Unit tests for the pure Gmail message classifier (email-sync slice 2):
 *  - src/lib/gmail/parseMessage.ts — decodes a Gmail API message resource
 *  - src/lib/gmail/classify.ts — direction, participant extraction,
 *    never-log filtering, and CRM person matching
 * No network, no DB — every input here is a plain object standing in for a
 * Gmail API response or an already-fetched CRM row.
 * Run with: npx tsx --test tests/unit/gmailClassify.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGmailMessage, type GmailApiMessage } from "@/lib/gmail/parseMessage";
import {
  classifyGmailMessage,
  extractEmailAddresses,
  normalizeEmailAddress,
  shouldStoreClassifiedMessage,
  type KnownPersonEmail,
  type NeverLogRule,
} from "@/lib/gmail/classify";

const BD_EMAIL = "cristian@avalith.net";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function fixtureMessage(overrides: Partial<GmailApiMessage> = {}): GmailApiMessage {
  return {
    id: "msg-1",
    threadId: "thread-1",
    internalDate: "1700000000000",
    payload: {
      headers: [
        { name: "From", value: "Jane Prospect <jane@prospect.com>" },
        { name: "To", value: BD_EMAIL },
        { name: "Subject", value: "Re: intro" },
      ],
      mimeType: "text/plain",
      body: { data: b64url("Thanks for reaching out.") },
    },
    ...overrides,
  };
}

// --- parseMessage -------------------------------------------------------

test("parseGmailMessage reads headers and decodes a plain-text body", () => {
  const parsed = parseGmailMessage(fixtureMessage());
  assert.equal(parsed.gmailMessageId, "msg-1");
  assert.equal(parsed.gmailThreadId, "thread-1");
  assert.equal(parsed.from, "Jane Prospect <jane@prospect.com>");
  assert.equal(parsed.to, BD_EMAIL);
  assert.equal(parsed.subject, "Re: intro");
  assert.equal(parsed.bodyText, "Thanks for reaching out.");
  assert.equal(parsed.sentAt.getTime(), 1700000000000);
});

test("parseGmailMessage prefers text/plain when both parts are present, and never returns HTML", () => {
  const parsed = parseGmailMessage(
    fixtureMessage({
      payload: {
        headers: [{ name: "From", value: "jane@prospect.com" }],
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64url("plain body") } },
          { mimeType: "text/html", body: { data: b64url('<p onclick="x()">html body</p><script>evil()</script>') } },
        ],
      },
    }),
  );
  assert.equal(parsed.bodyText, "plain body");
  assert.equal("bodyHtml" in parsed, false);
});

test("parseGmailMessage converts an HTML-only body to plain text (never stores HTML)", () => {
  const parsed = parseGmailMessage(
    fixtureMessage({
      payload: {
        headers: [{ name: "From", value: "jane@prospect.com" }],
        mimeType: "text/html",
        body: { data: b64url('<p onclick="x()">html body</p><script>evil()</script>') },
      },
    }),
  );
  assert.equal(parsed.bodyText, "html body");
  assert.doesNotMatch(parsed.bodyText ?? "", /script|onclick/i);
});

test("parseGmailMessage flags bodyTruncated for an oversized body", () => {
  const big = "a".repeat(300_000);
  const parsed = parseGmailMessage(
    fixtureMessage({
      payload: { headers: [{ name: "From", value: "jane@prospect.com" }], mimeType: "text/plain", body: { data: b64url(big) } },
    }),
  );
  assert.equal(parsed.bodyTruncated, true);
  assert.ok(Buffer.byteLength(parsed.bodyText ?? "", "utf8") <= 256 * 1024);
});

// --- extractEmailAddresses / normalizeEmailAddress ----------------------

test("normalizeEmailAddress lowercases and trims", () => {
  assert.equal(normalizeEmailAddress("  Jane@Prospect.COM  "), "jane@prospect.com");
});

test("extractEmailAddresses handles display-name, bare, and comma-mixed formats", () => {
  assert.deepEqual(extractEmailAddresses("Jane Prospect <jane@prospect.com>"), ["jane@prospect.com"]);
  assert.deepEqual(extractEmailAddresses("jane@prospect.com"), ["jane@prospect.com"]);
  assert.deepEqual(
    extractEmailAddresses('"Doe, John" <john@doe.com>, other@x.com'),
    ["john@doe.com", "other@x.com"],
  );
});

test("extractEmailAddresses returns [] for empty/undefined headers", () => {
  assert.deepEqual(extractEmailAddresses(undefined), []);
  assert.deepEqual(extractEmailAddresses(""), []);
});

// --- classifyGmailMessage -------------------------------------------------

function knownPerson(overrides: Partial<KnownPersonEmail> = {}): KnownPersonEmail {
  return { personId: "person-1", emailNormalized: "jane@prospect.com", confidence: "exact", ...overrides };
}

test("classifies an inbound message from a CRM-known address as a match", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(fixtureMessage()),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: [],
  });
  assert.equal(classified.direction, "inbound");
  assert.deepEqual(classified.matches, [
    { personId: "person-1", matchedEmail: "jane@prospect.com", matchConfidence: "exact" },
  ]);
  assert.equal(shouldStoreClassifiedMessage(classified), true);
});

test("address case differences still match (aliases/case)", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(
      fixtureMessage({
        payload: {
          headers: [
            { name: "From", value: "JANE@Prospect.COM" },
            { name: "To", value: BD_EMAIL },
          ],
        },
      }),
    ),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: [],
  });
  assert.equal(classified.matches[0]?.personId, "person-1");
});

test("a deduced (pattern_inferred) person email is flagged match_confidence 'inferred'", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(fixtureMessage()),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson({ confidence: "inferred" })],
    neverLogRules: [],
  });
  assert.equal(classified.matches[0]?.matchConfidence, "inferred");
});

test("inbound from a non-CRM address with a CRM contact in cc: no match (only the sender can match on inbound)", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(
      fixtureMessage({
        payload: {
          headers: [
            { name: "From", value: "someone-else@example.com" },
            { name: "To", value: BD_EMAIL },
            { name: "Cc", value: "jane@prospect.com" },
          ],
        },
      }),
    ),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: [],
  });
  assert.equal(classified.direction, "inbound");
  assert.deepEqual(classified.matches, []);
  assert.equal(shouldStoreClassifiedMessage(classified), false);
});

test("never-log by exact address suppresses that match", () => {
  const rules: NeverLogRule[] = [{ kind: "address", value: "jane@prospect.com" }];
  const classified = classifyGmailMessage({
    message: parseGmailMessage(fixtureMessage()),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: rules,
  });
  assert.deepEqual(classified.matches, []);
  assert.equal(shouldStoreClassifiedMessage(classified), false);
});

test("never-log by domain suppresses every address at that domain", () => {
  const rules: NeverLogRule[] = [{ kind: "domain", value: "prospect.com" }];
  const classified = classifyGmailMessage({
    message: parseGmailMessage(fixtureMessage()),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: rules,
  });
  assert.deepEqual(classified.matches, []);
});

test("never-log applies to the whole message: a never-logged address anywhere suppresses matches for every other CRM contact on the same message", () => {
  const rules: NeverLogRule[] = [{ kind: "address", value: "jane@prospect.com" }];
  const classified = classifyGmailMessage({
    message: parseGmailMessage(
      fixtureMessage({
        payload: {
          headers: [
            { name: "From", value: "jane@prospect.com" },
            { name: "To", value: BD_EMAIL },
            { name: "Cc", value: "bob@prospect.com" },
          ],
        },
      }),
    ),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson(), knownPerson({ personId: "person-2", emailNormalized: "bob@prospect.com" })],
    neverLogRules: rules,
  });
  assert.deepEqual(classified.matches, []);
  assert.equal(shouldStoreClassifiedMessage(classified), false);
});

test("never-log applies to the whole message: a never-logged domain on a Cc-only participant suppresses a To match too", () => {
  const rules: NeverLogRule[] = [{ kind: "domain", value: "spammy.com" }];
  const classified = classifyGmailMessage({
    message: parseGmailMessage(
      fixtureMessage({
        payload: {
          headers: [
            { name: "From", value: "jane@prospect.com" },
            { name: "To", value: BD_EMAIL },
            { name: "Cc", value: "someone@spammy.com" },
          ],
        },
      }),
    ),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: rules,
  });
  assert.deepEqual(classified.matches, []);
  assert.equal(shouldStoreClassifiedMessage(classified), false);
});

test("inbound from a CRM contact with another CRM contact in cc: only the sender matches", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(
      fixtureMessage({
        payload: {
          headers: [
            { name: "From", value: "jane@prospect.com" },
            { name: "To", value: BD_EMAIL },
            { name: "Cc", value: "bob@prospect.com" },
          ],
        },
      }),
    ),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson(), knownPerson({ personId: "person-2", emailNormalized: "bob@prospect.com" })],
    neverLogRules: [],
  });
  assert.equal(classified.direction, "inbound");
  assert.deepEqual(classified.matches, [
    { personId: "person-1", matchedEmail: "jane@prospect.com", matchConfidence: "exact" },
  ]);
});

test("never-log is scoped to the BD who set it (caller passes only that BD's rules)", () => {
  // A different BD's never-log rule for a different domain never applies —
  // enforced by the caller only ever passing the syncing BD's own rules;
  // the classifier itself has no bdId to check against a rule with, so this
  // documents the contract rather than testing cross-BD isolation directly.
  const rules: NeverLogRule[] = [{ kind: "domain", value: "unrelated.com" }];
  const classified = classifyGmailMessage({
    message: parseGmailMessage(fixtureMessage()),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: rules,
  });
  assert.equal(classified.matches.length, 1);
});

test("self-sent mail (BD emails only themselves) yields no matches and is not stored", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(
      fixtureMessage({
        payload: {
          headers: [
            { name: "From", value: BD_EMAIL },
            { name: "To", value: BD_EMAIL },
          ],
        },
      }),
    ),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson({ emailNormalized: BD_EMAIL })],
    neverLogRules: [],
  });
  assert.equal(classified.direction, "outbound");
  assert.deepEqual(classified.matches, []);
  assert.equal(shouldStoreClassifiedMessage(classified), false);
});

test("outbound message to a CRM contact matches and is direction 'outbound'", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(
      fixtureMessage({
        payload: {
          headers: [
            { name: "From", value: BD_EMAIL },
            { name: "To", value: "jane@prospect.com" },
          ],
        },
      }),
    ),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: [],
  });
  assert.equal(classified.direction, "outbound");
  assert.equal(classified.matches.length, 1);
});

test("platform-sent dedup: a gmailMessageId already sent through the app is flagged isPlatformSent", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(fixtureMessage({ id: "platform-msg-1" })),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: [],
    platformSentGmailMessageIds: new Set(["platform-msg-1"]),
  });
  assert.equal(classified.isPlatformSent, true);
});

test("a message not in the platform-sent set is isPlatformSent: false", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(fixtureMessage()),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson()],
    neverLogRules: [],
    platformSentGmailMessageIds: new Set(["some-other-id"]),
  });
  assert.equal(classified.isPlatformSent, false);
});

test("outbound message matching two different CRM recipients (To + Cc) produces one match per person, deduped (multi-person join kept for outbound)", () => {
  const classified = classifyGmailMessage({
    message: parseGmailMessage(
      fixtureMessage({
        payload: {
          headers: [
            { name: "From", value: BD_EMAIL },
            { name: "To", value: "jane@prospect.com" },
            { name: "Cc", value: "bob@prospect.com" },
          ],
        },
      }),
    ),
    bdEmail: BD_EMAIL,
    knownPersons: [knownPerson(), knownPerson({ personId: "person-2", emailNormalized: "bob@prospect.com" })],
    neverLogRules: [],
  });
  assert.equal(classified.direction, "outbound");
  assert.equal(classified.matches.length, 2);
  assert.deepEqual(
    classified.matches.map((m) => m.personId).sort(),
    ["person-1", "person-2"],
  );
});

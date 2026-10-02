/**
 * Capture of the RFC 5322 `Message-ID` / `References` headers at sync time
 * (reply-to-thread). The Gmail API id is NOT the RFC Message-ID; an
 * `In-Reply-To` header needs the latter, so it is stored per message.
 * No network, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGmailMessage, type GmailApiMessage } from "@/lib/gmail/parseMessage";
import { classifyGmailMessage } from "@/lib/gmail/classify";

const BD_EMAIL = "cristian@avalith.net";

function message(extraHeaders: { name: string; value: string }[]): GmailApiMessage {
  return {
    id: "msg-1",
    threadId: "thread-1",
    internalDate: "1700000000000",
    payload: {
      mimeType: "text/plain",
      body: { data: Buffer.from("x", "utf8").toString("base64url") },
      headers: [
        { name: "From", value: "jane@prospect.com" },
        { name: "To", value: BD_EMAIL },
        { name: "Subject", value: "intro" },
        ...extraHeaders,
      ],
    },
  };
}

test("parseGmailMessage captures Message-ID and References, case-insensitively and trimmed", () => {
  const parsed = parseGmailMessage(
    message([
      { name: "Message-Id", value: "  <CA+abc@mail.gmail.com> " },
      { name: "REFERENCES", value: "<a@x> <b@x>" },
    ]),
  );
  assert.equal(parsed.rfcMessageId, "<CA+abc@mail.gmail.com>");
  assert.equal(parsed.references, "<a@x> <b@x>");
});

test("parseGmailMessage yields null (not '') when Message-ID / References are absent", () => {
  const parsed = parseGmailMessage(message([]));
  assert.equal(parsed.rfcMessageId, null);
  assert.equal(parsed.references, null);
});

test("classifyGmailMessage carries rfcMessageId and references through", () => {
  const parsed = parseGmailMessage(
    message([
      { name: "Message-ID", value: "<m2@x>" },
      { name: "References", value: "<m1@x>" },
    ]),
  );
  const classified = classifyGmailMessage({ message: parsed, bdEmail: BD_EMAIL, knownPersons: [], neverLogRules: [] });
  assert.equal(classified.rfcMessageId, "<m2@x>");
  assert.equal(classified.references, "<m1@x>");
});

/**
 * Read-back of the RFC Message-ID after a send (instant-sent-mail). It must
 * never fail the send: every failure mode resolves to null. A fake fetch
 * stands in for Google; no network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSentMessageMetadata } from "@/lib/gmail/sentMessageMetadata";

function okFetch(body: unknown, capture?: { url?: string }): typeof fetch {
  return (async (url: string | URL | Request) => {
    if (capture) capture.url = String(url);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

test("reads Message-ID, References and internalDate with one metadata get", async () => {
  const capture: { url?: string } = {};
  const result = await fetchSentMessageMetadata(
    "token",
    "gm-1",
    okFetch(
      {
        id: "gm-1",
        threadId: "gt-1",
        internalDate: "1790000000000",
        payload: { headers: [{ name: "Message-Id", value: " <abc@mail.gmail.com> " }, { name: "References", value: "<r@x>" }] },
      },
      capture,
    ),
  );
  assert.deepEqual(result, { rfcMessageId: "<abc@mail.gmail.com>", references: "<r@x>", sentAt: new Date(1790000000000) });
  assert.match(capture.url!, /\/messages\/gm-1\?/);
  assert.match(capture.url!, /format=metadata/);
  assert.match(capture.url!, /metadataHeaders=Message-ID/);
});

test("a non-ok response resolves to null instead of throwing", async () => {
  const f = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  assert.equal(await fetchSentMessageMetadata("t", "gm-1", f), null);
});

test("a network error resolves to null instead of throwing", async () => {
  const f = (async () => {
    throw new Error("socket hang up");
  }) as typeof fetch;
  assert.equal(await fetchSentMessageMetadata("t", "gm-1", f), null);
});

test("a payload without a Message-ID still returns the sentAt, with null rfc fields", async () => {
  const result = await fetchSentMessageMetadata("t", "gm-1", okFetch({ id: "gm-1", threadId: "gt-1", internalDate: "1790000000000", payload: { headers: [] } }));
  assert.deepEqual(result, { rfcMessageId: null, references: null, sentAt: new Date(1790000000000) });
});

test("an unparseable internalDate resolves to null sentAt-less metadata (null overall)", async () => {
  const result = await fetchSentMessageMetadata("t", "gm-1", okFetch({ id: "gm-1", threadId: "gt-1", payload: { headers: [] } }));
  assert.equal(result, null);
});

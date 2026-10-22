import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { buildReleaseMessage, type ReleaseMessageFacts } from "@/lib/sequences/releaseMessage";
import { buildUnsubscribeUrl, generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

const URL_OK = buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken());
const footed = appendFooter("Hello", COMPLIANCE_CONFIG, "miami", URL_OK);
const body = footed.status === "ok" ? footed.body : "";

const facts = (over: Partial<ReleaseMessageFacts> = {}): ReleaseMessageFacts => ({
  id: "m-1", sequenceId: "s-1", personId: "p-1", step: 1, email: " jane@acme.test ", subject: "Hi", body,
  accountEmail: "sender@mailbox.test", step1RfcMessageId: null, step1ThreadId: null, signatureHtml: null, ...over,
});

test("step 1: plain message to the trimmed address, List-Unsubscribe from the body's own link, no threading", () => {
  const m = buildReleaseMessage(facts());
  assert.equal(m.to, "jane@acme.test");
  assert.equal(m.reply, undefined);
  assert.deepEqual(m.extraHeaders, [
    `List-Unsubscribe: <${URL_OK}>, <mailto:sender@mailbox.test?subject=unsubscribe>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
  ]);
  assert.deepEqual(m.activityMetadata, { sequenceId: "s-1", sequenceMemberId: "m-1", step: 1 });
  assert.equal(m.personId, "p-1");
});

test("step 2 threads on the stored step 1 Message-ID and Gmail thread", () => {
  const m = buildReleaseMessage(facts({ step: 2, step1RfcMessageId: "<abc@mail.test>", step1ThreadId: "t-9" }));
  assert.deepEqual(m.reply, { inReplyTo: "<abc@mail.test>", references: "<abc@mail.test>", threadId: "t-9" });
  assert.equal(m.activityMetadata.step, 2);
});

test("it refuses to build an unthreaded reminder or a message with no unsubscribe link", () => {
  assert.throws(() => buildReleaseMessage(facts({ step: 2 })), /thread/i);
  assert.throws(() => buildReleaseMessage(facts({ body: "no link" })), /unsubscribe/i);
});

import { splitFooter } from "@/lib/sequences/complianceFooter";
import { sanitizeSignatureHtml } from "@/lib/signature/sanitize";
import { plainTextPart } from "@/lib/gmail/rawMessage";
import { composeEmailBody } from "@/lib/signature/compose";

const SIGNATURE = '<table><tr><td><b>Jane Doe</b><br>BD Lead<br><a href="https://avalith.net">avalith.net</a></td></tr></table>';
const bodyFor = (address: "mdp" | "miami", text = "Hello Jane,\n\nShort <note> & more.") => {
  const r = appendFooter(text, COMPLIANCE_CONFIG, address, URL_OK);
  assert.equal(r.status, "ok");
  return r.status === "ok" ? r.body : "";
};
const html = (m: { body?: string; bodyHtml?: string }) => {
  assert.equal(m.body, undefined, "an HTML message carries no plain body field");
  assert.ok(m.bodyHtml);
  return m.bodyHtml!;
};

test("signature present: order is message, signature, footer, and the unsubscribe URL is a real anchor", () => {
  for (const address of ["mdp", "miami"] as const) {
    const stored = bodyFor(address);
    const h = html(buildReleaseMessage(facts({ body: stored, signatureHtml: SIGNATURE })));
    const sig = sanitizeSignatureHtml(SIGNATURE);
    const iMessage = h.indexOf("Short &lt;note&gt; &amp; more.");
    const iSig = h.indexOf(sig);
    const iAddr = h.indexOf(COMPLIANCE_CONFIG[address]!.postalAddress);
    const iOptOut = h.indexOf("use the link below");
    const iLink = h.indexOf(`<a href="${URL_OK}"`);
    assert.ok(iMessage >= 0 && iSig > iMessage && iAddr > iSig && iOptOut > iAddr, `${address}: ${h}`);
    assert.ok(iLink > iOptOut, "the link is last");
    assert.ok(h.includes(`<a href="${URL_OK}">${URL_OK}</a>`), "href equals the stored URL exactly");
    assert.equal(h.split(`href="${URL_OK}"`).length - 1, 1);
    assert.ok(!h.includes("<note>"), "message text stays escaped");
  }
});

test("the plain-text alternative keeps the order, the dashes line and the raw URL", () => {
  const m = buildReleaseMessage(facts({ body: bodyFor("miami"), signatureHtml: SIGNATURE }));
  const text = plainTextPart(m);
  assert.ok(text.indexOf("Jane Doe") > text.indexOf("Short <note>"));
  assert.ok(text.indexOf("\r\n--\r\nAvalith Corporation") > text.indexOf("Jane Doe"));
  assert.ok(text.trimEnd().endsWith(URL_OK));
});

test("List-Unsubscribe still comes from the stored plain body and names the SAME token as the footer anchor", () => {
  const m = buildReleaseMessage(facts({ body: bodyFor("mdp"), signatureHtml: SIGNATURE }));
  const anchor = [...html(m).matchAll(/<a href="([^"]+)">/g)].map((x) => x[1]).filter((u) => u.includes("/api/unsubscribe"))[0];
  assert.equal(anchor, URL_OK);
  assert.equal(m.extraHeaders[0], `List-Unsubscribe: <${anchor}>, <mailto:sender@mailbox.test?subject=unsubscribe>`);
  assert.throws(() => buildReleaseMessage(facts({ body: "no link", signatureHtml: SIGNATURE })), /unsubscribe/i);
});

test("no signature (null, blank, or one that sanitizes to nothing): byte-identical to the stored plain body", () => {
  const stored = bodyFor("miami");
  for (const signatureHtml of [null, "", "   ", "<script>alert(1)</script>"]) {
    const m = buildReleaseMessage(facts({ body: stored, signatureHtml }));
    assert.equal(m.body, stored);
    assert.equal("bodyHtml" in m, false);
  }
});

test("footer absent: signature goes at the very end and the text is otherwise untouched", () => {
  const stored = `Hello Jane,\nLink: ${URL_OK}\nBye`;
  const h = html(buildReleaseMessage(facts({ body: stored, signatureHtml: SIGNATURE })));
  assert.ok(h.startsWith(`<div>Hello Jane,<br>Link: <a href="${URL_OK}">${URL_OK}</a><br>Bye</div>`));
  assert.ok(h.endsWith(`<div>${sanitizeSignatureHtml(SIGNATURE)}</div>`));
});

test("a `--` line inside the message does not split it: the signature still lands above the real footer", () => {
  const stored = bodyFor("mdp", "First part\n--\nSecond part");
  const h = html(buildReleaseMessage(facts({ body: stored, signatureHtml: SIGNATURE })));
  const sig = h.indexOf(sanitizeSignatureHtml(SIGNATURE));
  assert.ok(h.indexOf("Second part") < sig && sig < h.indexOf("Formosa 2531"));
  assert.ok(h.indexOf("First part<br>--<br>Second part") >= 0);
});

test("the planner path is pure: building twice from the same facts gives the same message and leaves the facts alone", () => {
  const f = facts({ body: bodyFor("miami"), signatureHtml: SIGNATURE });
  const snapshot = JSON.stringify(f);
  assert.deepEqual(buildReleaseMessage(f), buildReleaseMessage(f));
  assert.equal(JSON.stringify(f), snapshot);
  assert.ok(splitFooter(f.body, COMPLIANCE_CONFIG));
});

test("composeEmailBody (scheduled and one-off email) is unchanged in both shapes", () => {
  assert.deepEqual(composeEmailBody("a < b\nline", null), { body: "a < b\nline" });
  assert.deepEqual(composeEmailBody("a < b\nline", SIGNATURE), {
    bodyHtml: `<div>a &lt; b<br>line</div><br><div>${sanitizeSignatureHtml(SIGNATURE)}</div>`,
  });
});

test("two different tokens in one body: header, anchor and the real footer's token are the SAME one, and the stale one is not a link", () => {
  const STALE = buildUnsubscribeUrl("https://crm.example.test", generateUnsubscribeToken());
  assert.notEqual(STALE, URL_OK);
  const stored = bodyFor("miami", `Hello,\nold footer pasted by mistake: ${STALE}\nBye`);
  assert.ok(stored.indexOf(STALE) < stored.indexOf(URL_OK), "the stale link comes FIRST, the case the first-match extraction got wrong");
  for (const signatureHtml of [SIGNATURE, null]) {
    const m = buildReleaseMessage(facts({ body: stored, signatureHtml }));
    assert.equal(m.extraHeaders[0], `List-Unsubscribe: <${URL_OK}>, <mailto:sender@mailbox.test?subject=unsubscribe>`);
    if (signatureHtml === null) continue;
    const anchors = [...html(m).matchAll(/<a href="([^"]+)">/g)].map((x) => x[1]).filter((u) => u.includes("/api/unsubscribe"));
    assert.deepEqual(anchors, [URL_OK]);
    assert.ok(html(m).includes(STALE), "the stale text is kept, never rewritten");
  }
});

test("a hand-edited footer marker still splits, so the signature stays ABOVE the footer", () => {
  const addr = COMPLIANCE_CONFIG.miami!.postalAddress;
  const tail = `${addr}\n\n${COMPLIANCE_CONFIG.miami!.optOutText}\n${URL_OK}`;
  for (const marker of ["-- \n", "--\n\n", "---\n", "--\r\n"]) {
    const stored = `Hello Jane,\n\nShort note.\n\n${marker}${tail}`;
    assert.ok(splitFooter(stored, COMPLIANCE_CONFIG), JSON.stringify(marker));
    const h = html(buildReleaseMessage(facts({ body: stored, signatureHtml: SIGNATURE })));
    const sig = h.indexOf(sanitizeSignatureHtml(SIGNATURE));
    assert.ok(h.indexOf("Short note.") < sig && sig < h.indexOf(addr) && sig < h.indexOf(`<a href="${URL_OK}"`), JSON.stringify(marker));
  }
  assert.equal(splitFooter("Hi\n--\nJane\nSome Street 1", COMPLIANCE_CONFIG), null, "a bare dashes line without the address still never splits");
});

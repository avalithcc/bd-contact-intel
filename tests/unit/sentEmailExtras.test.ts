import assert from "node:assert/strict";
import { test } from "node:test";
import { emailRecipientText, readSentEmailExtras } from "@/lib/contacts/timelineEntryBody";

test("an older email_sent activity has no extras", () => {
  assert.deepEqual(readSentEmailExtras({ to: "a@x.test", subject: "Hola" }), { recipients: [], cc: [], attachments: [] });
  assert.deepEqual(readSentEmailExtras(null), { recipients: [], cc: [], attachments: [] });
});

test("a composed email exposes who it went to, the Cc and the files (name and size only)", () => {
  const extras = readSentEmailExtras({
    to: ["a@x.test", "b@x.test"],
    recipients: [{ personId: "p1", name: "A", email: "a@x.test" }, { personId: "p2", name: "B", email: "b@x.test" }],
    cc: ["ana@avalith.net"],
    attachments: [{ filename: "Propuesta.pdf", size: 2_600_000 }],
  });
  assert.deepEqual(extras.recipients, [{ name: "A", email: "a@x.test" }, { name: "B", email: "b@x.test" }]);
  assert.deepEqual(extras.cc, ["ana@avalith.net"]);
  assert.deepEqual(extras.attachments, [{ filename: "Propuesta.pdf", size: 2_600_000 }]);
});

test("junk in the metadata is ignored, never rendered", () => {
  const extras = readSentEmailExtras({ recipients: [null, 5, { name: 1 }], cc: [1, "", "ok@avalith.net"], attachments: [{ size: 3 }, "x", { filename: "a.pdf" }] });
  assert.deepEqual(extras, { recipients: [], cc: ["ok@avalith.net"], attachments: [{ filename: "a.pdf", size: 0 }] });
});

test("the address list of a multi-recipient send reads as one comma-separated text", () => {
  assert.equal(emailRecipientText({ to: ["a@x.test", "b@x.test"] }), "a@x.test, b@x.test");
});

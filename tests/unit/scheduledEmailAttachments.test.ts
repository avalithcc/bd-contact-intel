/**
 * What the scheduled-send cron does with the files of a due row: read them back (service role, no session) and FAIL CLOSED.
 * Storage is a fake; nothing touches the network or a database.
 */
process.env.DATABASE_URL ??= "postgres://unit:unit@127.0.0.1:1/unit";

import assert from "node:assert/strict";
import { test } from "node:test";
import { GmailSendError } from "@/lib/gmail/errors";
import { buildAttachmentPath } from "@/lib/email/attachments/storagePath";
import type { AttachmentStorage } from "@/lib/email/attachments/storage";
import { failureCode } from "@/lib/scheduledEmail/dispatch";
import { stateOf } from "@/lib/scheduledEmail/view";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const UP = "33333333-3333-4333-8333-333333333333";
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2]);

function attachment(name: string, over: Record<string, unknown> = {}) {
  return { id: `a-${name}`, bdId: "bd-1", ownerAuthUid: OWNER, storagePath: buildAttachmentPath(OWNER, UP, name), filename: name, contentType: "application/pdf", sizeBytes: 7, scheduledEmailId: "s-1", ...over };
}
const rowWith = (attachments: ReturnType<typeof attachment>[]) => ({ id: "s-1", bdId: "bd-1", attachments }) as never;
const storage = (objects: Record<string, Uint8Array>): AttachmentStorage => ({ download: async (p) => objects[p] ?? null, remove: async () => true });

async function load(row: never, st: AttachmentStorage | null) {
  const { loadRowAttachments } = await import("@/lib/scheduledEmail/send");
  return loadRowAttachments(row, st);
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return failureCode(e);
  }
  return "no error";
}

test("no files: nothing is read, no storage needed", async () => {
  assert.deepEqual(await load(rowWith([]), null), []);
});

test("the files are read back with their real bytes", async () => {
  const a = attachment("a.pdf");
  const out = await load(rowWith([a]), storage({ [a.storagePath]: pdf }));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.filename, "a.pdf");
  assert.equal(out[0]!.size, 7);
});

test("no service-role storage: the row fails closed with attachments_unavailable", async () => {
  assert.equal(await codeOf(load(rowWith([attachment("a.pdf")]), null)), "attachments_unavailable");
});

test("a file of another BD, or with a mismatching owner folder, fails closed", async () => {
  const foreignBd = attachment("a.pdf", { bdId: "bd-2" });
  assert.equal(await codeOf(load(rowWith([foreignBd]), storage({ [foreignBd.storagePath]: pdf }))), "attachment_failed");
  // Row says it belongs to OWNER, but the object sits in someone else's folder.
  const tampered = attachment("b.pdf", { storagePath: buildAttachmentPath(OTHER, UP, "b.pdf") });
  assert.equal(await codeOf(load(rowWith([tampered]), storage({ [tampered.storagePath]: pdf }))), "attachment_failed");
  // Two different owners on one row.
  const mixed = [attachment("c.pdf"), attachment("d.pdf", { ownerAuthUid: OTHER, storagePath: buildAttachmentPath(OTHER, UP, "d.pdf") })];
  assert.equal(await codeOf(load(rowWith(mixed), storage({ [mixed[0]!.storagePath]: pdf, [mixed[1]!.storagePath]: pdf }))), "attachment_failed");
});

test("a missing object, or bytes that are not the declared type, fails closed", async () => {
  const gone = attachment("a.pdf");
  assert.equal(await codeOf(load(rowWith([gone]), storage({}))), "attachment_failed");
  const fake = attachment("b.pdf");
  assert.equal(await codeOf(load(rowWith([fake]), storage({ [fake.storagePath]: new Uint8Array([0x4d, 0x5a, 0, 0]) }))), "attachment_failed");
});

test("the attachment codes mean 'provably not sent' and show as a plain failure, not as unconfirmed", () => {
  for (const error of ["attachments_unavailable", "attachment_failed"]) {
    assert.equal(stateOf({ status: "failed", sendAt: new Date(), error }, new Date()), "failed_other");
  }
  assert.equal(failureCode(new GmailSendError("send_failed", "attachment_failed", undefined, 503)), "outcome_unknown", "only status 400 is trusted as 'not sent'");
});

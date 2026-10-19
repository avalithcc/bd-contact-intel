import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlainCompose, prepareCompose } from "@/lib/email/compose/prepare";
import { evaluatePara, type ParaPerson } from "@/lib/email/recipients/para";
import { buildAttachmentPath } from "@/lib/email/attachments/storagePath";
import type { AttachmentStorage } from "@/lib/email/attachments/storage";

const UID = "11111111-1111-4111-8111-111111111111";
const UP = "33333333-3333-4333-8333-333333333333";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const person = (id: string, key: string | null = "acme"): ParaPerson => ({ id, firstName: id.slice(0, 1), lastName: "X", email: `${id.slice(0, 1)}@acme.test`, emailNormalized: `${id.slice(0, 1)}@acme.test`, canonicalCompanyKey: key });
const resolvePara = (people: Record<string, ParaPerson>) => async (primary: string, others: string[]) => evaluatePara(people[primary], others.map((id) => people[id]));

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const refFor = (name: string) => ({ storagePath: buildAttachmentPath(UID, UP, name), filename: name, contentType: "application/pdf", size: 8 });
const storageWith = (objects: Record<string, Uint8Array>): AttachmentStorage => ({ download: async (p) => objects[p] ?? null, remove: async () => true });

test("plain compose: nothing beyond one recipient and text", () => {
  assert.equal(isPlainCompose(undefined), true);
  assert.equal(isPlainCompose({}), true);
  assert.equal(isPlainCompose({ recipientPersonIds: [], ccAddresses: [], attachments: [] }), true);
  assert.equal(isPlainCompose({ ccAddresses: ["a@avalith.net"] }), false);
  assert.equal(isPlainCompose({ recipientPersonIds: [B] }), false);
});

test("a full extras set resolves Para, Cc and files in one pass", async () => {
  const r = refFor("a.pdf");
  const out = await prepareCompose({
    personId: A,
    extras: { recipientPersonIds: [B], ccAddresses: ["Ana@Avalith.net"], attachments: [r] },
    ownerAuthUid: UID,
    resolvePara: resolvePara({ [A]: person(A), [B]: person(B) }),
    storage: storageWith({ [r.storagePath]: pdf }),
    load: true,
  });
  assert.ok(out.ok);
  assert.equal(out.to, "a@acme.test, b@acme.test");
  assert.deepEqual(out.otherPersonIds, [B]);
  assert.deepEqual(out.cc, ["ana@avalith.net"]);
  assert.equal(out.files.length, 1);
  assert.equal(out.validated[0]!.filename, "a.pdf");
});

test("with load off the descriptors are checked but Storage is never touched", async () => {
  const r = refFor("a.pdf");
  let touched = false;
  const out = await prepareCompose({
    personId: A,
    extras: { attachments: [r] },
    ownerAuthUid: UID,
    resolvePara: resolvePara({ [A]: person(A) }),
    storage: { download: async () => ((touched = true), null), remove: async () => true },
    load: false,
  });
  assert.ok(out.ok);
  assert.equal(touched, false);
  assert.equal(out.files.length, 0);
});

test("each refusal comes back as its own reason", async () => {
  const base = { personId: A, ownerAuthUid: UID, resolvePara: resolvePara({ [A]: person(A), [B]: person(B, "other") }), storage: storageWith({}), load: true };
  assert.deepEqual(await prepareCompose({ ...base, extras: { recipientPersonIds: [B] } }), { ok: false, reason: "recipient_other_company" });
  assert.deepEqual(await prepareCompose({ ...base, extras: { recipientPersonIds: ["not-a-uuid"] } }), { ok: false, reason: "recipient_unavailable" });
  assert.deepEqual(await prepareCompose({ ...base, extras: { ccAddresses: ["x@gmail.com"] } }), { ok: false, reason: "cc_not_internal" });
  assert.deepEqual(await prepareCompose({ ...base, extras: { ccAddresses: [5 as never] } }), { ok: false, reason: "cc_invalid" });
  assert.deepEqual(await prepareCompose({ ...base, extras: { attachments: [refFor("a.exe")] } }), { ok: false, reason: "attachment_type_not_allowed" });
  assert.deepEqual(await prepareCompose({ ...base, extras: { attachments: [refFor("a.pdf")] } }), { ok: false, reason: "attachment_missing" });
  assert.deepEqual(await prepareCompose({ ...base, extras: { attachments: "nope" as never } }), { ok: false, reason: "attachment_invalid" });
});

test("a Cc already in Para is dropped, not an error", async () => {
  const out = await prepareCompose({
    personId: A,
    extras: { ccAddresses: ["a@avalith.net"] },
    ownerAuthUid: UID,
    resolvePara: resolvePara({ [A]: { ...person(A), email: "a@avalith.net", emailNormalized: "a@avalith.net" } }),
    storage: null,
    load: true,
  });
  assert.ok(out.ok);
  assert.deepEqual(out.cc, []);
});

test("an absurd number of ids is refused before any lookup", async () => {
  let looked = false;
  const out = await prepareCompose({
    personId: A,
    extras: { recipientPersonIds: Array.from({ length: 60 }, () => B) },
    ownerAuthUid: UID,
    resolvePara: async () => ((looked = true), { ok: false, reason: "recipient_unavailable" }),
    storage: null,
    load: true,
  });
  assert.deepEqual(out, { ok: false, reason: "recipient_unavailable" });
  assert.equal(looked, false);
});

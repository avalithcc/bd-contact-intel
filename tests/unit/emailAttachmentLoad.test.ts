import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAttachments, validateAttachmentRefs, type AttachmentRef } from "@/lib/email/attachments/load";
import type { AttachmentStorage } from "@/lib/email/attachments/storage";
import { buildAttachmentPath, pathBelongsTo, pathOwner } from "@/lib/email/attachments/storagePath";

const UID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const UP = "33333333-3333-4333-8333-333333333333";
const MB = 1024 * 1024;

const ref = (name: string, over: Partial<AttachmentRef> = {}): AttachmentRef => ({
  storagePath: buildAttachmentPath(UID, UP, name),
  filename: name,
  contentType: "application/pdf",
  size: 100,
  ...over,
});

function fakeStorage(objects: Record<string, Uint8Array | null>): AttachmentStorage & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    async download(path) {
      return objects[path] ?? null;
    },
    async list() {
      return null;
    },
    async remove(paths) {
      removed.push(...paths);
      return true;
    },
  };
}

test("path helpers: owner is the first folder; a tampered or foreign path never matches", () => {
  const p = buildAttachmentPath(UID, UP, "a.pdf");
  assert.equal(pathOwner(p), UID);
  assert.equal(pathBelongsTo(p, UID), true);
  assert.equal(pathBelongsTo(p, OTHER), false);
  for (const bad of [`${UID}/${UP}/../x.pdf`, `${UID}/${UP}/..`, `${UID}/x.pdf`, `${UID}/${UP}/a/b.pdf`, `/${UID}/${UP}/a.pdf`, `${UID}/${UP}/a b.pdf`, ""]) {
    assert.equal(pathBelongsTo(bad, UID), false, bad);
  }
});

test("validate: a clean set passes and canonicalises the content type from the extension", () => {
  const r = validateAttachmentRefs([ref("a.pdf", { contentType: "" })], UID);
  assert.equal(r.ok && r.items[0]!.contentType, "application/pdf");
});

test("validate: someone else's folder is invalid", () => {
  const foreign = ref("a.pdf", { storagePath: buildAttachmentPath(OTHER, UP, "a.pdf") });
  assert.deepEqual(validateAttachmentRefs([foreign], UID), { ok: false, reason: "attachment_invalid" });
});

test("validate: blocked type, oversize, too many, over total, duplicates, garbage", () => {
  assert.deepEqual(validateAttachmentRefs([ref("a.exe", { contentType: "application/x-msdownload" })], UID), { ok: false, reason: "attachment_type_not_allowed" });
  assert.deepEqual(validateAttachmentRefs([ref("a.pdf", { size: 6 * MB + 1 })], UID), { ok: false, reason: "attachment_too_large" });
  const six = Array.from({ length: 6 }, (_, i) => ref(`f${i}.pdf`, { storagePath: buildAttachmentPath(UID, UP, `f${i}.pdf`) }));
  assert.deepEqual(validateAttachmentRefs(six, UID), { ok: false, reason: "attachment_too_many" });
  const big = [ref("a.pdf", { size: 5 * MB }), ref("b.pdf", { size: 5 * MB }), ref("c.pdf", { size: 1 * MB })];
  assert.deepEqual(validateAttachmentRefs(big, UID), { ok: false, reason: "attachment_total_too_large" });
  assert.deepEqual(validateAttachmentRefs([ref("a.pdf"), ref("a.pdf")], UID), { ok: false, reason: "attachment_invalid" });
  assert.deepEqual(validateAttachmentRefs([null as never], UID), { ok: false, reason: "attachment_invalid" });
  assert.deepEqual(validateAttachmentRefs([{ storagePath: 5 } as never], UID), { ok: false, reason: "attachment_invalid" });
});

test("validate: no attachments is fine", () => {
  assert.deepEqual(validateAttachmentRefs([], UID), { ok: true, items: [] });
});

const pdfBytes = (n = 20) => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(n).fill(65)]);

test("load: downloads, sniffs and returns MIME-ready files with their REAL size", async () => {
  const r = ref("a.pdf", { size: 5 });
  const v = validateAttachmentRefs([r], UID);
  assert.ok(v.ok);
  const out = await loadAttachments(v.items, fakeStorage({ [r.storagePath]: pdfBytes() }));
  assert.equal(out.ok && out.files[0]!.filename, "a.pdf");
  assert.equal(out.ok && out.files[0]!.data.length, 25);
  assert.equal(out.ok && out.files[0]!.size, 25);
  assert.equal(out.ok && out.files[0]!.contentType, "application/pdf");
});

test("load: a missing object fails closed", async () => {
  const r = ref("a.pdf");
  const v = validateAttachmentRefs([r], UID);
  assert.ok(v.ok);
  assert.deepEqual(await loadAttachments(v.items, fakeStorage({})), { ok: false, reason: "attachment_missing" });
});

test("load: a file whose bytes are not what the extension claims is refused", async () => {
  const r = ref("a.pdf");
  const v = validateAttachmentRefs([r], UID);
  assert.ok(v.ok);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
  assert.deepEqual(await loadAttachments(v.items, fakeStorage({ [r.storagePath]: exe })), { ok: false, reason: "attachment_type_not_allowed" });
});

test("load: the real size wins over the declared one (a lying client cannot sneak a big file in)", async () => {
  const r = ref("a.pdf", { size: 10 });
  const v = validateAttachmentRefs([r], UID);
  assert.ok(v.ok);
  const huge = new Uint8Array(6 * MB + 1);
  huge.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  assert.deepEqual(await loadAttachments(v.items, fakeStorage({ [r.storagePath]: huge })), { ok: false, reason: "attachment_too_large" });
});

test("load: the real total is checked too", async () => {
  const a = ref("a.pdf", { size: 10 });
  const b = ref("b.pdf", { size: 10, storagePath: buildAttachmentPath(UID, UP, "b.pdf") });
  const v = validateAttachmentRefs([a, b], UID);
  assert.ok(v.ok);
  const five = () => {
    const x = new Uint8Array(5 * MB + 1);
    x.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    return x;
  };
  assert.deepEqual(await loadAttachments(v.items, fakeStorage({ [a.storagePath]: five(), [b.storagePath]: five() })), { ok: false, reason: "attachment_total_too_large" });
});

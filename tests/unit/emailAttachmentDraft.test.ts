import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentTotals, planNewFiles, type DraftItem } from "@/lib/email/attachments/draft";

const MB = 1024 * 1024;
const item = (over: Partial<DraftItem> = {}): DraftItem => ({ key: "k", filename: "a.pdf", size: 100, status: "ready", ...over });
const file = (name: string, size: number, type = "application/pdf") => ({ name, size, type });

test("files within the limits are accepted", () => {
  assert.deepEqual(planNewFiles([], [file("a.pdf", MB), file("b.png", MB, "image/png")]), [{ ok: true }, { ok: true }]);
});

test("a blocked type or an oversize file is refused with its own reason, and does not use up the quota", () => {
  const out = planNewFiles([], [file("a.exe", 10, "application/x-msdownload"), file("b.pdf", 7 * MB), file("c.pdf", 0), file("d.pdf", 10)]);
  assert.deepEqual(out, [{ ok: false, reason: "type" }, { ok: false, reason: "size" }, { ok: false, reason: "empty" }, { ok: true }]);
});

test("the sixth file is refused; errored items do not count toward the five", () => {
  const five = Array.from({ length: 5 }, (_, i) => item({ key: `k${i}` }));
  assert.deepEqual(planNewFiles(five, [file("x.pdf", 1)]), [{ ok: false, reason: "too_many" }]);
  const withError = [...five.slice(0, 4), item({ key: "bad", status: "error" })];
  assert.deepEqual(planNewFiles(withError, [file("x.pdf", 1)]), [{ ok: true }]);
});

test("the total is held to 10 MB across existing and new files; errored items do not count", () => {
  const existing = [item({ size: 5 * MB }), item({ key: "k2", size: 4 * MB })];
  assert.deepEqual(planNewFiles(existing, [file("x.pdf", 2 * MB)]), [{ ok: false, reason: "total" }]);
  assert.deepEqual(planNewFiles(existing, [file("x.pdf", MB)]), [{ ok: true }]);
  const withError = [item({ size: 5 * MB }), item({ key: "bad", status: "error", size: 6 * MB })];
  assert.deepEqual(planNewFiles(withError, [file("x.pdf", 5 * MB)]), [{ ok: true }]);
});

test("totals count only files that will be sent", () => {
  const items = [item({ size: 2 * MB }), item({ key: "u", status: "uploading", size: MB }), item({ key: "e", status: "error", size: 9 * MB })];
  assert.deepEqual(attachmentTotals(items), { count: 2, bytes: 3 * MB, uploading: true });
  assert.deepEqual(attachmentTotals([]), { count: 0, bytes: 0, uploading: false });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { sweepAttachments, sweepUnregisteredObjects } from "@/lib/email/attachments/sweep";
import type { AttachmentStorage, StorageEntry } from "@/lib/email/attachments/storage";

/** `tree` maps a folder prefix to its entries; `removeOk` decides what Storage confirms. */
function world(candidates: string[], opts: { removeOk?: (paths: string[]) => boolean | "throw"; tree?: Record<string, StorageEntry[]> } = {}) {
  const log = { removed: [] as string[][], marked: [] as string[][] };
  const storage: AttachmentStorage = {
    async download() {
      return null;
    },
    async remove(paths) {
      log.removed.push(paths);
      const ok = opts.removeOk ? opts.removeOk(paths) : true;
      if (ok === "throw") throw new Error("network");
      return ok;
    },
    async list(prefix) {
      return opts.tree?.[prefix] ?? null;
    },
  };
  return {
    log,
    deps: {
      async selectSweepable() {
        return candidates.map((storagePath) => ({ storagePath }));
      },
      async markRemoved(paths: string[]) {
        log.marked.push(paths);
      },
      storage,
    },
  };
}

test("sweep: deletes from Storage first, then stops tracking", async () => {
  const w = world(["u/a/x.pdf", "u/b/y.pdf"]);
  assert.deepEqual(await sweepAttachments(w.deps), { selected: 2, removed: 2, failed: 0 });
  assert.deepEqual(w.log.removed, [["u/a/x.pdf", "u/b/y.pdf"]]);
  assert.deepEqual(w.log.marked, [["u/a/x.pdf", "u/b/y.pdf"]]);
});

test("sweep: when Storage never confirms (or throws) and the object is still there, nothing is marked", async () => {
  for (const mode of [false, "throw"] as const) {
    const w = world(["u/a/x.pdf"], { removeOk: () => mode, tree: { "u/a": [{ name: "x.pdf", isFolder: false, createdAt: null }] } });
    assert.deepEqual(await sweepAttachments(w.deps), { selected: 1, removed: 0, failed: 1 });
    assert.equal(w.log.marked.length, 0);
  }
});

test("sweep: a batch that is not fully confirmed is retried one by one; an object that is already gone stops being tracked", async () => {
  const w = world(["u/a/x.pdf", "u/b/gone.pdf"], {
    // The batch answer is short (one object never existed); singly, only x.pdf can be removed.
    removeOk: (paths) => paths.length === 1 && paths[0] === "u/a/x.pdf",
    tree: { "u/b": [] },
  });
  assert.deepEqual(await sweepAttachments(w.deps), { selected: 2, removed: 2, failed: 0 });
  assert.deepEqual(w.log.marked, [["u/a/x.pdf", "u/b/gone.pdf"]]);
});

test("sweep: nothing to do makes no Storage call", async () => {
  const w = world([]);
  assert.deepEqual(await sweepAttachments(w.deps), { selected: 0, removed: 0, failed: 0 });
  assert.equal(w.log.removed.length, 0);
});

const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const folder = (name: string): StorageEntry => ({ name, isFolder: true, createdAt: null });
const file = (name: string, hours: number): StorageEntry => ({ name, isFolder: false, createdAt: ago(hours) });

test("unregistered sweep: deletes objects older than 24 h that no live row tracks, keeps the rest", async () => {
  const w = world([], {
    tree: {
      "": [folder("owner1")],
      owner1: [folder("up1"), folder("up2"), folder("up3")],
      "owner1/up1": [file("old-orphan.pdf", 30)],
      "owner1/up2": [file("fresh.pdf", 2)],
      "owner1/up3": [file("old-tracked.pdf", 48)],
    },
  });
  const out = await sweepUnregisteredObjects({ storage: w.deps.storage, tracked: async () => new Set(["owner1/up3/old-tracked.pdf"]) }, NOW);
  assert.deepEqual(out, { scanned: 3, removed: 1, failed: 0 });
  assert.deepEqual(w.log.removed, [["owner1/up1/old-orphan.pdf"]]);
});

test("unregistered sweep: a failed delete is reported, an empty bucket does nothing", async () => {
  const tree = { "": [folder("o")], o: [folder("u")], "o/u": [file("a.pdf", 99)] };
  const failing = world([], { tree, removeOk: () => false });
  assert.deepEqual(await sweepUnregisteredObjects({ storage: failing.deps.storage, tracked: async () => new Set() }, NOW), { scanned: 1, removed: 0, failed: 1 });
  const empty = world([], { tree: { "": [] } });
  assert.deepEqual(await sweepUnregisteredObjects({ storage: empty.deps.storage, tracked: async () => new Set() }, NOW), { scanned: 0, removed: 0, failed: 0 });
  assert.equal(empty.log.removed.length, 0);
});

test("unregistered sweep: the walk is capped per run", async () => {
  const uploads = Array.from({ length: 150 }, (_, i) => folder(`u${i}`));
  const tree: Record<string, StorageEntry[]> = { "": [folder("o")], o: uploads };
  for (const u of uploads) tree[`o/${u.name}`] = [file("a.pdf", 99)];
  const w = world([], { tree });
  const out = await sweepUnregisteredObjects({ storage: w.deps.storage, tracked: async () => new Set() }, NOW);
  assert.equal(out.scanned, 100);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { sweepAttachments } from "@/lib/email/attachments/sweep";

function world(candidates: string[], removeOk: boolean | "throw") {
  const log = { removed: [] as string[][], marked: [] as string[][] };
  return {
    log,
    deps: {
      async selectSweepable() {
        return candidates.map((storagePath) => ({ storagePath }));
      },
      async markRemoved(paths: string[]) {
        log.marked.push(paths);
      },
      storage: {
        async download() {
          return null;
        },
        async remove(paths: string[]) {
          log.removed.push(paths);
          if (removeOk === "throw") throw new Error("network");
          return removeOk;
        },
      },
    },
  };
}

test("sweep: deletes from Storage first, then stops tracking", async () => {
  const w = world(["u/a/x.pdf", "u/b/y.pdf"], true);
  assert.deepEqual(await sweepAttachments(w.deps), { selected: 2, removed: 2, failed: 0 });
  assert.deepEqual(w.log.removed, [["u/a/x.pdf", "u/b/y.pdf"]]);
  assert.deepEqual(w.log.marked, [["u/a/x.pdf", "u/b/y.pdf"]]);
});

test("sweep: when Storage does not confirm (or throws) nothing is marked, so the next run retries", async () => {
  for (const mode of [false, "throw"] as const) {
    const w = world(["u/a/x.pdf"], mode);
    assert.deepEqual(await sweepAttachments(w.deps), { selected: 1, removed: 0, failed: 1 });
    assert.equal(w.log.marked.length, 0);
  }
});

test("sweep: nothing to do makes no Storage call", async () => {
  const w = world([], true);
  assert.deepEqual(await sweepAttachments(w.deps), { selected: 0, removed: 0, failed: 0 });
  assert.equal(w.log.removed.length, 0);
});

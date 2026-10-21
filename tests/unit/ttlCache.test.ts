import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTtlCache } from "@/lib/ttlCache";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createTtlCache", () => {
  it("loads once and serves later calls from memory inside the TTL", async () => {
    const c = clock();
    let loads = 0;
    const cache = createTtlCache(async () => ({ n: ++loads }), { ttlMs: 60_000, now: c.now });
    assert.deepEqual(await cache.get(), { n: 1 });
    c.advance(59_999);
    assert.deepEqual(await cache.get(), { n: 1 });
    assert.equal(loads, 1);
  });

  it("reloads once the TTL has elapsed", async () => {
    const c = clock();
    let loads = 0;
    const cache = createTtlCache(async () => ++loads, { ttlMs: 60_000, now: c.now });
    await cache.get();
    c.advance(60_000);
    assert.equal(await cache.get(), 2);
  });

  it("shares one in-flight load between concurrent callers (no stampede)", async () => {
    let loads = 0;
    let release!: (v: number) => void;
    const cache = createTtlCache(
      () => {
        loads++;
        return new Promise<number>((res) => (release = res));
      },
      { ttlMs: 60_000 },
    );
    const all = Promise.all([cache.get(), cache.get(), cache.get()]);
    release(7);
    assert.deepEqual(await all, [7, 7, 7]);
    assert.equal(loads, 1);
  });

  it("does not cache a failure: the next call retries and every concurrent caller sees the error", async () => {
    let loads = 0;
    const cache = createTtlCache(
      async () => {
        loads++;
        if (loads === 1) throw new Error("boom");
        return "ok";
      },
      { ttlMs: 60_000 },
    );
    const [a, b] = await Promise.allSettled([cache.get(), cache.get()]);
    assert.equal(a.status, "rejected");
    assert.equal(b.status, "rejected");
    assert.equal(loads, 1);
    assert.equal(await cache.get(), "ok");
    assert.equal(loads, 2);
  });

  it("hands every caller its own copy, so one caller mutating the result cannot corrupt the next", async () => {
    const cache = createTtlCache(async () => [{ id: "b" }, { id: "a" }], { ttlMs: 60_000 });
    const first = await cache.get();
    first.sort((x, y) => x.id.localeCompare(y.id));
    first.push({ id: "z" });
    assert.deepEqual(await cache.get(), [{ id: "b" }, { id: "a" }]);
  });

  it("clear() drops the entry so the next call reloads", async () => {
    let loads = 0;
    const cache = createTtlCache(async () => ++loads, { ttlMs: 60_000 });
    await cache.get();
    cache.clear();
    assert.equal(await cache.get(), 2);
  });

  it("a clear() during a load keeps that stale load from being stored", async () => {
    let loads = 0;
    let release!: (v: number) => void;
    const cache = createTtlCache(
      () => {
        loads++;
        if (loads === 1) return new Promise<number>((res) => (release = res));
        return Promise.resolve(99);
      },
      { ttlMs: 60_000 },
    );
    const first = cache.get();
    cache.clear();
    release(1);
    await first;
    assert.equal(await cache.get(), 99);
  });
});

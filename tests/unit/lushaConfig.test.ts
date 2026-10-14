import assert from "node:assert/strict";
import { test } from "node:test";
import { getLushaConfig } from "../../src/lib/lusha/config";

test("production with a key resolves ok", () => {
  const r = getLushaConfig({ VERCEL_ENV: "production", LUSHA_API_KEY: "k-123" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.config.apiKey, "k-123");
});

test("a preview deploy with NODE_ENV=production and a key is not_production", () => {
  const r = getLushaConfig({ VERCEL_ENV: "preview", NODE_ENV: "production", LUSHA_API_KEY: "k-123" });
  assert.deepEqual(r, { ok: false, reason: "not_production" });
});

test("NODE_ENV=production alone never enables Lusha", () => {
  const r = getLushaConfig({ NODE_ENV: "production", LUSHA_API_KEY: "k-123" });
  assert.deepEqual(r, { ok: false, reason: "not_production" });
});

test("local dev is not_production", () => {
  assert.deepEqual(getLushaConfig({ NODE_ENV: "development", LUSHA_API_KEY: "k-123" }), {
    ok: false,
    reason: "not_production",
  });
  assert.deepEqual(getLushaConfig({}), { ok: false, reason: "not_production" });
});

test("production without a key is missing_env and names the variable", () => {
  assert.deepEqual(getLushaConfig({ VERCEL_ENV: "production" }), {
    ok: false,
    reason: "missing_env",
    missing: ["LUSHA_API_KEY"],
  });
});

test("an empty or whitespace key counts as missing", () => {
  for (const key of ["", "   ", "\n\t"]) {
    const r = getLushaConfig({ VERCEL_ENV: "production", LUSHA_API_KEY: key });
    assert.deepEqual(r, { ok: false, reason: "missing_env", missing: ["LUSHA_API_KEY"] });
  }
});

test("the failure result never carries the key value", () => {
  const r = getLushaConfig({ VERCEL_ENV: "preview", LUSHA_API_KEY: "secret-value-xyz" });
  assert.ok(!JSON.stringify(r).includes("secret-value-xyz"));
});

test("never throws, even on a hostile env", () => {
  assert.doesNotThrow(() => getLushaConfig({ VERCEL_ENV: undefined, LUSHA_API_KEY: undefined }));
});

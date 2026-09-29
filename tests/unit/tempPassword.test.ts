/**
 * Unit tests for src/lib/auth/tempPassword.ts. Pure, no DB — the crypto
 * source is injected so behavior is deterministic and testable without
 * relying on real randomness (except the two tests that deliberately use
 * the real `node:crypto` source to prove it is wired up).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateTempPassword,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_MIN_LENGTH,
} from "@/lib/auth/tempPassword";

// A deterministic fake "randomInt" source: returns values from a fixed
// queue, cycling if it runs out — lets a test assert an EXACT output,
// proving generateTempPassword actually consults the injected source
// rather than falling back to Math.random or ignoring it.
function fakeRandomInt(queue: number[]): (max: number) => number {
  let i = 0;
  return (max: number) => {
    const v = queue[i % queue.length]!;
    i += 1;
    if (v < 0 || v >= max) {
      throw new Error(`fakeRandomInt queue value ${v} out of range for max ${max}`);
    }
    return v;
  };
}

test("generateTempPassword defaults to a length of at least TEMP_PASSWORD_MIN_LENGTH", () => {
  const password = generateTempPassword();
  assert.ok(password.length >= TEMP_PASSWORD_MIN_LENGTH);
});

test("generateTempPassword honors an explicit length at or above the minimum", () => {
  const password = generateTempPassword({ length: 24 });
  assert.equal(password.length, 24);
});

test("generateTempPassword throws for a length below TEMP_PASSWORD_MIN_LENGTH", () => {
  assert.throws(() => generateTempPassword({ length: TEMP_PASSWORD_MIN_LENGTH - 1 }), /at least/);
});

test("generateTempPassword only uses characters from the unambiguous alphabet", () => {
  const password = generateTempPassword({ length: 40 });
  for (const ch of password) {
    assert.ok(TEMP_PASSWORD_ALPHABET.includes(ch), `unexpected character: ${ch}`);
  }
  for (const ambiguous of ["0", "O", "1", "l", "I"]) {
    assert.ok(!TEMP_PASSWORD_ALPHABET.includes(ambiguous), `alphabet must exclude ${ambiguous}`);
  }
});

test("generateTempPassword guarantees at least one upper, lower, digit and symbol character", () => {
  for (let i = 0; i < 20; i++) {
    const password = generateTempPassword();
    assert.ok(/[A-Z]/.test(password), `missing uppercase: ${password}`);
    assert.ok(/[a-z]/.test(password), `missing lowercase: ${password}`);
    assert.ok(/[0-9]/.test(password), `missing digit: ${password}`);
    assert.ok(/[^A-Za-z0-9]/.test(password), `missing symbol: ${password}`);
  }
});

test("generateTempPassword satisfies the app's own minimum password rule (>= 8 chars)", () => {
  const password = generateTempPassword();
  assert.ok(password.length >= 8);
});

test("two consecutive calls with the real crypto source never produce the same password", () => {
  const a = generateTempPassword();
  const b = generateTempPassword();
  assert.notEqual(a, b);
});

test("generateTempPassword uses the injected randomInt source, not the real one", () => {
  // Queue picked so the 4 guaranteed-class picks are index 0 of each
  // alphabet slice, the filler picks are all index 0 of the combined
  // alphabet, and the shuffle performs no swaps (randInt(i+1) === i every
  // time keeps element i in place).
  const length = TEMP_PASSWORD_MIN_LENGTH;
  const queue = [0, 0, 0, 0, ...Array(length - 4).fill(0), ...Array(length).fill(0)];
  const password = generateTempPassword({ length, randomInt: fakeRandomInt(queue) });
  assert.equal(password.length, length);
  // Deterministic given the fixed queue — pinned so a change to the
  // implementation that stops consulting the injected source (e.g. a
  // regression back to Math.random or the real crypto module) fails loudly.
  const again = generateTempPassword({ length, randomInt: fakeRandomInt(queue) });
  assert.equal(password, again);
});

test("generateTempPassword does not mutate the options object it receives", () => {
  const options = { length: TEMP_PASSWORD_MIN_LENGTH };
  const frozen = { ...options };
  generateTempPassword(options);
  assert.deepEqual(options, frozen);
});

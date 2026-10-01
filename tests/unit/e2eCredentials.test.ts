import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCi,
  readE2eCredentials,
  skipReason,
  missingCredentialsMessage,
} from "../e2e/credentials";

test("isCi treats unset, empty, 0 and false as not CI", () => {
  for (const v of [undefined, "", "0", "false", "FALSE"]) {
    assert.equal(isCi({ CI: v }), false, `CI=${String(v)}`);
  }
  for (const v of ["1", "true", "yes"]) assert.equal(isCi({ CI: v }), true, `CI=${v}`);
});

test("readE2eCredentials needs both variables, non-blank", () => {
  assert.equal(readE2eCredentials({}), null);
  assert.equal(readE2eCredentials({ E2E_EMAIL: "a@b.c" }), null);
  assert.equal(readE2eCredentials({ E2E_PASSWORD: "x" }), null);
  assert.equal(readE2eCredentials({ E2E_EMAIL: " ", E2E_PASSWORD: "x" }), null);
  assert.deepEqual(readE2eCredentials({ E2E_EMAIL: "a@b.c", E2E_PASSWORD: "x" }), {
    email: "a@b.c",
    password: "x",
  });
});

test("skipReason: skips locally without credentials, never in CI", () => {
  assert.match(skipReason({}) ?? "", /skipped: no E2E credentials/);
  assert.equal(skipReason({ CI: "true" }), null);
  assert.equal(skipReason({ E2E_EMAIL: "a@b.c", E2E_PASSWORD: "x" }), null);
});

test("missing-credentials message names both variables, the file and the account kind", () => {
  const m = missingCredentialsMessage();
  assert.match(m, /E2E_EMAIL/);
  assert.match(m, /E2E_PASSWORD/);
  assert.match(m, /\.env\.local/);
  assert.match(m, /\bbd\b/);
  assert.match(m, /expire/i);
});

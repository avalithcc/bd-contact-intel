import assert from "node:assert/strict";
import { test } from "node:test";
import { gmailConfigOkOrWarnOnce, resetGmailConfigWarning } from "@/lib/gmail/config";

const missing = () => ({ ok: false as const, missing: ["GOOGLE_OAUTH_CLIENT_ID"] });

test("missing OAuth config logs once per instance, names only, and returns false", () => {
  resetGmailConfigWarning();
  const lines: string[] = [];
  assert.equal(gmailConfigOkOrWarnOnce(missing, (m) => lines.push(m)), false);
  assert.equal(gmailConfigOkOrWarnOnce(missing, (m) => lines.push(m)), false);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /GOOGLE_OAUTH_CLIENT_ID/);
});

test("a usable config logs nothing and returns true", () => {
  resetGmailConfigWarning();
  const lines: string[] = [];
  const ok = () => ({ ok: true as const, config: { clientId: "x", clientSecret: "x", redirectUri: "x", tokenEncryptionKey: "x" } });
  assert.equal(gmailConfigOkOrWarnOnce(ok, (m) => lines.push(m)), true);
  assert.equal(lines.length, 0);
});

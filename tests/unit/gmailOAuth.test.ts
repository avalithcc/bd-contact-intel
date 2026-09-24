/**
 * Unit tests for the pure Gmail OAuth helpers:
 *  - src/lib/gmail/oauthState.ts — CSRF state generation/comparison
 *  - src/lib/gmail/config.ts — required-env-var check
 *  - src/lib/gmail/errors.ts — token-refresh error classification
 * Run with: npx tsx --test tests/unit/gmailOAuth.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateOAuthState, statesMatch } from "@/lib/gmail/oauthState";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { classifyTokenRefreshError } from "@/lib/gmail/errors";

const OAUTH_ENV_VARS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GMAIL_TOKEN_ENCRYPTION_KEY",
] as const;

function withEnv(overrides: Record<string, string | undefined>, run: () => void) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) original[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// --- oauthState -------------------------------------------------------

test("generateOAuthState produces long, non-empty, distinct nonces", () => {
  const a = generateOAuthState();
  const b = generateOAuthState();
  assert.ok(a.length >= 32);
  assert.notEqual(a, b);
});

test("statesMatch accepts identical values", () => {
  const state = generateOAuthState();
  assert.equal(statesMatch(state, state), true);
});

test("statesMatch rejects different values", () => {
  assert.equal(statesMatch(generateOAuthState(), generateOAuthState()), false);
});

test("statesMatch rejects missing cookie or query state", () => {
  const state = generateOAuthState();
  assert.equal(statesMatch(undefined, state), false);
  assert.equal(statesMatch(null, state), false);
  assert.equal(statesMatch(state, undefined), false);
  assert.equal(statesMatch("", state), false);
  assert.equal(statesMatch(undefined, undefined), false);
});

test("statesMatch rejects values of different length without throwing", () => {
  assert.doesNotThrow(() => {
    assert.equal(statesMatch("short", "a-much-longer-value"), false);
  });
});

// --- config -------------------------------------------------------

test("getGmailOAuthConfig returns ok with all vars set", () => {
  withEnv(
    {
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      GOOGLE_OAUTH_REDIRECT_URI: "https://example.com/callback",
      GMAIL_TOKEN_ENCRYPTION_KEY: "key",
    },
    () => {
      const result = getGmailOAuthConfig();
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.config.clientId, "client-id");
        assert.equal(result.config.redirectUri, "https://example.com/callback");
      }
    },
  );
});

test("getGmailOAuthConfig reports missing var names without leaking values", () => {
  withEnv(
    {
      GOOGLE_OAUTH_CLIENT_ID: undefined,
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      GOOGLE_OAUTH_REDIRECT_URI: "https://example.com/callback",
      GMAIL_TOKEN_ENCRYPTION_KEY: "key",
    },
    () => {
      const result = getGmailOAuthConfig();
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.deepEqual(result.missing, ["GOOGLE_OAUTH_CLIENT_ID"]);
      }
    },
  );
});

test("getGmailOAuthConfig reports all missing vars when none are set", () => {
  withEnv(
    Object.fromEntries(OAUTH_ENV_VARS.map((name) => [name, undefined])),
    () => {
      const result = getGmailOAuthConfig();
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.deepEqual(result.missing.sort(), [...OAUTH_ENV_VARS].sort());
      }
    },
  );
});

// --- errors -------------------------------------------------------

test("classifyTokenRefreshError treats invalid_grant as revoked", () => {
  const result = classifyTokenRefreshError(
    JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }),
  );
  assert.equal(result.kind, "revoked");
  assert.match(result.message, /revoked or expired/);
});

test("classifyTokenRefreshError treats invalid_client as config", () => {
  const result = classifyTokenRefreshError(JSON.stringify({ error: "invalid_client" }));
  assert.equal(result.kind, "config");
  assert.match(result.message, /misconfigured/);
});

test("classifyTokenRefreshError treats unauthorized_client as config", () => {
  const result = classifyTokenRefreshError(JSON.stringify({ error: "unauthorized_client" }));
  assert.equal(result.kind, "config");
});

test("classifyTokenRefreshError treats unknown codes as other", () => {
  const result = classifyTokenRefreshError(JSON.stringify({ error: "server_error" }));
  assert.equal(result.kind, "other");
});

test("classifyTokenRefreshError handles non-JSON bodies without throwing", () => {
  assert.doesNotThrow(() => {
    const result = classifyTokenRefreshError("not json");
    assert.equal(result.kind, "other");
  });
});

test("classifyTokenRefreshError never echoes secret-shaped fields", () => {
  const result = classifyTokenRefreshError(
    JSON.stringify({
      error: "invalid_grant",
      error_description: "expired",
      client_secret: "should-not-appear",
    }),
  );
  assert.doesNotMatch(result.message, /should-not-appear/);
});

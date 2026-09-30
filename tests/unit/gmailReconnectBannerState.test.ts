import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldShowReconnectBanner } from "@/lib/gmail/reconnectBannerState";

test("shows the banner when connected, send-only scope, and never dismissed", () => {
  const show = shouldShowReconnectBanner({
    accountStatus: "connected",
    grantedScopes: "https://www.googleapis.com/auth/gmail.send",
    reconnectBannerDismissedAt: null,
  });
  assert.equal(show, true);
});

test("hides the banner once dismissed, even if still send-only", () => {
  const show = shouldShowReconnectBanner({
    accountStatus: "connected",
    grantedScopes: "https://www.googleapis.com/auth/gmail.send",
    reconnectBannerDismissedAt: "2026-09-30T12:00:00.000Z",
  });
  assert.equal(show, false);
});

test("hides the banner once the BD has the readonly scope (reconnected)", () => {
  const show = shouldShowReconnectBanner({
    accountStatus: "connected",
    grantedScopes: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
    reconnectBannerDismissedAt: null,
  });
  assert.equal(show, false);
});

test("hides the banner when there's no connected account at all", () => {
  const show = shouldShowReconnectBanner({
    accountStatus: null,
    grantedScopes: null,
    reconnectBannerDismissedAt: null,
  });
  assert.equal(show, false);
});

test("hides the banner for a disconnected account even with a stale send-only scope on file", () => {
  const show = shouldShowReconnectBanner({
    accountStatus: "disconnected",
    grantedScopes: "https://www.googleapis.com/auth/gmail.send",
    reconnectBannerDismissedAt: null,
  });
  assert.equal(show, false);
});

/**
 * Unit tests for src/lib/config/siteUrl.ts — the one base-URL resolver task
 * links (digest email, elsewhere) build from, instead of each call site
 * hard-coding `https://bd-contact-intel.vercel.app`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSiteUrl } from "@/lib/config/siteUrl";

test("resolveSiteUrl uses NEXT_PUBLIC_SITE_URL when set, without a trailing slash", () => {
  assert.equal(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com/" }), "https://example.com");
  assert.equal(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com" }), "https://example.com");
});

test("resolveSiteUrl falls back to the known production URL when unset", () => {
  assert.equal(resolveSiteUrl({}), "https://bd-contact-intel.vercel.app");
});

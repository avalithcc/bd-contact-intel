/**
 * The LinkedIn extension's pure core: which pages get the card, who may talk to the service worker, how a CRM
 * answer becomes a state, which URLs the worker may open and the manifest's permission surface. No browser needed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseProfileUrl, profileUrlFromLocation } from "../../extension/src/shared/profileUrl";
import { readMayBeSent } from "../../extension/src/content/readGuard";
import { isTrustedSender } from "../../extension/src/background/sender";
import { classifyLookupResponse, type ResponseLike } from "../../extension/src/background/lookupResponse";
import { TtlCache } from "../../extension/src/background/cache";
import { buildAddUrl, buildLoginUrl, buildViewUrl, PREFILL_PARAMS } from "../../extension/src/background/crmUrls";
import { buildManifest } from "../../extension/build/manifest";
import { PREFILL_MAX_LENGTH, PREFILL_PARAM_KEYS } from "@/lib/contacts/linkedinProfilePrefill";

// ---- which pages get the card -------------------------------------------------------------------------------

test("only a profile root page yields a profile URL", () => {
  const ok = (pathname: string, hostname = "www.linkedin.com") => profileUrlFromLocation({ hostname, pathname });
  assert.equal(ok("/in/camila-herrera-12ab/"), "https://www.linkedin.com/in/camila-herrera-12ab/");
  assert.equal(ok("/in/camila-herrera-12ab"), "https://www.linkedin.com/in/camila-herrera-12ab/");
  assert.equal(ok("/in/camila-herrera-12ab/details/experience/"), null);
  assert.equal(ok("/in/camila-herrera-12ab/recent-activity/all/"), null);
  assert.equal(ok("/company/avalith/"), null);
  assert.equal(ok("/feed/"), null);
  assert.equal(ok("/in/"), null);
  assert.equal(ok("/in/x/", "evil.example"), null);
  assert.equal(ok("/in/x/", "www.linkedin.com.evil.example"), null);
});

test("a received profile URL is re-parsed, never trusted", () => {
  assert.equal(parseProfileUrl("https://www.linkedin.com/in/ana-perez/?trk=abc#x"), "https://www.linkedin.com/in/ana-perez/");
  assert.equal(parseProfileUrl("https://linkedin.com/in/ana-perez"), "https://www.linkedin.com/in/ana-perez/");
  assert.equal(parseProfileUrl("http://www.linkedin.com/in/ana-perez/"), null);
  assert.equal(parseProfileUrl("https://evil.example/in/ana-perez/"), null);
  assert.equal(parseProfileUrl("https://crm.avalith.net/api/anything"), null);
  assert.equal(parseProfileUrl("javascript:alert(1)"), null);
  assert.equal(parseProfileUrl(42), null);
});

// ---- may a finished read still be sent --------------------------------------------------------------------

const ADA = "https://www.linkedin.com/in/ada-lovelace/";
const GRACE = "https://www.linkedin.com/in/grace-hopper/";

test("a read that finished after the tab moved to another profile is dropped, not filed under the old URL", () => {
  // The URL leaves for the CRM from before the await; the basics come from after it. If the tab moved in
  // between, the two belong to different people — the incident this guard exists for.
  assert.equal(readMayBeSent({ startedGeneration: 7, currentGeneration: 7, startedUrl: ADA, currentUrl: GRACE }), false);
  // Off a profile page entirely (the feed, a search, a sub-page): nothing to attribute the read to.
  assert.equal(readMayBeSent({ startedGeneration: 7, currentGeneration: 7, startedUrl: ADA, currentUrl: null }), false);
});

test("a read is dropped when the tab left and came back to the SAME profile: the URL matches but the card does not", () => {
  // Back/forward or a re-entry from search unmounts the card and bumps the generation. Without the
  // generation check this case would pass the URL comparison and answer for a card that no longer exists.
  assert.equal(readMayBeSent({ startedGeneration: 7, currentGeneration: 8, startedUrl: ADA, currentUrl: ADA }), false);
});

test("a read that finished on the profile it started on is sent", () => {
  assert.equal(readMayBeSent({ startedGeneration: 7, currentGeneration: 7, startedUrl: ADA, currentUrl: ADA }), true);
  assert.equal(readMayBeSent({ startedGeneration: 0, currentGeneration: 0, startedUrl: GRACE, currentUrl: GRACE }), true);
});

test("the send in linkedin.ts is guarded by readMayBeSent — a source check, because that file has no harness", () => {
  // linkedin.ts runs `void start()` on import and needs the whole chrome.* surface, so no test reaches
  // addToCrm. The rule above is pinned properly; this only pins that the call site still uses it, which is
  // the regression that would silently reopen the bug. It asserts nothing about WHEN the rule says yes.
  const source = readFileSync(path.join(import.meta.dirname, "../../extension/src/content/linkedin.ts"), "utf8");
  const send = /if \(readMayBeSent\([^)]*\)\) await ask\(\{ type: "open-add"/.exec(source);
  assert.ok(send, 'the "open-add" send must sit behind readMayBeSent(...)');
  assert.doesNotMatch(source, /if \(mine === generation\) await ask\(\{ type: "open-add"/, "the old generation-only guard is not enough: it misses a move sync() has not seen yet");
});

// ---- who may talk to the worker -----------------------------------------------------------------------------

test("only this extension's own script on www.linkedin.com is trusted", () => {
  const id = "abcdefghijklmnop";
  assert.equal(isTrustedSender({ id, url: "https://www.linkedin.com/in/ana/" }, id), true);
  assert.equal(isTrustedSender({ id, tab: { url: "https://www.linkedin.com/feed/" } }, id), true);
  assert.equal(isTrustedSender({ id: "other", url: "https://www.linkedin.com/in/ana/" }, id), false);
  assert.equal(isTrustedSender({ url: "https://www.linkedin.com/in/ana/" }, id), false);
  assert.equal(isTrustedSender({ id, url: "https://evil.example/" }, id), false);
  assert.equal(isTrustedSender({ id, url: "https://www.linkedin.com.evil.example/" }, id), false);
  assert.equal(isTrustedSender({ id }, id), false);
});

// ---- how a CRM answer becomes a state -----------------------------------------------------------------------

function res(overrides: Partial<ResponseLike> & { body?: unknown }): ResponseLike {
  const { body, ...rest } = overrides;
  return {
    type: "basic",
    status: 200,
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    ...rest,
  };
}

const FOUND = {
  state: "found",
  personId: "0b8e1f10-0000-4000-8000-000000000001",
  name: "Valentina Rojas",
  jobTitle: "VP de Ingeniería",
  company: "Mercado Libre",
  ownerName: "Ana Pereyra",
  lastActivity: { label: "Llamada", date: "2026-10-15T14:00:00.000Z" },
  viewUrl: "/contacts/0b8e1f10-0000-4000-8000-000000000001",
};

test("a redirect, a 401 or a non-JSON page means not signed in", async () => {
  assert.deepEqual(await classifyLookupResponse(res({ type: "opaqueredirect", status: 0, ok: false })), { kind: "signed_out" });
  assert.deepEqual(await classifyLookupResponse(res({ status: 307, ok: false })), { kind: "signed_out" });
  assert.deepEqual(await classifyLookupResponse(res({ status: 401, ok: false, body: { state: "signed_out" } })), { kind: "signed_out" });
  assert.deepEqual(
    await classifyLookupResponse(res({ headers: { get: () => "text/html; charset=utf-8" }, body: "<html>login</html>" })),
    { kind: "signed_out" },
  );
});

test("found, not found and invalid answers map to states", async () => {
  assert.deepEqual(await classifyLookupResponse(res({ body: FOUND })), {
    kind: "found",
    personId: FOUND.personId,
    name: "Valentina Rojas",
    jobTitle: "VP de Ingeniería",
    company: "Mercado Libre",
    ownerName: "Ana Pereyra",
    lastActivity: { label: "Llamada", date: "2026-10-15T14:00:00.000Z" },
  });
  assert.deepEqual(await classifyLookupResponse(res({ body: { state: "not_found", addUrl: "/contacts?new=1" } })), { kind: "not_found" });
  assert.deepEqual(await classifyLookupResponse(res({ body: { state: "invalid" } })), { kind: "invalid" });
});

test("a found answer without lastActivity keeps it null", async () => {
  const { lastActivity: _drop, ...noActivity } = FOUND;
  void _drop;
  const result = await classifyLookupResponse(res({ body: noActivity }));
  assert.equal(result.kind === "found" && result.lastActivity, null);
});

test("server errors and malformed bodies are errors, never invented data", async () => {
  assert.deepEqual(await classifyLookupResponse(res({ status: 500, ok: false })), { kind: "error" });
  assert.deepEqual(await classifyLookupResponse(res({ body: { state: "found", personId: "not-a-uuid", name: "X" } })), { kind: "error" });
  assert.deepEqual(await classifyLookupResponse(res({ body: { state: "wat" } })), { kind: "error" });
  assert.deepEqual(await classifyLookupResponse(res({ json: async () => { throw new Error("bad json"); } })), { kind: "error" });
});

// ---- cache --------------------------------------------------------------------------------------------------

test("cache entries expire after the ttl and can be dropped", () => {
  const cache = new TtlCache<string>(60_000);
  cache.set("a", "x", 1_000);
  assert.equal(cache.get("a", 60_999), "x");
  assert.equal(cache.get("a", 61_001), undefined);
  cache.set("b", "y", 0);
  cache.delete("b");
  assert.equal(cache.get("b", 1), undefined);
});

// ---- which URLs the worker may open -------------------------------------------------------------------------

test("the add URL carries the profile link and capped basics under the CRM's own param names", () => {
  assert.deepEqual(Object.values(PREFILL_PARAMS).sort(), [...PREFILL_PARAM_KEYS].sort());
  const url = new URL(
    buildAddUrl("https://crm.avalith.net", "https://www.linkedin.com/in/camila-herrera-12ab/", {
      name: "Camila Herrera",
      title: "x".repeat(PREFILL_MAX_LENGTH * 2),
      company: "",
      location: "Buenos Aires, Argentina",
    }),
  );
  assert.equal(url.origin, "https://crm.avalith.net");
  assert.equal(url.pathname, "/contacts");
  assert.equal(url.searchParams.get("new"), "1");
  assert.equal(url.searchParams.get("linkedin"), "https://www.linkedin.com/in/camila-herrera-12ab/");
  assert.equal(url.searchParams.get("li_name"), "Camila Herrera");
  assert.equal(url.searchParams.get("li_title")?.length, PREFILL_MAX_LENGTH);
  assert.equal(url.searchParams.has("li_company"), false, "an unreadable field is omitted, not sent empty");
  assert.equal(url.searchParams.get("li_location"), "Buenos Aires, Argentina");
});

test("view and login URLs are built from the configured origin and a validated id only", () => {
  const id = "0b8e1f10-0000-4000-8000-000000000001";
  assert.equal(buildViewUrl("https://crm.avalith.net", id), `https://crm.avalith.net/contacts/${id}`);
  assert.equal(buildViewUrl("https://crm.avalith.net", "../../etc"), null);
  assert.equal(buildViewUrl("https://crm.avalith.net", `${id}/../x`), null);
  assert.equal(buildLoginUrl("https://crm.avalith.net"), "https://crm.avalith.net/login");
});

// ---- permission surface -------------------------------------------------------------------------------------

test("the store manifest only reaches the CRM and www.linkedin.com", () => {
  const manifest = buildManifest({ dev: false });
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ["https://crm.avalith.net/*", "https://www.linkedin.com/*"]);
  assert.deepEqual(manifest.permissions, ["storage"]);
  const matches = manifest.content_scripts.flatMap((script) => script.matches);
  assert.deepEqual(matches.sort(), ["https://crm.avalith.net/*", "https://www.linkedin.com/*"]);
  assert.equal(JSON.stringify(manifest).includes("localhost"), false);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
});

test("the dev manifest adds localhost and nothing else", () => {
  const dev = buildManifest({ dev: true });
  const store = buildManifest({ dev: false });
  assert.deepEqual([...dev.host_permissions].sort(), [...store.host_permissions, "http://localhost:3000/*"].sort());
  assert.deepEqual(dev.permissions, store.permissions);
  assert.notEqual(dev.name, store.name);
});

/**
 * Service worker. The only place that talks to the CRM: the content script sends messages and this worker
 * fetches with the BD's CRM session cookie (`credentials: "include"`, allowed by the host permission) and
 * `redirect: "manual"`, so the middleware's redirect to /login is seen as "not signed in" instead of followed.
 * It only ever calls the one lookup route with a re-parsed profile URL, and only opens URLs built in crmUrls.ts
 * from the configured origin; it never fetches or opens a URL it was handed.
 */
import { parseProfileUrl } from "../shared/profileUrl";
import type { LookupResult, WorkerRequest } from "../shared/messages";
import { TtlCache } from "./cache";
import { buildAddUrl, buildLoginUrl, buildViewUrl, lookupEndpoint } from "./crmUrls";
import { classifyLookupResponse } from "./lookupResponse";
import { isTrustedSender } from "./sender";

const CRM_ORIGIN = __CRM_ORIGIN__;
const CACHE_TTL_MS = 60_000;
const cache = new TtlCache<LookupResult>(CACHE_TTL_MS);

async function lookup(rawProfileUrl: string, force: boolean): Promise<LookupResult> {
  const profileUrl = parseProfileUrl(rawProfileUrl);
  if (!profileUrl) return { kind: "invalid" };
  if (force) cache.delete(profileUrl);
  const cached = cache.get(profileUrl, Date.now());
  if (cached) return cached;

  let result: LookupResult;
  try {
    const response = await fetch(lookupEndpoint(CRM_ORIGIN, profileUrl), {
      credentials: "include",
      redirect: "manual",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    result = await classifyLookupResponse(response);
  } catch {
    result = { kind: "error" };
  }
  // Only a definite answer is reused; "not signed in" and errors must be re-asked as soon as the BD acts.
  if (result.kind === "found" || result.kind === "not_found") cache.set(profileUrl, result, Date.now());
  return result;
}

async function open(url: string | null): Promise<LookupResult> {
  if (url) await chrome.tabs.create({ url });
  return { kind: "invalid" };
}

function isRequest(message: unknown): message is WorkerRequest {
  return typeof message === "object" && message !== null && typeof (message as { type?: unknown }).type === "string";
}

async function handle(request: WorkerRequest): Promise<LookupResult> {
  switch (request.type) {
    case "lookup":
      return lookup(request.profileUrl, request.force === true);
    case "open-view":
      return open(buildViewUrl(CRM_ORIGIN, request.personId));
    case "open-add": {
      const profileUrl = parseProfileUrl(request.profileUrl);
      return open(profileUrl ? buildAddUrl(CRM_ORIGIN, profileUrl, request.basics) : null);
    }
    case "open-login":
      return open(buildLoginUrl(CRM_ORIGIN));
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedSender(sender, chrome.runtime.id) || !isRequest(message)) return false;
  handle(message)
    .then(sendResponse)
    .catch(() => sendResponse({ kind: "error" } satisfies LookupResult));
  return true;
});

/**
 * Request/response half of /api/unsubscribe, over injected effects so the route file stays a shell. The decisions
 * (token handling, GET writes nothing, POST suppresses) are the PR 4 handlers in unsubscribeHandlers.ts; this only
 * reads the Request and builds the Response.
 *
 * GET is handed `{ findToken }` and nothing else, so it cannot reach the write path even by mistake: a corporate mail
 * scanner opens every link in an inbound message, and an acting GET would unsubscribe people who never clicked.
 */
import type { Locale } from "@/lib/i18n/locales";
import {
  handleUnsubscribeGet,
  handleUnsubscribePost,
  type UnsubscribePort,
  type UnsubscribeView,
} from "./unsubscribeHandlers";
import type { UnsubscribePageAudience } from "./unsubscribePageAudience";
import { hashUnsubscribeToken, isWellFormedUnsubscribeToken } from "./unsubscribeToken";

export interface UnsubscribeRequestDeps {
  port: UnsubscribePort;
  /** The recipient's postal address and email language (from their compliance audience), keyed by token hash. Absent is fine. */
  audienceFor(tokenHash: string): Promise<UnsubscribePageAudience | undefined>;
  render(view: UnsubscribeView, page?: UnsubscribePageAudience): string;
}

/** A recipient's link carries the token in the URL: it must not travel in a Referer, be cached, or be indexed. */
const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

/** `locale` is the page's language (`pageLocale`), so a screen reader pronounces the copy in the right language. */
export function unsubscribeDocument(bodyHtml: string, css: string, locale: Locale): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>avalith.</title><style>${css}</style></head><body>${bodyHtml}</body></html>`;
}

async function respond(view: UnsubscribeView, token: string | null | undefined, deps: UnsubscribeRequestDeps): Promise<Response> {
  const page = view.kind !== "invalid" && isWellFormedUnsubscribeToken(token) ? await deps.audienceFor(hashUnsubscribeToken(token)) : undefined;
  return new Response(deps.render(view, page), { status: view.kind === "invalid" ? 404 : 200, headers: HEADERS });
}

export async function handleUnsubscribeGetRequest(request: Request, deps: UnsubscribeRequestDeps): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t");
  return respond(await handleUnsubscribeGet(token, { findToken: deps.port.findToken }), token, deps);
}

export async function handleUnsubscribePostRequest(request: Request, deps: UnsubscribeRequestDeps): Promise<Response> {
  const queryToken = new URL(request.url).searchParams.get("t");
  // Gmail's one-click and the confirmation form both post urlencoded fields; a body that does not parse is just empty.
  const form = await request.formData().catch(() => null);
  const formToken = form?.get("t");
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const view = await handleUnsubscribePost({ queryToken, formToken: typeof formToken === "string" ? formToken : null, oneClick }, deps.port);
  return respond(view, isWellFormedUnsubscribeToken(queryToken) ? queryToken : typeof formToken === "string" ? formToken : null, deps);
}

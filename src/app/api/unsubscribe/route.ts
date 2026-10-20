import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unstable_rethrow } from "next/navigation";
import { pageLocale, renderUnsubscribeHtml } from "@/lib/sequences/unsubscribeHtml";
import { unsubscribeAudienceForToken, unsubscribePort } from "@/lib/sequences/unsubscribeQueries";
import { handleUnsubscribeGetRequest, handleUnsubscribePostRequest, unsubscribeDocument, type UnsubscribeRequestDeps } from "@/lib/sequences/unsubscribeRequest";

/**
 * The public unsubscribe link (outreach-sequences D6). Session-exempt in src/lib/auth/sessionExemptRoutes.ts: the
 * caller is a recipient clicking a link in an email, and the 256-bit token IS the credential.
 *
 *  - GET renders the confirmation page and WRITES NOTHING (mail scanners open every link).
 *  - POST suppresses: both the confirmation form and Gmail's RFC 8058 one-click land here, one write path.
 *
 * Uses the app's Drizzle/postgres client through unsubscribeQueries (never supabase-js: RLS is on with no policies).
 *
 * A route handler cannot sit inside the root layout, so the page is a standalone document (markup from
 * unsubscribeHtml.ts, a string because Next refuses react-dom/server in this layer) with the design system stylesheets
 * inlined (read once from src/app, traced into the function by next.config.mjs). The web font is not loaded here, so
 * the page uses the system fallback.
 */
export const dynamic = "force-dynamic";

let stylesheet: string | undefined;
/**
 * Read from disk, and an UNSTYLED page if that fails. The files are reached through Next's file tracing, which the
 * local build does include (`.next/server/app/api/unsubscribe/route.js.nft.json` lists both) — but if tracing ever
 * stops shipping them, an unguarded read turns every GET and POST into a 500, and the one-click opt-out stops
 * working for real recipients. An ugly unsubscribe page honours the request; a 500 does not. Cached either way, so a
 * failed read costs one attempt per instance, not one per request.
 */
function css(): string {
  if (stylesheet === undefined) {
    try {
      stylesheet = ["design-system.css", "globals.css"].map((file) => readFileSync(join(process.cwd(), "src", "app", file), "utf8")).join("\n");
    } catch (error) {
      // Nothing in the try can throw a navigation error, but the repo guard is mechanical on purpose and a bare catch
      // in a route handler is exactly the shape that silently swallows a redirect() somewhere else later.
      unstable_rethrow(error);
      stylesheet = "";
    }
  }
  return stylesheet;
}

const deps: UnsubscribeRequestDeps = {
  port: unsubscribePort,
  audienceFor: unsubscribeAudienceForToken,
  render: (view, page) => unsubscribeDocument(renderUnsubscribeHtml(view, page), css(), pageLocale(view, page)),
};

export const GET = (request: Request) => handleUnsubscribeGetRequest(request, deps);
export const POST = (request: Request) => handleUnsubscribePostRequest(request, deps);

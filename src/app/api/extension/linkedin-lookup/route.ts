import { NextRequest, NextResponse } from "next/server";
import { hasUsableSession } from "@/lib/auth/lightSession";
import { findLivePersonIdByProfileKey } from "@/lib/contacts/linkedinLookup";
import { runLinkedinLookup } from "@/lib/extension/linkedinLookup";
import { getLinkedinPersonCard } from "@/lib/extension/linkedinPersonCardQuery";
import { getDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Backs the LinkedIn browser extension's "¿ya está en el CRM?" card. Reads ONE profile URL and answers
 * found / not found / invalid. The extension calls it from its service worker with the BD's CRM session
 * cookie; there are deliberately no CORS headers (the service worker's host permission needs none, and a web
 * page must never be able to read this). Behind the middleware session gate like every non-exempt route, so
 * an unauthenticated request is redirected to /login before it gets here, and the handler re-checks anyway.
 *
 * Uses `hasUsableSession`, not getCurrentBd: browsing LinkedIn must not stamp `bd.last_seen_at`, which feeds
 * the Gmail reminders and means "was in the CRM".
 */
export async function GET(request: NextRequest) {
  const { status, body } = await runLinkedinLookup(request.nextUrl.searchParams.get("url"), {
    hasSession: hasUsableSession,
    findLivePersonId: (profileKey) => findLivePersonIdByProfileKey(profileKey),
    loadCard: async (personId) => getLinkedinPersonCard(personId, await getDictionary()),
  });
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

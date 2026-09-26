import { redirect } from "next/navigation";
import { buildOutreachRedirectQuery, type OutreachViewSearchParams } from "@/lib/contacts/outreachViewParams";

export const dynamic = "force-dynamic";

/**
 * Redirects to `/contacts?view=outreach&...` (task 15c; owner decision
 * 2026-09-26). The parity inventory (task 15a-2's commits + this one) found
 * every `/outreach` feature now has a `/contacts` equivalent: the exact same
 * ranking/reason chips (src/lib/contacts/outreachViewDb.ts, reusing
 * src/lib/outreach/ranking.ts unmodified — confirmed by DB smoke, first 25
 * ranked rows match in order for the same BD), every filter (roleGroup,
 * companyCategory, market, miamiOnly, excludeNever, hideOffshore,
 * startupsOnly, name), pagination, per-row "Generar mensaje", and both
 * empty states (no hiring companies synced / hiring companies but no
 * matching contacts). Every field maps 1:1 — no renaming, unlike `/leads`'s
 * redirect — see buildOutreachRedirectQuery's doc comment.
 *
 * The underlying data/action layer (src/lib/outreach/queries.ts,
 * ./actions.ts, ./GenerateMessageButton.tsx, ./messageLabels.ts) is
 * untouched and still in active use — `/contacts/page.tsx` imports it
 * directly for the Outreach view, same as this redirect target.
 */
export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<OutreachViewSearchParams & { page?: string }>;
}) {
  const sp = await searchParams;
  redirect(`/contacts?${buildOutreachRedirectQuery(sp)}`);
}

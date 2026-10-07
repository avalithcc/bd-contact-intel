"use server";

/**
 * Server action behind the `/companies` list's bulk bar ("Estado de
 * cliente"). Plain `<form action={...}>` target, same convention as
 * contacts/bulkActions.ts: it redirects back with a `?bulkResult=` summary
 * instead of throwing. Permission = the single-record edit's: any signed-in
 * BD (updateCompanyPropertyAction uses getCurrentBd, not requireAdmin).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { getHiringMatchIndex } from "@/lib/hiring/queries";
import {
  isCountConfirmed,
  parseBulkClientStatusValue,
  requiresCountConfirmation,
  sanitizeBulkCompanyKeys,
} from "@/lib/companies/bulkClientStatus";
import { bulkSetClientStatus, getCompanyKeysForFilters } from "@/lib/companies/bulkClientStatusDb";
import { parseCompanyListParams } from "@/lib/companies/listParams";

function backTo(returnQuery: string, extra: Record<string, string>): string {
  const params = new URLSearchParams(returnQuery);
  params.delete("bulkResult");
  params.delete("bulkLimited");
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `/companies?${params.toString()}`;
}

export async function bulkClientStatusAction(formData: FormData): Promise<void> {
  const me = await getCurrentBd();
  const returnQuery = String(formData.get("returnQuery") ?? "");
  const rawStatus = formData.get("clientStatus");
  // A missing field must never read as "No es cliente" (blank = NULL).
  const target = typeof rawStatus === "string" ? parseBulkClientStatusValue(rawStatus) : undefined;
  if (target === undefined) redirect(backTo(returnQuery, { bulkResult: "clientStatus:invalid" }));

  const isFilterMode = formData.get("mode") === "filter";
  let keys: string[];
  let wasLimited: boolean;
  if (isFilterMode) {
    const params = parseCompanyListParams(new URLSearchParams(returnQuery));
    const hiringKeys = params.view === "hiring" ? [...(await getHiringMatchIndex()).keys()] : [];
    ({ keys, wasLimited } = await getCompanyKeysForFilters(params, me.id, hiringKeys));
  } else {
    const rawKeys = formData.getAll("companyKey");
    keys = sanitizeBulkCompanyKeys(rawKeys);
    wasLimited = rawKeys.length > keys.length;
  }

  // The dialog enforces this too; the server is the boundary.
  if (requiresCountConfirmation(keys.length) && !isCountConfirmed(String(formData.get("confirmCount") ?? ""), keys.length)) {
    redirect(backTo(returnQuery, { bulkResult: "clientStatus:confirm" }));
  }

  const { changed, unchanged } = await bulkSetClientStatus(keys, target, me.id, {
    mode: isFilterMode ? "filter" : "ids",
    filtersQuery: isFilterMode ? returnQuery : undefined,
  });

  revalidatePath("/companies");
  redirect(
    backTo(returnQuery, {
      bulkResult: `clientStatus:${changed}:${unchanged}`,
      ...(wasLimited ? { bulkLimited: "1" } : {}),
    }),
  );
}

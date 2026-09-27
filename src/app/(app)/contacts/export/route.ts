/**
 * "Exportar" (task 13.2, PR 13b2; toolbar-level "whole view" export closes
 * the mockup's toolbar `.btn` "Exportar" — contacts.html:95). GET so the
 * browser can download it as a plain link. Two modes, both auth-gated the
 * same way as every other contacts read:
 *
 * - `?personId=` present: exports exactly the checked bulk selection
 *   (BulkActionsBar.tsx `buildExportHref`), same as before this batch.
 * - `?personId=` absent: exports the CURRENT FILTERED VIEW instead — the
 *   toolbar-level "Exportar" button serializes `effectiveFilters` (the
 *   same object the list query already resolved) straight into this
 *   route's query string via `serializeContactFilters`, so this route
 *   never re-resolves `?view=` itself. Capped at MAX_VIEW_EXPORT_ROWS so a
 *   broad/unfiltered view (up to 26,606 persons in prod) can't return an
 *   unbounded CSV; `X-Export-Truncated: 1` on the response signals a cap
 *   hit (no UI currently reads it — flagged in the checklist as a stopgap
 *   needing owner confirmation on the exact number, same as the bulk
 *   message-generation cap).
 */
import { getCurrentBd } from "@/lib/queries";
import { getContactListPage, getContactListRowsByIds } from "@/lib/contacts/listQueries";
import { sanitizeBulkPersonIds } from "@/lib/contacts/bulkOwner";
import { sanitizeColumnKeys } from "@/lib/contacts/columns";
import { parseContactFilters } from "@/lib/contacts/viewFilters";
import { parseContactSort } from "@/lib/contacts/sort";
import { getHiringCompanyKeys } from "@/lib/hiring/queries";
import { buildContactsCsv, CSV_BOM, mapContactRowToExportRow, type ContactCsvHeaders } from "@/lib/contacts/csvExport";
import { getDictionary } from "@/lib/i18n/server";

// Not exported: Next.js route.ts files only allow HTTP-method/config
// exports, so this constant stays module-private.
const MAX_VIEW_EXPORT_ROWS = 5000;

export async function GET(request: Request): Promise<Response> {
  const me = await getCurrentBd();

  const { searchParams } = new URL(request.url);
  const ids = sanitizeBulkPersonIds(searchParams.getAll("personId"));
  const columns = sanitizeColumnKeys(searchParams.get("columns")?.split(",") ?? []);

  const dict = await getDictionary();
  const l = dict.contactList;
  const headers: ContactCsvHeaders = {
    name: l.colName,
    company: l.colCompany,
    owner: l.colOwner,
    status: l.colStatus,
    email: l.colEmail,
    phone: l.colPhone,
    bdConnections: l.colBdConnections,
    lastActivity: l.colLastActivity,
    roleGroup: l.colRoleGroup,
    industry: l.colIndustry,
    country: l.colCountry,
    source: l.colSource,
    created: l.colCreated,
    seniority: l.colSeniority,
  };

  let truncated = false;
  const rows = await (async () => {
    if (ids.length) return getContactListRowsByIds(ids, dict);

    const filters = parseContactFilters(searchParams);
    const q = searchParams.get("q") ?? undefined;
    const sort = parseContactSort(searchParams.get("sort") ?? undefined);
    const hiringKeys = await getHiringCompanyKeys();
    const page = await getContactListPage(filters, me.id, q, 1, MAX_VIEW_EXPORT_ROWS, dict, sort, hiringKeys);
    truncated = page.total > MAX_VIEW_EXPORT_ROWS;
    return page.rows;
  })();

  const csv = buildContactsCsv(
    rows.map((row) =>
      mapContactRowToExportRow(row, dict.leadStatuses[row.status as keyof typeof dict.leadStatuses] ?? row.status),
    ),
    columns,
    headers,
  );

  return new Response(CSV_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contactos.csv"`,
      // Personal data selected by id/filter in the URL: never cache it anywhere.
      "Cache-Control": "no-store",
      ...(truncated ? { "X-Export-Truncated": "1" } : {}),
    },
  });
}

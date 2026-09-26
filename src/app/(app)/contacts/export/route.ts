/**
 * "Exportar" bulk action (task 13.2, PR 13b2) — GET so the browser can
 * download it as a plain link (no client JS needed for the request itself;
 * BulkActionsBar.tsx builds the href from the checked selection). Requires
 * auth like every other contacts read; ids are validated uuids capped at
 * MAX_BULK_SELECTION (same sanitizeBulkPersonIds as the other bulk actions),
 * columns are sanitized against the known column set. Never touches
 * conversation content — same read as the list table.
 */
import { getCurrentBd } from "@/lib/queries";
import { getContactListRowsByIds } from "@/lib/contacts/listQueries";
import { sanitizeBulkPersonIds } from "@/lib/contacts/bulkOwner";
import { sanitizeColumnKeys } from "@/lib/contacts/columns";
import { buildContactsCsv, CSV_BOM, type ContactCsvHeaders } from "@/lib/contacts/csvExport";
import { getDictionary } from "@/lib/i18n/server";

export async function GET(request: Request): Promise<Response> {
  await getCurrentBd();

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
    roleGroup: l.colRoleGroup,
    industry: l.colIndustry,
    country: l.colCountry,
    source: l.colSource,
    created: l.colCreated,
    seniority: l.colSeniority,
  };

  const rows = ids.length ? await getContactListRowsByIds(ids) : [];
  const csv = buildContactsCsv(
    rows.map((row) => ({
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      ownerName: row.ownerName,
      statusLabel: dict.leadStatuses[row.status as keyof typeof dict.leadStatuses] ?? row.status,
      email: row.email,
      roleGroup: row.roleGroup,
      industry: row.industry,
      country: row.country,
      sourceKey: row.sourceKey,
      createdAt: row.createdAt,
      seniority: row.seniority,
    })),
    columns,
    headers,
  );

  return new Response(CSV_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contactos.csv"`,
      // Personal data selected by id in the URL: never cache it anywhere.
      "Cache-Control": "no-store",
    },
  });
}

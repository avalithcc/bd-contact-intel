// Read-only: runs the REAL per-BD report query against production and renders the new
// "Roles excluidos" cell through the same helper the page uses, so the column is proven
// end to end before it ships. No unit test executes this SQL.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildReportPerBdQuery } from "@/lib/reports/queries";
import { excludedRoleGroupsCell } from "@/lib/reports/excludedRoleGroupsCell";
import { es } from "@/lib/i18n/dictionaries/es";

async function main() {
  await db.execute(sql`set session characteristics as transaction read only`);
  const rows = (await db.execute(
    buildReportPerBdQuery({
      fromIso: "2026-10-01T00:00:00Z",
      toIso: "2026-11-17T00:00:00Z",
      fromDate: "2026-10-01",
      toDateExclusive: "2026-11-17",
      bdId: null,
    }),
  )) as unknown as Array<{ bd_name: string; excluded_role_groups: string[] | null; queue_worked: number }>;

  for (const r of rows) {
    const cell = excludedRoleGroupsCell(r.excluded_role_groups ?? [], es.roleGroups);
    console.log(
      `${r.bd_name.padEnd(20)} raw=${JSON.stringify(r.excluded_role_groups)} ` +
        `cell={shown:${JSON.stringify(cell.shown)}, overflow:${cell.overflow}, empty:${cell.empty}}`,
    );
  }
  process.exit(0);
}
void main();

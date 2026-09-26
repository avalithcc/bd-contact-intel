/**
 * Thin DB glue: CRUD for BD-created saved views (task 12.3; design D7,
 * `saved_view` table). Imports `db` — same convention as propertyEditDb.ts
 * — so this file is not unit-tested directly; planSavedViewInput
 * (savedViewInput.ts) carries the tested validation/sanitization logic.
 *
 * Personal views only (design D7): every read/update/delete is scoped to
 * `owner_bd_id = ownerBdId`, so a BD can never see or touch another BD's
 * saved view.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedView, type SavedView } from "@/db/schema";
import { planSavedViewInput } from "@/lib/contacts/savedViewInput";
import { sanitizeContactFilters, type ContactFilters } from "@/lib/contacts/viewFilters";
import type { SavedViewSort } from "@/lib/contacts/savedViewInput";

export interface SavedViewSummary {
  id: string;
  name: string;
  filters: ContactFilters;
  columns: string[];
  sort: SavedViewSort;
  position: number;
}

function toSummary(row: SavedView): SavedViewSummary {
  return {
    id: row.id,
    name: row.name,
    filters: sanitizeContactFilters(row.filters),
    columns: Array.isArray(row.columns) ? (row.columns as string[]) : [],
    sort: (row.sort as SavedViewSort) ?? {},
    position: row.position,
  };
}

export async function listSavedViews(ownerBdId: string): Promise<SavedViewSummary[]> {
  const rows = await db
    .select()
    .from(savedView)
    .where(eq(savedView.ownerBdId, ownerBdId))
    .orderBy(asc(savedView.position), asc(savedView.createdAt));
  return rows.map(toSummary);
}

export async function getSavedView(
  id: string,
  ownerBdId: string,
): Promise<SavedViewSummary | undefined> {
  const [row] = await db
    .select()
    .from(savedView)
    .where(and(eq(savedView.id, id), eq(savedView.ownerBdId, ownerBdId)));
  return row ? toSummary(row) : undefined;
}

export async function createSavedView(
  ownerBdId: string,
  input: { name: string; filters: unknown; columns: unknown; sort: unknown },
): Promise<SavedViewSummary> {
  const plan = planSavedViewInput(input);
  const [row] = await db
    .insert(savedView)
    .values({
      ownerBdId,
      name: plan.name,
      filters: plan.filters,
      columns: plan.columns,
      sort: plan.sort,
    })
    .returning();
  return toSummary(row!);
}

export async function updateSavedView(
  id: string,
  ownerBdId: string,
  input: { name: string; filters: unknown; columns: unknown; sort: unknown },
): Promise<SavedViewSummary | undefined> {
  const plan = planSavedViewInput(input);
  const [row] = await db
    .update(savedView)
    .set({
      name: plan.name,
      filters: plan.filters,
      columns: plan.columns,
      sort: plan.sort,
      updatedAt: new Date(),
    })
    .where(and(eq(savedView.id, id), eq(savedView.ownerBdId, ownerBdId)))
    .returning();
  return row ? toSummary(row) : undefined;
}

export async function deleteSavedView(id: string, ownerBdId: string): Promise<boolean> {
  const rows = await db
    .delete(savedView)
    .where(and(eq(savedView.id, id), eq(savedView.ownerBdId, ownerBdId)))
    .returning({ id: savedView.id });
  return rows.length > 0;
}

"use server";

/**
 * Server actions behind the `/contacts` list's saved views (task 12.3).
 * Plain `<form action={...}>` targets — no client JS needed, matching this
 * page's server-only rendering (no ClientStrings surface to guard here).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { createSavedView, deleteSavedView, getSavedView, updateSavedView } from "@/lib/contacts/savedViews";
import { SavedViewNameError } from "@/lib/contacts/savedViewInput";
import { parseContactFilters } from "@/lib/contacts/viewFilters";
import { sanitizeColumnKeys } from "@/lib/contacts/columns";
import { isUuid } from "@/lib/uuid";

const SAVED_VIEW_PREFIX = "saved:";

export async function createSavedViewAction(formData: FormData): Promise<void> {
  const me = await getCurrentBd();
  const name = String(formData.get("name") ?? "");
  const filtersQuery = String(formData.get("filtersQuery") ?? "");
  const filters = parseContactFilters(new URLSearchParams(filtersQuery));

  try {
    const view = await createSavedView(me.id, { name, filters, columns: [], sort: {} });
    revalidatePath("/contacts");
    redirect(`/contacts?view=saved:${view.id}`);
  } catch (err) {
    // A blank/too-long name (SavedViewNameError) redirects back to the
    // current view instead of crashing the page — no error UI in this
    // phase's scope (tasks.md 12.3), same "fail closed" as a no-op.
    if (err instanceof SavedViewNameError) {
      redirect("/contacts");
    }
    throw err;
  }
}

export async function deleteSavedViewAction(formData: FormData): Promise<void> {
  const me = await getCurrentBd();
  const id = String(formData.get("id") ?? "");
  // A tampered or stale form id would otherwise reach a uuid column and throw.
  if (!isUuid(id)) redirect("/contacts");
  await deleteSavedView(id, me.id);
  revalidatePath("/contacts");
  redirect("/contacts");
}

/**
 * Column picker submit (task 13.1). "Persisted per view (saved_view.columns)"
 * applies literally when the active view IS a saved view — the selection is
 * written to that row's `columns` jsonb (design D7). System views have no DB
 * row to persist onto, so their selection round-trips through a `?columns=`
 * query param instead (redirects with it set) — a deliberate scope decision,
 * not a silent gap: flagged in apply-progress for sdd-verify.
 */
export async function updateViewColumnsAction(formData: FormData): Promise<void> {
  const me = await getCurrentBd();
  const view = String(formData.get("view") ?? "");
  const columns = sanitizeColumnKeys(formData.getAll("columns"));

  if (view.startsWith(SAVED_VIEW_PREFIX)) {
    const id = view.slice(SAVED_VIEW_PREFIX.length);
    if (isUuid(id)) {
      const existing = await getSavedView(id, me.id);
      if (existing) {
        await updateSavedView(id, me.id, {
          name: existing.name,
          filters: existing.filters,
          columns,
          sort: existing.sort,
        });
      }
    }
    revalidatePath("/contacts");
    redirect(`/contacts?view=${encodeURIComponent(view)}`);
  }

  const params = new URLSearchParams();
  params.set("view", view || "all");
  if (columns.length) params.set("columns", columns.join(","));
  redirect(`/contacts?${params.toString()}`);
}

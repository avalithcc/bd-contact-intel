"use server";

/**
 * Server actions behind the `/contacts` list's saved views (task 12.3).
 * Plain `<form action={...}>` targets — no client JS needed, matching this
 * page's server-only rendering (no ClientStrings surface to guard here).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { createSavedView, deleteSavedView } from "@/lib/contacts/savedViews";
import { SavedViewNameError } from "@/lib/contacts/savedViewInput";
import { parseContactFilters } from "@/lib/contacts/viewFilters";
import { isUuid } from "@/lib/uuid";

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

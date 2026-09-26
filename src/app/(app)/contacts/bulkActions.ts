"use server";

/**
 * Server actions behind the `/contacts` list's bulk-action bar (task 13.2;
 * mockup `.bulk-bar`: "Asignar responsable" — PR 13b1a. "Crear tarea" ships
 * in the follow-up PR 13b1b on top of this branch (feature-branch-chain);
 * "Generar mensajes" (bulk AI) is explicitly deferred, "Exportar" ships in
 * a later slice). Plain `<form action={...}>` target, same convention as
 * viewActions.ts — no client JS needed for the write itself (only
 * selection state is client-side, see BulkActionsBar.tsx).
 *
 * Redirects back to the current view with a `?bulkResult=` summary in the
 * query string instead of throwing, so a partial R3 skip or a truncated
 * selection (MAX_BULK_SELECTION) surfaces as a Spanish banner (page.tsx)
 * rather than an opaque error.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { bulkAssignOwner } from "@/lib/contacts/bulkOwnerDb";
import { sanitizeBulkPersonIds } from "@/lib/contacts/bulkOwner";

function backTo(formData: FormData, extra: Record<string, string>): string {
  const params = new URLSearchParams();
  const view = String(formData.get("view") ?? "");
  const q = String(formData.get("q") ?? "");
  const page = String(formData.get("page") ?? "");
  if (view) params.set("view", view);
  if (q) params.set("q", q);
  if (page) params.set("page", page);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `/contacts?${params.toString()}`;
}

export async function bulkAssignOwnerAction(formData: FormData): Promise<void> {
  const me = await getCurrentBd();
  const rawIds = formData.getAll("personId");
  const sanitizedIds = sanitizeBulkPersonIds(rawIds);
  const wasLimited = rawIds.length > sanitizedIds.length;
  const ownerBdId = String(formData.get("ownerBdId") ?? "") || null;

  const plan = await bulkAssignOwner(sanitizedIds, ownerBdId, me.id);
  const assigned = plan.filter((p) => p.outcome === "assigned").length;
  const skipped = plan.filter((p) => p.outcome === "skipped_has_connection").length;

  revalidatePath("/contacts");
  redirect(
    backTo(formData, {
      bulkResult: `owner:${assigned}:${skipped}`,
      ...(wasLimited ? { bulkLimited: "1" } : {}),
    }),
  );
}

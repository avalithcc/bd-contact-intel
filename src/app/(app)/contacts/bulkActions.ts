"use server";

/**
 * Server actions behind the `/contacts` list's bulk-action bar (task 13.2;
 * mockup `.bulk-bar`): "Asignar responsable" (PR 13b1a) and "Crear tarea"
 * (this PR, 13b1b, on top of 13b1a — feature-branch-chain). "Generar
 * mensajes" (bulk AI) is explicitly deferred, "Exportar" ships in a later
 * slice. Plain `<form action={...}>` targets, same convention as
 * viewActions.ts — no client JS needed for the writes themselves (only
 * selection state is client-side, see BulkActionsBar.tsx).
 *
 * Every action redirects back to the current view with a `?bulkResult=`
 * summary in the query string instead of throwing, so a partial R3 skip
 * (bulk owner) or a truncated selection (MAX_BULK_SELECTION) surfaces as a
 * Spanish banner (page.tsx) rather than an opaque error.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { bulkAssignOwner } from "@/lib/contacts/bulkOwnerDb";
import { sanitizeBulkPersonIds } from "@/lib/contacts/bulkOwner";
import { createTask } from "@/lib/tasks/queries";
import type { NewTask } from "@/db/schema";

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

/** "Crear tarea" bulk action (task 13.2): one task per selected person,
 * sharing the submitted title/due date — reuses createTask (same path as
 * the record page's "Tarea" quick action), looped over the validated id
 * list, not a bespoke bulk-insert. */
export async function bulkCreateTaskAction(formData: FormData): Promise<void> {
  const me = await getCurrentBd();
  const rawIds = formData.getAll("personId");
  const personIds = sanitizeBulkPersonIds(rawIds);
  const wasLimited = rawIds.length > personIds.length;
  const title = String(formData.get("title") ?? "").trim();
  const dueAtRaw = String(formData.get("dueAt") ?? "");
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : undefined;

  let created = 0;
  if (title) {
    for (const personId of personIds) {
      await createTask({
        title,
        dueAt,
        personId,
        assignedToBdId: me.id,
        actorBdId: me.id,
      } as NewTask);
      created++;
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/tasks");
  redirect(
    backTo(formData, {
      bulkResult: `task:${created}`,
      ...(wasLimited ? { bulkLimited: "1" } : {}),
    }),
  );
}

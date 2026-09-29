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
import { bulkAssignOwner, filterLivePersonIds } from "@/lib/contacts/bulkOwnerDb";
import { isUuid } from "@/lib/uuid";
import { BULK_FILTER_TARGET_CAP, sanitizeBulkPersonIds } from "@/lib/contacts/bulkOwner";
import { createTask, assertAssigneeExists } from "@/lib/tasks/queries";
import { resolveTaskAssignee } from "@/lib/tasks/assignee";
import type { NewTask } from "@/db/schema";
import { getContactIdsForFilters } from "@/lib/contacts/listQueries";
import { parseContactFilters } from "@/lib/contacts/viewFilters";
import { parseContactSort } from "@/lib/contacts/sort";
import { getDictionary } from "@/lib/i18n/server";

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

/**
 * "Seleccionar los N" filter-wide bulk mode (contacts.html:104) vs. the
 * plain checked-boxes mode. `mode=filter` + a `filtersQuery` field (the
 * SAME serialized ContactFilters the toolbar's own filters use, built by
 * serializeContactFilters — see page.tsx `toolbarExportHref` for the same
 * pattern applied to export) means the server re-derives the id set
 * itself; the client never sends ids in that mode. Always capped at
 * `idCap` (BULK_FILTER_TARGET_CAP for owner/task; export uses its own
 * separate cap in export/route.ts).
 */
interface ResolvedBulkTarget {
  ids: string[];
  wasLimited: boolean;
  // Owner-approved audit requirement: bulkAssignOwnerAction forwards these
  // straight through to bulkAssignOwner so the audit_log row records
  // exactly which mode produced the id list.
  mode: "ids" | "filter";
  filtersQuery?: string;
}

async function resolveBulkTargetIds(formData: FormData, meBdId: string, idCap: number): Promise<ResolvedBulkTarget> {
  if (formData.get("mode") === "filter") {
    const filtersQuery = String(formData.get("filtersQuery") ?? "");
    const filters = parseContactFilters(new URLSearchParams(filtersQuery));
    const q = String(formData.get("q") ?? "") || undefined;
    const sort = parseContactSort(String(formData.get("sort") ?? "") || undefined);
    const dict = await getDictionary();
    const { ids, total } = await getContactIdsForFilters(filters, meBdId, q, sort, dict, idCap);
    return { ids, wasLimited: total > ids.length, mode: "filter", filtersQuery };
  }
  const rawIds = formData.getAll("personId");
  const ids = sanitizeBulkPersonIds(rawIds);
  return { ids, wasLimited: rawIds.length > ids.length, mode: "ids" };
}

export async function bulkAssignOwnerAction(formData: FormData): Promise<void> {
  const me = await getCurrentBd();
  const { ids: sanitizedIds, wasLimited, mode, filtersQuery } = await resolveBulkTargetIds(
    formData,
    me.id,
    BULK_FILTER_TARGET_CAP,
  );
  const rawOwner = String(formData.get("ownerBdId") ?? "");
  const ownerBdId = rawOwner && isUuid(rawOwner) ? rawOwner : null;
  if (rawOwner && !ownerBdId) redirect(backTo(formData, { bulkResult: "owner:0:0" }));

  const plan = await bulkAssignOwner(sanitizedIds, ownerBdId, me.id, {
    idCap: BULK_FILTER_TARGET_CAP,
    mode,
    filtersQuery,
  });
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
 * sharing the submitted title/due date/description/assignee — reuses
 * createTask (same path as the record page's "Tarea" quick action), looped
 * over the validated id list, not a bespoke bulk-insert. The assignee is
 * resolved and validated ONCE before the loop (task-essentials backlog item
 * 2) — never per row, since every created task shares the same assignee. */
export async function bulkCreateTaskAction(formData: FormData): Promise<void> {
  const me = await getCurrentBd();
  const { ids: personIds, wasLimited } = await resolveBulkTargetIds(formData, me.id, BULK_FILTER_TARGET_CAP);
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const dueAtRaw = String(formData.get("dueAt") ?? "");
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : undefined;
  const rawAssignee = String(formData.get("assignedToBdId") ?? "");
  const assignedToBdId = resolveTaskAssignee(rawAssignee, me.id);

  let created = 0;
  if (title && assignedToBdId !== undefined) {
    await assertAssigneeExists(assignedToBdId, me.id);
    for (const personId of await filterLivePersonIds(personIds)) {
      await createTask({
        title,
        description,
        dueAt,
        personId,
        assignedToBdId,
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

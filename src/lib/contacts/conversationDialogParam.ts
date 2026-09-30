import { isUuid } from "@/lib/uuid";

/**
 * Validates the record page's `?conversation=<bdId>` query param (owner
 * decision 2026-09-30: Administración → Registro de auditoría's "Abrir"
 * link now points here instead of the deleted standalone
 * `/contacts/[id]/conversation/[bdId]` page — see AdminConversationAutoOpen)
 * BEFORE it ever reaches `revealAdminConversationAction`. A malformed value
 * must never even mount the admin flow, let alone reach that action's own
 * `isUuid` check or the DB. Admin gating itself happens separately —
 * page.tsx only calls this when `isAdmin` is already true server-side — this
 * only answers "is this syntactically a bd id worth trying".
 */
export function resolveConversationDialogParam(raw: string | undefined): string | null {
  if (!raw) return null;
  return isUuid(raw) ? raw : null;
}

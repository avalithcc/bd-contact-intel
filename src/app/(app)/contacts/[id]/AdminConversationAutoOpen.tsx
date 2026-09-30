"use client";

import { useRouter } from "next/navigation";
import { AdminConversationFlow } from "./AdminConversationFlow";
import type { ContactRecordLabels } from "@/lib/contacts/labels";

/**
 * Bridges Administración → Registro de auditoría's "Abrir" link (now
 * `/contacts/[id]?conversation=<bdId>` — the standalone
 * `/contacts/[id]/conversation/[bdId]` page is deleted, owner decision
 * 2026-09-30) into `AdminConversationFlow`, skipping its confirmation step:
 * the admin already confirmed by clicking "Abrir" from the audited log
 * itself. `bdId` is validated (isUuid, `resolveConversationDialogParam`) and
 * admin-gated server-side — page.tsx only renders this component when
 * `isAdmin` is already true AND the param parses — so this never mounts for
 * a non-admin or a malformed param; no modal, no data either way.
 *
 * Closing the modal strips `?conversation=` from the URL (`router.replace`)
 * so a refresh doesn't silently reopen it (and re-audit) every time.
 */
export function AdminConversationAutoOpen({
  bdId,
  personId,
  personName,
  labels,
}: {
  bdId: string;
  personId: string;
  personName: string;
  labels: ContactRecordLabels;
}) {
  const router = useRouter();

  return (
    <AdminConversationFlow
      trigger={{ bdId, bdName: "" }}
      skipConfirm
      personId={personId}
      personName={personName}
      labels={labels}
      onClose={() => router.replace(`/contacts/${personId}`)}
    />
  );
}

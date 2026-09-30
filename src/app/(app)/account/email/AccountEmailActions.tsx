"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { disconnectEmailAccountAction, syncEmailAccountNowAction } from "./connectionActions";

export interface SyncNowLabels {
  label: string;
  syncingLabel: string;
  errorLabel: string;
  // Server-side cooldown (syncCooldown.ts) — friendly, not an error: the
  // client's own `busy` flag never guarded against a second tab, a reload
  // mid-request, or a fast double submit, so the server can refuse a
  // request this button never disabled for.
  cooldownLabel: string;
  inProgressLabel: string;
}

/**
 * "Sincronizar ahora" (email-sync.html:249) — same busy-button pattern as
 * every other action in this codebase (ReopenTaskButton.tsx): disable +
 * inline `.spinner` while the request is in flight, `router.refresh()` on
 * success so the fresh `lastSyncedAt`/`syncError` shows up, a Toast
 * otherwise (friendly "success" copy for a cooldown/in-progress refusal,
 * "error" for anything unexpected).
 */
export function SyncNowButton({ label, syncingLabel, errorLabel, cooldownLabel, inProgressLabel }: SyncNowLabels) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await syncEmailAccountNowAction();
          if (result.ok) {
            router.refresh();
          } else if (result.reason === "cooldown") {
            showToast(cooldownLabel, "success");
          } else if (result.reason === "in_progress") {
            showToast(inProgressLabel, "success");
          } else {
            showToast(errorLabel, "error");
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {busy ? syncingLabel : label}
    </button>
  );
}

/** "Desconectar" (email-sync.html:244,249,256). */
export function DisconnectButton({ label, errorLabel }: { label: string; errorLabel: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-danger btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await disconnectEmailAccountAction();
          if (result.ok) {
            router.refresh();
          } else {
            showToast(errorLabel, "error");
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}

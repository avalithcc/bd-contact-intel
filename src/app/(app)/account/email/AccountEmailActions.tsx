"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { disconnectEmailAccountAction, syncEmailAccountNowAction } from "./connectionActions";

/**
 * "Sincronizar ahora" (email-sync.html:249) — same busy-button pattern as
 * every other action in this codebase (ReopenTaskButton.tsx): disable +
 * inline `.spinner` while the request is in flight, `router.refresh()` on
 * success so the fresh `lastSyncedAt`/`syncError` shows up, a Toast on
 * failure.
 */
export function SyncNowButton({ label, syncingLabel, errorLabel }: { label: string; syncingLabel: string; errorLabel: string }) {
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

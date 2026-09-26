"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ToastProvider";

/**
 * Fires a success Toast once when `/account/email?success=1` is reached
 * (the Gmail OAuth callback redirect target) — tasks.md mockup-parity 5.1:
 * "Use Toast for success feedback where the mockup shows it". The inline
 * `.alertWarn` banners stay for errors (persistent, not transient), only
 * the one-time "connected" confirmation becomes a Toast.
 */
export function ConnectSuccessToast({ message }: { message: string | null }) {
  const { showToast } = useToast();
  const shown = useRef(false);

  useEffect(() => {
    if (!message || shown.current) return;
    shown.current = true;
    showToast(message, "success");
  }, [message, showToast]);

  return null;
}

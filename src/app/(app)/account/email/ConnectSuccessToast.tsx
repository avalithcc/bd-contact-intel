"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";

/**
 * Fires a success Toast once when `/account/email?success=1` is reached
 * (the Gmail OAuth callback redirect target) — tasks.md mockup-parity 5.1:
 * "Use Toast for success feedback where the mockup shows it". The inline
 * `.alertWarn` banners stay for errors (persistent, not transient), only
 * the one-time "connected" confirmation becomes a Toast. The success param
 * is then dropped from the URL so Back or a reload doesn't fire it again.
 */
export function ConnectSuccessToast({ message }: { message: string | null }) {
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef(false);

  useEffect(() => {
    if (!message || shown.current) return;
    shown.current = true;
    showToast(message, "success");
    router.replace(pathname, { scroll: false });
  }, [message, showToast, router, pathname]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";

/**
 * Fires a success Toast once when the bulk-action bar's `<form>` submission
 * redirects back to `/contacts?bulkResult=...` (bulkActions.ts) — same
 * one-time-toast-then-strip-the-param pattern as
 * `(app)/account/email/ConnectSuccessToast.tsx`, but only drops the
 * `bulkResult` param (not the whole query string: `view`/`q`/`page`/
 * `bulkLimited` must survive the replace). Replaces the old inline
 * `.alert-info` banner: closing the bulk-action Dialog and reporting its
 * result is a transient confirmation, not a persistent page banner.
 * `bulkLimited` stays a persistent inline banner in page.tsx (it's a
 * warning about a truncated selection, not a one-time success message).
 */
export function BulkResultToast({ message }: { message: string | null }) {
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef(false);

  useEffect(() => {
    // Once the param is stripped the message goes back to null; re-arm so the
    // next bulk action in the same session (no full reload) toasts again.
    if (!message) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;
    showToast(message, "success");
    // Read the query string client-side (not `useSearchParams`, which would
    // force this page into the Suspense-boundary dance) so `view`/`q`/
    // `page`/`bulkLimited` survive the replace and only `bulkResult` drops.
    const params = new URLSearchParams(window.location.search);
    params.delete("bulkResult");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [message, showToast, router, pathname]);

  return null;
}

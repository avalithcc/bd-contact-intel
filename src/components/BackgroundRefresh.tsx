"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { detectBusy, domProbe, readPageHints, shouldRefreshNow, TICK_MS } from "@/lib/shell/refreshPolicy";

/**
 * Mounted once in the authenticated shell. Re-fetches the current screen's server data in the background (see
 * src/lib/shell/refreshPolicy.ts for the rules and the data-attribute conventions). Renders nothing.
 * `router.refresh()` keeps client state, so a refresh never closes a dialog; it is still skipped while one is open so
 * the data under a form does not change mid-edit.
 */
export function BackgroundRefresh() {
  const router = useRouter();
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
    const attempt = (trigger: "tick" | "wake") => {
      const dom = domProbe(document);
      const hints = readPageHints(dom);
      const go = shouldRefreshNow({ trigger, now: Date.now(), lastRefreshAt: last.current, hidden: document.hidden, busy: detectBusy(dom), ...hints });
      if (!go) return;
      last.current = Date.now();
      router.refresh();
    };
    const onTick = () => attempt("tick");
    const onWake = () => attempt("wake");
    const onVisibility = () => { if (!document.hidden) attempt("wake"); };
    const timer = window.setInterval(onTick, TICK_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onWake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onWake);
    };
  }, [router]);

  return null;
}

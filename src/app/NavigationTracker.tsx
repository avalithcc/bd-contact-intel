"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Counts in-app history entries so BackButton can tell whether
 * `router.back()` stays inside the app. The App Router doesn't expose this:
 * unlike the Pages Router it stamps no `idx` on `history.state`.
 *
 * Module state (not React state) on purpose: it survives client-side
 * navigations and resets on a full page load, which is exactly when the
 * app can no longer vouch for what's behind the current entry.
 */
let inAppDepth = 0;

export function canGoBackInApp(): boolean {
  return inAppDepth > 0;
}

export function NavigationTracker() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // The first render is the entry page itself, not a navigation.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    inAppDepth += 1;
  }, [pathname]);

  useEffect(() => {
    // Browser back/forward and router.back() both fire popstate; count them
    // as a step back so the depth never claims history the app doesn't have.
    // The pathname effect above then re-counts the landing page, so offset it
    // (no clamp here: -2 then +1 must net to exactly one step back).
    function onPopState() {
      inAppDepth -= 2;
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return null;
}

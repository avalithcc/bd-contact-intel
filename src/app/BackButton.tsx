"use client";

import { useRouter } from "next/navigation";
import { canGoBackInApp } from "./NavigationTracker";

/**
 * Icon-only "go back" control for page headers. Navigates to the previous
 * entry in the browser history, so it returns wherever the user actually
 * came from (a filtered list, a search result, another detail page) rather
 * than a fixed route.
 *
 * Dead-end guard: `router.back()` is a no-op — or worse, leaves the app —
 * when there is no in-app entry behind this one: the URL was opened
 * directly, in a new tab, or followed from an external link. `history.length`
 * cannot tell us that, since it also counts entries that belong to whatever
 * site the user came from, and the App Router stamps no `idx` on
 * `history.state` (that's the Pages Router). NavigationTracker counts in-app
 * navigations instead; when it can't vouch for an earlier entry of THIS app,
 * we fall back to `fallbackHref`, which keeps the user inside the app.
 *
 * The check runs inside the click handler, not at render time, so the
 * server-rendered markup and the post-hydration markup are identical — no
 * layout shift, no flash of a different button state.
 */
export function BackButton({
  label,
  fallbackHref = "/",
}: {
  label: string;
  fallbackHref?: string;
}) {
  const router = useRouter();

  function handleClick() {
    if (canGoBackInApp()) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      className="back-btn"
      aria-label={label}
      title={label}
      onClick={handleClick}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
    </button>
  );
}

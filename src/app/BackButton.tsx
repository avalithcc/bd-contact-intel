"use client";

import { useRouter } from "next/navigation";

/**
 * Icon-only "go back" control for page headers. Navigates to the previous
 * entry in the browser history, so it returns wherever the user actually
 * came from (a filtered list, a search result, another detail page) rather
 * than a fixed route.
 *
 * Dead-end guard: `router.back()` is a no-op (or leaves the app entirely)
 * when there is no in-app history to go back to — e.g. the user opened the
 * URL directly, followed an external link, or opened this page in a new
 * tab. `window.history.length <= 1` is a reliable client-side signal for
 * "this tab has no history to go back to" in that case, so we fall back to
 * `fallbackHref` instead. This check runs inside the click handler, not at
 * render time, so the server-rendered markup and the post-hydration markup
 * are identical — no layout shift, no flash of a different button state.
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
    if (window.history.length <= 1) {
      router.push(fallbackHref);
      return;
    }
    router.back();
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

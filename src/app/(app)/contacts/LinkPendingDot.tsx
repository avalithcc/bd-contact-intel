"use client";

import { useLinkStatus } from "next/link";

/**
 * Pending-state indicator for the Tabla/Tablero segmented links and the
 * view tabs (owner feedback round 18: "the user must see progress
 * immediately on click"). Must be rendered as a CHILD of a `next/link`
 * `<Link>` — `useLinkStatus` reads the pending state of its nearest
 * ancestor Link, set by React's `useTransition` under the hood while the
 * destination route's data is still loading (works together with, not
 * instead of, `loading.tsx` — this fires the instant the click happens,
 * `loading.tsx` covers the rest of the transition).
 */
export function LinkPendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="skeleton" aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", marginLeft: 6, display: "inline-block" }} />;
}

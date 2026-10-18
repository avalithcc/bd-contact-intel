"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LinkPendingDot } from "../../contacts/LinkPendingDot";

/**
 * A link of the Gmail fleet screen (the filter segments, "Actualizar", "Ver todos los BD") that shows a pending dot the instant
 * it is clicked, while the server re-reads the fleet. The page is dynamic, so a link to the same URL re-runs the read.
 */
export function FleetLink({ href, className, current, children }: { href: string; className?: string; current?: boolean; children: ReactNode }) {
  return (
    <Link href={href} className={className} aria-current={current ? "page" : undefined}>
      {children}
      <LinkPendingDot />
    </Link>
  );
}

import Link from "next/link";
import { WarningIcon } from "@/components/icons";

export interface SyncHealthBannerLabels {
  failing: string;
  stale: string;
  cta: string;
}

/**
 * Shell banner while Gmail is connected but not syncing (syncHealth.ts).
 * Reuses `.reconnect-banner` (design-system.css) — same warn-tinted strip,
 * no new class. Unlike ReconnectBanner it has no close button: dismissing
 * an outage notice is how a dead sync went unseen for six hours.
 */
export function SyncHealthBanner({ kind, labels: l }: { kind: "failing" | "stale"; labels: SyncHealthBannerLabels }) {
  return (
    <div className="reconnect-banner" role="alert">
      <WarningIcon className="icon" />
      <span className="grow">{kind === "failing" ? l.failing : l.stale}</span>
      <Link href="/account/email" className="btn btn-primary btn-sm">
        {l.cta}
      </Link>
    </div>
  );
}

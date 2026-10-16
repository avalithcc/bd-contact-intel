import Link from "next/link";
import { WarningIcon } from "@/components/icons";
import type { ConnectionBannerDecision } from "@/lib/gmail/connectionBanner";

export interface ConnectionBannerLabels {
  cta: string;
  strong: string;
  disconnectedLead: string;
  disconnectedTail: string;
  expiredLead: string;
  expiredTailSince: string;
  expiredTail: string;
  missingScopeLead: string;
  missingScopeTail: string;
  stale: string;
  staleCta: string;
  failing: string;
  failingCta: string;
}

/**
 * The one Gmail banner of the app shell (gmail-reconnect-banner mockup). WHAT
 * to show is decided by decideConnectionBanner() (src/lib/gmail/
 * connectionBanner.ts); this only renders it. Deliberately no close button:
 * a dismissible notice is how a dead sync went unseen. Red is the
 * `.reconnect-banner-danger` modifier of the existing amber `.reconnect-banner`.
 * `sinceText` is the pre-formatted "hace 3 horas" for the `expired` case.
 */
export function ConnectionBanner({
  decision,
  labels: l,
  sinceText,
}: {
  decision: ConnectionBannerDecision;
  labels: ConnectionBannerLabels;
  sinceText: string | null;
}) {
  if (decision.tone === "warn") {
    const failing = decision.reason === "failing";
    return (
      <div className="reconnect-banner" role="alert">
        <WarningIcon className="icon" />
        <span className="grow">{failing ? l.failing : l.stale}</span>
        <Link href="/account/email" className="btn btn-primary btn-sm">
          {failing ? l.failingCta : l.staleCta}
        </Link>
      </div>
    );
  }

  const copy =
    decision.reason === "disconnected"
      ? { lead: l.disconnectedLead, tail: l.disconnectedTail }
      : decision.reason === "missing_scope"
        ? { lead: l.missingScopeLead, tail: l.missingScopeTail }
        : { lead: l.expiredLead, tail: sinceText ? l.expiredTailSince.replace("{since}", sinceText) : l.expiredTail };

  return (
    <div className="reconnect-banner reconnect-banner-danger" role="alert">
      <WarningIcon className="icon" />
      <span className="grow">
        {copy.lead} <strong>{l.strong}</strong> {copy.tail}
      </span>
      <Link href="/account/email" className="btn btn-sm">
        {l.cta}
      </Link>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { CloseIcon, WarningIcon } from "@/components/icons";
import { dismissReconnectBannerAction } from "@/app/(app)/account/email/connectionActions";

export interface ReconnectBannerLabels {
  message: string;
  cta: string;
  closeAria: string;
}

/**
 * One-time reconnect banner (email-sync.html screen 4; README decision 5/6
 * — new `.reconnect-banner` component, built from `.alert` tokens). Shown
 * above every shell page while `shouldShowReconnectBanner()` says so
 * (src/lib/gmail/reconnectBannerState.ts); closing it calls
 * `dismissReconnectBannerAction`, which persists on `email_account` so it
 * never reappears on another device either.
 */
export function ReconnectBanner({ labels: l }: { labels: ReconnectBannerLabels }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="reconnect-banner" role="note">
      <WarningIcon className="icon" />
      <span className="grow">{l.message}</span>
      <Link href="/account/email" className="btn btn-primary btn-sm">
        {l.cta}
      </Link>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon close"
        aria-label={l.closeAria}
        onClick={() => {
          // Optimistic — the banner must not reappear even if the request
          // is still in flight when the BD navigates away.
          setDismissed(true);
          void dismissReconnectBannerAction();
        }}
      >
        <CloseIcon className="icon" />
      </button>
    </div>
  );
}

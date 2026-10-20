"use client";

import type { SendControlLabels } from "@/lib/sendSchedule/labels";
import { useInFlight } from "./useInFlight";

/**
 * A plain "Enviar ahora" (an approved card's, no choice of moment) with the same in-progress behaviour as the split button:
 * spinner and "Enviando…", disabled with `aria-busy` and ignoring repeated clicks, the leave-page confirmation and
 * `data-busy` (so a live refresh waits) until the call settles.
 */
export function SendNowButton({
  labels: l,
  label,
  className,
  disabled = false,
  title,
  onSend,
}: {
  labels: SendControlLabels;
  label: string;
  className: string;
  disabled?: boolean;
  title?: string;
  onSend: () => unknown;
}) {
  const flight = useInFlight();
  const working = flight.kind !== null;
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || working}
      aria-busy={working ? "true" : undefined}
      data-busy={working ? "true" : undefined}
      title={title}
      onClick={() => void flight.run("send", onSend)}
    >
      {working && <span className="spinner" aria-hidden="true" />}
      {working ? l.sending : label}
    </button>
  );
}

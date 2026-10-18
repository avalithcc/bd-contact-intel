"use client";

import { useTransition } from "react";
import { useToast } from "@/components/ToastProvider";
import { sendGmailReminderAction } from "./actions";

export interface SendReminderLabels {
  send: string;
  sendAria: string;
  sending: string;
  toastSent: string;
  errorSend: string;
  errorAlreadySent: string;
  errorNotEligible: string;
}

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

/**
 * "Enviar recordatorio" (mockups/estado-gmail-equipo.html): sends the BD's next connection reminder now. The server decides
 * everything (admin check, eligibility, the series, the audit row); this only calls the action and says what happened.
 */
export function SendReminderButton({ bdId, name, labels: l }: { bdId: string; name: string; labels: SendReminderLabels }) {
  const { showToast } = useToast();
  const [pending, start] = useTransition();

  function send() {
    start(async () => {
      let result: Awaited<ReturnType<typeof sendGmailReminderAction>>;
      try {
        result = await sendGmailReminderAction(bdId);
      } catch {
        result = { ok: false, reason: "send_failed" };
      }
      if (result.ok) showToast(fill(l.toastSent, { name, n: result.number }));
      else if (result.reason === "already_sent_today") showToast(fill(l.errorAlreadySent, { name }), "error");
      else if (result.reason === "send_failed") showToast(l.errorSend, "error");
      else showToast(fill(l.errorNotEligible, { name }), "error");
    });
  }

  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={send} disabled={pending} aria-busy={pending} aria-label={fill(l.sendAria, { name })}>
      {pending ? l.sending : l.send}
    </button>
  );
}

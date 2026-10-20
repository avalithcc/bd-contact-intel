import type { SendControlLabels } from "@/lib/sendSchedule/labels";
import type { SendRecipient } from "@/lib/sendSchedule/advice";
import type { ScheduleConfig } from "@/components/send/SchedulePopover";
import { miamiWhen, type SequenceLabels } from "@/lib/sequences/viewText";
import { resolveSequenceSend } from "@/lib/sequences/sendMoment";
import type { Schedule } from "@/lib/sequences/schedule";
import { MIAMI_ZONE } from "@/lib/sendSchedule/advice";
import { fillTemplate } from "@/lib/i18n/template";

/**
 * What the Sequence screen hands its send controls: the labels, the Sequence's cadence (for the "Según la cadencia" hint) and
 * the state of the last server call, so a failed schedule keeps its popover open with the reason.
 */
export interface SequenceSendContext {
  labels: SendControlLabels;
  schedule: Schedule;
  busy: boolean;
  error: string | null;
}

/** The popover's config for approving: Miami is the fallback zone, because the Sequences are sent from there. */
export function approvalSchedule(ctx: SequenceSendContext, recipients: readonly SendRecipient[], kind: "one" | "bulk", count = 1): ScheduleConfig {
  const l = ctx.labels;
  return {
    title: kind === "bulk" ? fillTemplate(l.popTitleBulk, { n: String(count) }) : l.popTitleApproval,
    submitLabel: kind === "bulk" ? fillTemplate(l.submitBulk, { n: String(count) }) : l.submitApproval,
    summary: kind === "bulk" ? "sumBulk" : "sumApproval",
    foot: kind === "bulk" ? l.footBulk : l.footApproval,
    recipients,
    fallbackZone: MIAMI_ZONE,
  };
}

/** The second line of the "Según la cadencia de la Secuencia" item: "mañana 20/10 a las 9:00 (Miami)". */
export function cadenceHint(now: Date, schedule: Schedule, l: SequenceLabels): string {
  const moment = resolveSequenceSend({ kind: "cadence" }, { now, schedule });
  if (!moment.ok) return "";
  const w = miamiWhen(moment.scheduledFor, now);
  const day = w.day === "today" ? l.whenToday : w.day === "tomorrow" ? l.whenTomorrow : l.whenOn;
  return `${day} ${w.ddmm} ${l.atTime} ${w.hhmm} ${l.reviewMiami}`;
}

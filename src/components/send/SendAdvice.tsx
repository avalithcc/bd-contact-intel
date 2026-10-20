"use client";

import { WarningIcon } from "@/components/icons";
import { Tooltip } from "@/components/Tooltip";
import { fillTemplate } from "@/lib/i18n/template";
import type { Advice } from "@/lib/sendSchedule/advice";
import { summaryLine, type Slot } from "@/lib/sendSchedule/time";
import type { SendControlLabels } from "@/lib/sendSchedule/labels";

/** The sentence of the disclaimer, shared by the popover and the note beside "Enviar ahora". */
function adviceText(l: SendControlLabels, advice: Advice): string {
  if (advice.kind === "bulk") return fillTemplate(l.adviceBulk, { n: String(advice.n), total: String(advice.total) });
  const weekday = l[`wd${advice.weekday}` as "wd0"];
  if (advice.kind === "miami") return fillTemplate(l.adviceMiami, { clock: advice.clock, weekday });
  return fillTemplate(l.adviceKnown, { name: advice.name.split(" ")[0] ?? advice.name, place: advice.place, clock: advice.clock, weekday });
}

/**
 * Non-blocking warning (owner rule 2026-10-19): the recipient's local time is before 9:00 or on a weekend. It never disables
 * anything; with `onUse` it offers 9:00 of the next business day, in the recipient's time, as one click.
 */
export function SendAdvice({ labels: l, advice, onUse }: { labels: SendControlLabels; advice: Advice; onUse?: (slot: Slot) => void }) {
  const suggestion = advice.kind === "bulk" ? null : advice.suggestion;
  const label = !suggestion || advice.kind === "bulk" ? "" : fillTemplate(advice.kind === "miami" ? l.useSuggestionMiami : l.useSuggestionKnown, { when: summaryLine(suggestion.slot), name: advice.kind === "single" ? (advice.name.split(" ")[0] ?? advice.name) : "" });
  return (
    <div className="alert alert-warn sched-sum" role="status">
      <WarningIcon className="icon" />
      <div>
        <strong>{adviceText(l, advice)}</strong>
        {suggestion && onUse && (
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: "var(--space-sm)" }} onClick={() => onUse(suggestion.slot)}>
            {label}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The compact form for tight rows (member card, bulk bar, dialog footers): a one-line warn badge, with the full sentence in the
 * shared tooltip. The "Usar ..." suggestion lives only in the schedule popover, where there is room for it.
 */
export function SendAdviceChip({ labels: l, advice }: { labels: SendControlLabels; advice: Advice }) {
  const text =
    advice.kind === "bulk"
      ? fillTemplate(l.adviceChipBulk, { n: String(advice.n), total: String(advice.total) })
      : fillTemplate(advice.kind === "miami" ? l.adviceChipMiami : l.adviceChipKnown, {
          clock: advice.clock,
          weekday: l[`wd${advice.weekday}` as "wd0"],
          name: advice.kind === "single" ? (advice.name.split(" ")[0] ?? advice.name) : "",
        });
  return (
    <span className="advice-chip">
      <Tooltip title={l.adviceTipTitle} body={adviceText(l, advice)} actionLabel="" align="end">
        <span className="badge badge-warn no-dot" role="status">
          <WarningIcon className="icon" />
          {text}
        </span>
      </Tooltip>
    </span>
  );
}

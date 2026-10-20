"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarMonth } from "@/components/calendar/CalendarMonth";
import { ClockIcon } from "@/components/icons";
import { fillTemplate } from "@/lib/i18n/template";
import { isDayOutside, monthIndex, monthOf, moveDayWithin, shiftMonth, type Ym } from "@/lib/reports/rangeCalendar";
import { buildAdvice, type SendRecipient } from "@/lib/sendSchedule/advice";
import { parseTimeInput, quarterHourOptions, schedulePresets, slotInstant, slotState, summaryLine, type Slot, type SlotState } from "@/lib/sendSchedule/time";
import type { SendControlLabels } from "@/lib/sendSchedule/labels";
import { buildGroupRows, buildZoneRows, type ZoneRow } from "@/lib/sendSchedule/zones";
import { addDaysToDateString, argentinaCalendarDate } from "@/lib/tasks/argentinaDate";
import { SendAdvice } from "./SendAdvice";


export interface ScheduleConfig {
  title: string;
  submitLabel: string;
  /** Which summary sentence: one email, one approval, or several. */
  summary: "sumEmail" | "sumApproval" | "sumBulk";
  foot: string;
  recipients: readonly SendRecipient[];
  /** Zone a recipient with no known place is judged in: Miami for Sequences, null for a one-off email. */
  fallbackZone: string | null;
  /** The slot the popover opens on (a scheduled moment being changed); tomorrow 9:00 otherwise. */
  initial?: Slot | null;
  /** Extra alert above the foot, e.g. the daily-cap outlook of a bulk approval. */
  notice?: ReactNode;
  /** Why this cannot be scheduled at all (e.g. attachments the server cannot read back): shown as a warning, submit disabled. */
  blockedReason?: string | null;
}

const FIXED_LABEL = { newYork: "rowNewYork", madrid: "rowMadrid", mexicoCity: "rowMexicoCity", bogota: "rowBogota", saoPaulo: "rowSaoPaulo" } as const;
const OPTIONS = quarterHourOptions();
const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"]);
const REFUSAL: Partial<Record<SlotState, "timeInvalid" | "tooSoon" | "tooFar" | "past">> = { invalid_time: "timeInvalid", too_soon: "tooSoon", too_far: "tooFar", past: "past" };

/**
 * The date-and-time popover shared by the contact composer and Sequences (mockup enviar-o-programar.html, section 2): a
 * single-day calendar (the report period picker's, in single mode), a typed time with a 15-minute list, shortcuts, the
 * time-zone reference and a plain-language summary. Everything is Argentina time; the server converts the value with
 * argentinaWallClockToUtc. It only proposes a slot: the caller submits it and decides what an error means.
 */
export function SchedulePopover({
  labels: l,
  config,
  placement,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  labels: SendControlLabels;
  config: ScheduleConfig;
  placement: "up" | "down";
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (slot: Slot) => void;
}) {
  const ids = useId();
  const [now] = useState(() => new Date());
  const today = argentinaCalendarDate(now);
  const maxDay = addDaysToDateString(today, 30);
  const presets = schedulePresets(now);
  const [slot, setSlot] = useState<Slot>(config.initial ?? presets.tomorrow);
  const [text, setText] = useState(slot.time);
  const [view, setView] = useState<Ym>(() => monthOf(slot.date));
  const [focusDay, setFocusDay] = useState(slot.date);
  const moveFocus = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const typed = parseTimeInput(text);
  const state: SlotState = typed ? slotState({ date: slot.date, time: typed }, { now }) : "invalid_time";
  const valid = state === "ok";
  const instant = typed ? slotInstant({ date: slot.date, time: typed }) : null;
  const refusal = REFUSAL[state];

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, view]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".sel")?.scrollIntoView({ block: "nearest" });
  }, [slot.date, slot.time]);

  const choose = (next: Slot) => {
    setSlot(next);
    setText(next.time);
    setView(monthOf(next.date));
    setFocusDay(next.date);
  };
  const onDayKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, day: string) => {
    if (!NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    const next = moveDayWithin(day, e.key, today, maxDay);
    setView(monthOf(next));
    moveFocus.current = true;
    setFocusDay(next);
  };

  const rows: ZoneRow[] = !instant
    ? []
    : config.recipients.length > 1
      ? buildGroupRows(instant, config.recipients.flatMap((r) => (r.zone ? [r.zone] : [])))
      : buildZoneRows(instant, config.recipients[0]?.zone ?? null);
  const advice = instant ? buildAdvice(instant, config.recipients, config.fallbackZone) : null;
  const rowLabel = (row: ZoneRow): string => {
    if (row.key === "argentina") return l.rowArgentina;
    if (row.key === "recipient") {
      const r = config.recipients[0]!;
      return fillTemplate(l.rowRecipient, { name: r.name.split(" ")[0] ?? r.name, place: r.zone?.place ?? "" });
    }
    if (row.key === "recipients") return fillTemplate(l.rowRecipients, { areas: row.areas.join(" / "), n: String(row.count) });
    return l[FIXED_LABEL[row.key]];
  };
  const dayTag = (shift: number) => (shift > 0 ? l.dayPlus : shift < 0 ? l.dayMinus : null);
  const badge = (row: ZoneRow) => {
    if (row.key === "argentina") return <span className="badge badge-neutral no-dot">{l.yourTime}</span>;
    if (row.key !== "recipient" && row.key !== "recipients") return null;
    return row.warn ? <span className="badge badge-warn no-dot">{l.badgeEarly} / {l.badgeWeekend}</span> : <span className="badge badge-neutral no-dot">{l.badgeOk}</span>;
  };

  return (
    <div ref={rootRef} className={`pop pop-sched ${placement}`} role="dialog" aria-modal="false" aria-labelledby={`${ids}-t`}>
      <div className="pop-title" id={`${ids}-t`}>
        <ClockIcon className="icon" />
        {config.title}
      </div>
      <div className="row wrap" role="group" aria-label={l.presetsLabel}>
        {(
          [
            ["presetHour", presets.hour],
            ["presetTomorrow", presets.tomorrow],
            ["presetMonday", presets.monday],
          ] as const
        ).map(([key, preset]) => (
          <button key={key} type="button" className="chip" aria-pressed={typed === preset.time && slot.date === preset.date} onClick={() => choose(preset)}>
            {l[key]}
          </button>
        ))}
      </div>
      <div className="sched-cols">
        <CalendarMonth
          ym={view}
          today={today}
          focusDay={focusDay}
          prev={{ label: l.calPrev, onClick: () => setView(shiftMonth(view, -1)), disabled: monthIndex(view) <= monthIndex(monthOf(today)) }}
          next={{ label: l.calNext, onClick: () => setView(shiftMonth(view, 1)), disabled: monthIndex(view) >= monthIndex(monthOf(maxDay)) }}
          isDisabled={(day) => isDayOutside(day, today, maxDay)}
          stateOf={(day) => (day === slot.date ? "single" : null)}
          onPick={(day) => choose({ date: day, time: typed ?? slot.time })}
          onFocusDay={setFocusDay}
          onDayKeyDown={onDayKeyDown}
        />
        <div className="sched-side">
          <div className="field">
            <label className="label" htmlFor={`${ids}-time`}>
              {l.timeLabel}
            </label>
            <input
              id={`${ids}-time`}
              className="input"
              value={text}
              inputMode="numeric"
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${ids}-list`}
              aria-invalid={!valid || undefined}
              aria-describedby={`${ids}-help`}
              onChange={(e) => {
                setText(e.target.value);
                const parsed = parseTimeInput(e.target.value);
                if (parsed) setSlot({ ...slot, time: parsed });
              }}
            />
            <p id={`${ids}-help`} className={refusal ? "help help-warn" : "help"}>
              {refusal ? l[refusal] : l.timeHelp}
            </p>
          </div>
          <div id={`${ids}-list`} ref={listRef} className="tlist" role="listbox" aria-label={l.timeListLabel}>
            {OPTIONS.map((option) => {
              const off = slotState({ date: slot.date, time: option }, { now }) !== "ok";
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={option === typed}
                  aria-disabled={off || undefined}
                  disabled={off}
                  tabIndex={-1}
                  className={["topt", option === typed ? "sel" : "", off ? "off" : ""].filter(Boolean).join(" ")}
                  onClick={() => choose({ date: slot.date, time: option })}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="tz" aria-label={l.refLabel}>
          <div className="tz-head">
            <span className="label">{l.refTitle}</span>
            <span className="meta">{l.refNote}</span>
          </div>
          <div className="tz-grid">
            {rows.map((row, i) => (
              <div key={`${row.key}-${i}`} className={["tz-row", row.key === "argentina" ? "base" : "", row.warn ? "warn" : ""].filter(Boolean).join(" ")}>
                <span className="tz-name">
                  {rowLabel(row)}
                  {row.approx && ` · ${l.approx}`} {badge(row)}
                </span>
                <span className="tz-time">
                  {dayTag(row.dayShift) && <span className="tz-day">{dayTag(row.dayShift)} </span>}
                  {row.clocks.join(" / ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {valid && (
        <div className="alert alert-neutral sched-sum" aria-live="polite">
          <div>
            <Summary template={l[config.summary]} when={summaryLine({ date: slot.date, time: typed! })} />
          </div>
        </div>
      )}
      {valid && instant && advice && <SendAdvice labels={l} advice={advice} onUse={(s) => choose(s)} />}
      {config.notice}
      {config.blockedReason && (
        <div className="alert alert-warn sched-sum" role="alert">
          <div>{config.blockedReason}</div>
        </div>
      )}
      {error && (
        <div className="alert alert-warn sched-sum" role="alert">
          <div>{error}</div>
        </div>
      )}
      <div className="pop-foot">
        <span className="meta">{config.foot}</span>
        <span className="row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {l.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!valid || busy || !!config.blockedReason} onClick={() => onSubmit({ date: slot.date, time: typed! })}>
            {config.submitLabel}
          </button>
        </span>
      </div>
    </div>
  );
}

/** "It will be sent on {when} (…)" with the moment in bold, as in the mockup. */
function Summary({ template, when }: { template: string; when: string }) {
  const [before, after] = template.split("{when}");
  return (
    <>
      {before}
      <strong>{when}</strong>
      {after}
    </>
  );
}

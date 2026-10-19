"use client";

import { DOW_SHORT, MONTH_NAMES, dayLabel, monthCells, type DayState, type Ym } from "@/lib/reports/rangeCalendar";

/**
 * One month of the shared calendar: header with optional previous / next arrows, the Monday-first grid and the day buttons.
 * Used by the report period picker (two months, a range) and by the schedule popover (one month, a single day), so both look
 * and behave the same. It owns no state: the caller decides which days are disabled, how each one is drawn and what a click
 * or a key does. The `day` class resets the global button padding (design-system.css), which is what keeps seven columns in
 * 15.5rem.
 */
export function CalendarMonth({
  ym,
  today,
  focusDay,
  prev,
  next,
  isDisabled,
  stateOf,
  onPick,
  onHover,
  onFocusDay,
  onDayKeyDown,
}: {
  ym: Ym;
  today: string;
  focusDay: string;
  /** Arrow buttons; omit one to leave an empty slot so the title stays centered. */
  prev?: { label: string; onClick: () => void; disabled?: boolean };
  next?: { label: string; onClick: () => void; disabled?: boolean };
  isDisabled: (day: string) => boolean;
  stateOf: (day: string) => DayState;
  onPick: (day: string) => void;
  onHover?: (day: string | null) => void;
  onFocusDay: (day: string) => void;
  onDayKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, day: string) => void;
}) {
  const arrow = (side: { label: string; onClick: () => void; disabled?: boolean } | undefined, glyph: string) =>
    side ? (
      <button type="button" className="cal-nav" aria-label={side.label} disabled={side.disabled} onClick={side.onClick}>
        {glyph}
      </button>
    ) : (
      <span className="cal-nav" />
    );
  const title = MONTH_NAMES[ym.m - 1]!.charAt(0).toUpperCase() + MONTH_NAMES[ym.m - 1]!.slice(1);
  return (
    <div className="cal">
      <div className="cal-head">
        {arrow(prev, "‹")}
        <strong>
          {title} {ym.y}
        </strong>
        {arrow(next, "›")}
      </div>
      <div className="cal-grid" role="group" aria-label={`${MONTH_NAMES[ym.m - 1]} ${ym.y}`} onMouseLeave={() => onHover?.(null)}>
        {DOW_SHORT.map((d) => (
          <span className="dow" key={d} aria-hidden="true">
            {d}
          </span>
        ))}
        {monthCells(ym.y, ym.m).map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />;
          const disabled = isDisabled(day);
          const state = stateOf(day);
          const cls = ["day", disabled ? "off" : "", day === today ? "today" : "", state ? `st-${state}` : ""].filter(Boolean).join(" ");
          return (
            <button
              key={day}
              type="button"
              className={cls}
              data-day={day}
              tabIndex={day === focusDay ? 0 : -1}
              aria-label={dayLabel(day)}
              aria-disabled={disabled || undefined}
              aria-pressed={state === "start" || state === "end" || state === "single" || state === "in"}
              aria-current={day === today ? "date" : undefined}
              onMouseEnter={() => !disabled && onHover?.(day)}
              onFocus={() => onFocusDay(day)}
              onKeyDown={(e) => onDayKeyDown(e, day)}
              onClick={() => !disabled && onPick(day)}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { CustomRange, ReportPeriod } from "@/lib/reports/period";
import { buildReportsHref } from "@/lib/reports/reportsHref";
import {
  DOW_SHORT,
  MONTH_NAMES,
  dayLabel,
  dayState,
  describeRange,
  isDayDisabled,
  monthCells,
  moveDay,
  pickDay,
  shiftMonth,
  type DaySelection,
} from "@/lib/reports/rangeCalendar";

export type PeriodPickerLabels = ClientStrings<
  Pick<
    Dictionary["reports"],
    | "periodFilterLabel"
    | "periodWeek"
    | "periodMonth"
    | "periodLastMonth"
    | "periodCustom"
    | "periodCustomLabel"
    | "periodCustomClear"
    | "calendarPrev"
    | "calendarNext"
    | "calendarCancel"
    | "calendarApply"
    | "calendarPickEnd"
    | "calendarMaxDays"
  >
>;

const PRESETS = [
  ["week", "periodWeek"],
  ["month", "periodMonth"],
  ["last_month", "periodLastMonth"],
] as const;

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"]);

type Ym = { y: number; m: number };

function monthOf(day: string): Ym {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) };
}

function monthIndex(ym: Ym): number {
  return ym.y * 12 + ym.m;
}

/**
 * The period control of /admin/reports: three presets and "Personalizado", which opens a two-month range calendar (click the
 * first day, then the last). The applied range lives in the URL (`period=custom&from=&to=`) so it can be shared; the × goes back
 * to "Este mes". `today` is the ART calendar date, computed on the server so the first paint matches the data. All the date
 * logic is in src/lib/reports/rangeCalendar.ts.
 */
export function PeriodPicker({
  period,
  bdId,
  custom,
  customLabel,
  today,
  labels: l,
}: {
  period: ReportPeriod;
  bdId: string | null;
  custom: CustomRange | null;
  /** The applied custom range as text ("1 oct – 19 oct 2026"), shown on the control. */
  customLabel: string;
  today: string;
  labels: PeriodPickerLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<DaySelection>({ start: null, end: null });
  const [hover, setHover] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState(today);
  const [view, setView] = useState<Ym>(() => shiftMonth(monthOf(today), -1)); // the left month; the right one is view + 1
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);

  const openCalendar = () => {
    const initial: DaySelection = custom ? { start: custom.from, end: custom.to } : { start: null, end: null };
    const anchorDay = custom?.to ?? today;
    setSel(initial);
    setHover(null);
    setFocusDay(anchorDay);
    setView(shiftMonth(monthOf(anchorDay), -1));
    moveFocus.current = true;
    setOpen(true);
  };

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay, view]);

  // Moves the visible months and keeps exactly one day cell tabbable: the focused day if still visible, else the first pickable one.
  const goToView = (next: Ym) => {
    const idx = monthIndex(monthOf(focusDay));
    if (idx < monthIndex(next) || idx > monthIndex(next) + 1) {
      const after = shiftMonth(next, 1);
      const visible = [...monthCells(next.y, next.m), ...monthCells(after.y, after.m)];
      const pending = sel.start !== null && sel.end === null ? sel.start : null;
      const first = visible.find((d): d is string => d !== null && !isDayDisabled(d, today, pending));
      if (first) setFocusDay(first);
    }
    setView(next);
  };

  const anchor = sel.start !== null && sel.end === null ? sel.start : null;
  const right = shiftMonth(view, 1);

  const onDayKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, day: string) => {
    if (!NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    const next = moveDay(day, e.key, today);
    const idx = monthIndex(monthOf(next));
    if (idx < monthIndex(view)) setView(monthOf(next));
    else if (idx > monthIndex(right)) setView(shiftMonth(monthOf(next), -1));
    moveFocus.current = true;
    setFocusDay(next);
  };

  const apply = () => {
    if (!sel.start || !sel.end) return;
    close(false);
    router.push(buildReportsHref("custom", bdId, { from: sel.start, to: sel.end }));
  };

  const renderMonth = (ym: Ym, nav: "prev" | "next") => (
    <div className="cal" key={`${ym.y}-${ym.m}`}>
      <div className="cal-head">
        {nav === "prev" ? (
          <button type="button" className="cal-nav" aria-label={l.calendarPrev} onClick={() => goToView(shiftMonth(view, -1))}>
            ‹
          </button>
        ) : (
          <span className="cal-nav" />
        )}
        <strong>
          {MONTH_NAMES[ym.m - 1]!.charAt(0).toUpperCase() + MONTH_NAMES[ym.m - 1]!.slice(1)} {ym.y}
        </strong>
        {nav === "next" ? (
          <button
            type="button"
            className="cal-nav"
            aria-label={l.calendarNext}
            disabled={monthIndex(right) >= monthIndex(monthOf(today))}
            onClick={() => goToView(shiftMonth(view, 1))}
          >
            ›
          </button>
        ) : (
          <span className="cal-nav" />
        )}
      </div>
      <div className="cal-grid" role="group" aria-label={`${MONTH_NAMES[ym.m - 1]} ${ym.y}`} onMouseLeave={() => setHover(null)}>
        {DOW_SHORT.map((d) => (
          <span className="dow" key={d} aria-hidden="true">
            {d}
          </span>
        ))}
        {monthCells(ym.y, ym.m).map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />;
          const disabled = isDayDisabled(day, today, anchor);
          const state = dayState(day, sel, hover);
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
              onMouseEnter={() => !disabled && setHover(day)}
              onFocus={() => setFocusDay(day)}
              onKeyDown={(e) => onDayKeyDown(e, day)}
              onClick={() => {
                if (disabled) return;
                setSel(pickDay(sel, day));
                setHover(null);
              }}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );

  const customActive = period === "custom" && custom !== null;
  const footText = sel.start ? (sel.end ? describeRange(sel.start, sel.end) : `${describeRange(sel.start, null)} ${l.calendarPickEnd} · ${l.calendarMaxDays}`) : "";

  return (
    <div className="anchor" ref={rootRef}>
      <div className="segmented" role="group" aria-label={l.periodFilterLabel}>
        {PRESETS.map(([key, labelKey]) => (
          <Link key={key} href={buildReportsHref(key, bdId)} className={period === key ? "on" : ""} aria-current={period === key ? "page" : undefined}>
            {l[labelKey]}
          </Link>
        ))}
        {customActive ? (
          <span className="on seg-x">
            <button type="button" ref={triggerRef} aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close(false) : openCalendar())}>
              {customLabel}
            </button>
            <button type="button" className="x" aria-label={l.periodCustomClear} onClick={() => router.push(buildReportsHref("month", bdId))}>
              ×
            </button>
          </span>
        ) : (
          <button type="button" ref={triggerRef} aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close(false) : openCalendar())}>
            {l.periodCustom} ▾
          </button>
        )}
      </div>
      {open && (
        <div
          className="pop"
          role="dialog"
          aria-label={l.periodCustomLabel}
          onBlur={(e) => {
            // Focus left the popover for somewhere outside it (the trigger handles itself on click); a null target is a click on a
            // non-focusable spot, which the document pointerdown listener already tells apart.
            const to = e.relatedTarget as Node | null;
            if (to && !rootRef.current?.contains(to)) close(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close(true);
            }
          }}
        >
          <div className="cal-two">
            {renderMonth(view, "prev")}
            {renderMonth(right, "next")}
          </div>
          <div className="pop-foot">
            <span className="meta" aria-live="polite">
              {footText}
            </span>
            <span className="row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => close(true)}>
                {l.calendarCancel}
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!sel.start || !sel.end} onClick={apply}>
                {l.calendarApply}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

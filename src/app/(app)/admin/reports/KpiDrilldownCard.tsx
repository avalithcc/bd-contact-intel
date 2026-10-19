"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { drilldownTruncation, fillTruncationNote } from "@/lib/reports/drilldownLimit";

export type DrilldownFetchResult<T> = { ok: true; rows: T[] } | { ok: false };

type LoadState<T> = { status: "idle" | "loading" | "error" | "ready"; rows: T[] };
type KeyedState<T> = LoadState<T> & { key: string };

/** Plain strings only (ClientStrings): `template` carries `{shown}`/`{total}`. */
export type TruncationLabels = { template: string; numberLocale: string };

/**
 * Open/closed + on-demand list state shared by every drill-down trigger on
 * /admin/reports (tiles and funnel rows). The list is fetched via `fetchRows`
 * (a server action) only when the dialog opens, so this never adds a round
 * trip to the page's own load (PERFORMANCE.md).
 *
 * Rows are cached ONLY for the given `cacheKey` (see drilldownCacheKey): when
 * the period or BD filter changes the key changes, the cached rows are
 * dropped and the next open refetches. A response that arrives after the key
 * moved on is discarded.
 */
export function useDrilldown<T>(cacheKey: string, fetchRows: () => Promise<DrilldownFetchResult<T>>) {
  const [open, setOpen] = useState(false);
  const [keyed, setKeyed] = useState<KeyedState<T>>({ key: cacheKey, status: "idle", rows: [] });
  const latestKey = useRef(cacheKey);
  latestKey.current = cacheKey;

  // Rows fetched under a different key are never exposed.
  const state: LoadState<T> = keyed.key === cacheKey ? keyed : { status: "idle", rows: [] };

  function openDialog() {
    setOpen(true);
    if (state.status === "ready" || state.status === "loading") return;
    const key = cacheKey;
    const settle = (next: LoadState<T>) => {
      if (latestKey.current === key) setKeyed({ key, ...next });
    };
    setKeyed({ key, status: "loading", rows: [] });
    fetchRows()
      .then((res) => settle(res.ok ? { status: "ready", rows: res.rows } : { status: "error", rows: [] }))
      .catch(() => settle({ status: "error", rows: [] }));
  }

  return { open, openDialog, close: () => setOpen(false), state };
}

/**
 * The drill-down Dialog itself. When the list was cut by the row cap
 * (`drilldownTruncation`), a pinned footer note says so and `total` — the
 * KPI's own count — stays the true number (reports-kpi-drilldown: the first
 * two dialogs used to cut at 500 silently).
 */
export function DrilldownDialog<T>({
  state,
  onClose,
  title,
  subtitle,
  xwide = false,
  total,
  truncation,
  closeLabel,
  loadingLabel,
  errorLabel,
  renderList,
}: {
  state: LoadState<T>;
  onClose: () => void;
  title: string;
  /** Rendered right under the title, before the loading/error/list state —
   * page-level context (e.g. "current snapshot, not period data") that
   * must show even while the list is still loading. */
  subtitle?: React.ReactNode;
  xwide?: boolean;
  total: number;
  truncation: TruncationLabels;
  closeLabel: string;
  loadingLabel: string;
  errorLabel: string;
  renderList: (rows: T[]) => React.ReactNode;
}) {
  const cut = state.status === "ready" ? drilldownTruncation(state.rows.length, total) : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      wide
      xwide={xwide}
      footer={
        <>
          {cut && <span className="meta left">{fillTruncationNote(truncation.template, cut.shown, cut.total, truncation.numberLocale)}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {closeLabel}
          </button>
        </>
      }
    >
      {subtitle && <p className="meta mb-md">{subtitle}</p>}
      {state.status === "loading" && <p className="meta">{loadingLabel}</p>}
      {state.status === "error" && <p className="meta">{errorLabel}</p>}
      {state.status === "ready" && renderList(state.rows)}
    </Dialog>
  );
}

/**
 * Shared "clickable KPI stat → Dialog with an on-demand list" shell for
 * "Empresas ganadas"/"Reuniones realizadas" (reports-bd-filter-drilldown) and
 * "Tasa de respuesta" (reports-kpi-drilldown).
 *
 * `value` is the count of rows behind the tile; `displayValue` overrides what
 * the tile shows when that differs (the reply-rate tile shows "28%" or
 * "3 / 7" but drills into its numerator's persons).
 *
 * At `value < 1` the card renders as a plain (non-interactive) `.stat` div,
 * same markup/classes as every other KPI card on this page — there is
 * nothing to drill into, so it must not look clickable.
 */
export function KpiDrilldownCard<T>({
  toneClass,
  label,
  value,
  displayValue,
  foot,
  dialogTitle,
  dialogSubtitle,
  xwide,
  truncation,
  closeLabel,
  loadingLabel,
  errorLabel,
  cacheKey,
  fetchRows,
  renderList,
}: {
  toneClass: string;
  label: string;
  value: number;
  displayValue?: React.ReactNode;
  foot: React.ReactNode;
  dialogTitle: string;
  dialogSubtitle?: React.ReactNode;
  xwide?: boolean;
  truncation: TruncationLabels;
  closeLabel: string;
  loadingLabel: string;
  errorLabel: string;
  /** Required: everything `fetchRows` depends on (see drilldownCacheKey). */
  cacheKey: string;
  fetchRows: () => Promise<DrilldownFetchResult<T>>;
  renderList: (rows: T[]) => React.ReactNode;
}) {
  const { open, openDialog, close, state } = useDrilldown(cacheKey, fetchRows);
  const clickable = value >= 1;

  const body = (
    <>
      <div className="label">{label}</div>
      <div className="value">{displayValue ?? value}</div>
      <div className="foot">{foot}</div>
    </>
  );

  return (
    <>
      {clickable ? (
        <button type="button" className={`stat ${toneClass} stat-clickable`} onClick={openDialog}>
          {body}
        </button>
      ) : (
        <div className={`stat ${toneClass}`}>{body}</div>
      )}
      {clickable && open && (
        <DrilldownDialog
          state={state}
          onClose={close}
          title={dialogTitle}
          subtitle={dialogSubtitle}
          xwide={xwide}
          total={value}
          truncation={truncation}
          closeLabel={closeLabel}
          loadingLabel={loadingLabel}
          errorLabel={errorLabel}
          renderList={renderList}
        />
      )}
    </>
  );
}

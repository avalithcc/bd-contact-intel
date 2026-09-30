"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";

export type DrilldownFetchResult<T> = { ok: true; rows: T[] } | { ok: false };

type LoadState<T> = { status: "idle" | "loading" | "error" | "ready"; rows: T[] };

/**
 * Shared "clickable KPI stat → Dialog with an on-demand list" shell for
 * "Empresas ganadas"/"Reuniones agendadas" (reports-bd-filter-drilldown).
 * The list is fetched via `fetchRows` (a server action) only the FIRST time
 * the dialog opens — cached in state afterward — so this never adds a
 * round trip to the page's own load (PERFORMANCE.md).
 *
 * At `value < 1` the card renders as a plain (non-interactive) `.stat` div,
 * same markup/classes as every other KPI card on this page — there is
 * nothing to drill into, so it must not look clickable.
 */
export function KpiDrilldownCard<T>({
  toneClass,
  label,
  value,
  foot,
  dialogTitle,
  closeLabel,
  loadingLabel,
  errorLabel,
  fetchRows,
  renderList,
}: {
  toneClass: string;
  label: string;
  value: number;
  foot: React.ReactNode;
  dialogTitle: string;
  closeLabel: string;
  loadingLabel: string;
  errorLabel: string;
  fetchRows: () => Promise<DrilldownFetchResult<T>>;
  renderList: (rows: T[]) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState<T>>({ status: "idle", rows: [] });
  const clickable = value >= 1;

  function handleOpen() {
    setOpen(true);
    if (state.status === "ready" || state.status === "loading") return;
    setState({ status: "loading", rows: [] });
    fetchRows()
      .then((res) => setState(res.ok ? { status: "ready", rows: res.rows } : { status: "error", rows: [] }))
      .catch(() => setState({ status: "error", rows: [] }));
  }

  const body = (
    <>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="foot">{foot}</div>
    </>
  );

  return (
    <>
      {clickable ? (
        <button type="button" className={`stat ${toneClass} stat-clickable`} onClick={handleOpen}>
          {body}
        </button>
      ) : (
        <div className={`stat ${toneClass}`}>{body}</div>
      )}
      {clickable && open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={dialogTitle}
          wide
          footer={
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              {closeLabel}
            </button>
          }
        >
          {state.status === "loading" && <p className="meta">{loadingLabel}</p>}
          {state.status === "error" && <p className="meta">{errorLabel}</p>}
          {state.status === "ready" && renderList(state.rows)}
        </Dialog>
      )}
    </>
  );
}

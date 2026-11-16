"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ToastProvider";
import { ChevronDownIcon, CloseIcon, UsersIcon } from "@/components/icons";
import { fillTemplate } from "@/lib/i18n/template";
import { roleGroupLeftOutCount } from "@/lib/followUp/roleGroupPreference";
import type { RoleGroupRow, RoleGroupsLabels } from "@/lib/followUp/roleGroupPanelProps";
import type { RoleGroupKey } from "@/lib/roleGroups";
import { getFollowUpRoleGroupCountsAction, saveFollowUpRoleGroupsAction } from "./actions";

// Re-exported so the page can keep importing the panel's prop types from the panel itself.
export type { RoleGroupRow, RoleGroupsLabels };

/**
 * "Roles a seguir" (follow-up-role-groups mockup): which role groups may take one of the 10 daily slots. Saving changes who ENTERS the
 * next daily build only (the page shows the "Aplica desde mañana" note), so the panel holds a local draft and writes once on "Guardar".
 * The server re-validates every key and rejects an all-excluded list; the disabled "Guardar" is only the client half of that rule.
 * The parent keys this component by the saved list, so a save remounts it onto fresh props (and closes the menu).
 */
export function RoleGroupsPanel({ rows, excluded, labels }: { rows: RoleGroupRow[]; excluded: string[]; labels: RoleGroupsLabels }) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<string[]>(excluded);
  const [busy, setBusy] = useState(false);
  // Per-group due counts, fetched once per OPEN (the aggregate is too costly for every page load). Decoration only: null while loading
  // or if the read failed, and nothing below gates on it.
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const included = rows.length - draft.length;

  function onToggleOpen(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open) return;
    setCounts(null);
    getFollowUpRoleGroupCountsAction().then(setCounts, () => setCounts(null));
  }

  function toggle(key: string, checked: boolean) {
    setDraft((d) => (checked ? d.filter((k) => k !== key) : d.includes(key) ? d : [...d, key]));
  }

  async function save(next: string[]) {
    setBusy(true);
    try {
      const res = await saveFollowUpRoleGroupsAction(next);
      showToast(res.ok ? labels.savedToast : labels.saveError, res.ok ? "success" : "error");
    } catch {
      showToast(labels.saveError, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="dropdown" onToggle={onToggleOpen}>
      <summary className="btn btn-secondary">
        <UsersIcon className="icon" />
        {labels.trigger}
        {excluded.length > 0 && <span className="badge badge-neutral no-dot">{excluded.length}</span>}
        <ChevronDownIcon className="icon" />
      </summary>
      <div className="menu left" style={{ width: "30rem" }}>
        <div className="menu-label">{labels.heading}</div>
        <p className="meta" style={{ padding: "0 var(--space-sm) var(--space-sm)" }}>
          {labels.intro}
        </p>
        <div className="menu-sep" />
        {rows.map((r) => (
          <label className="check" key={r.key}>
            <input type="checkbox" checked={!draft.includes(r.key)} disabled={busy} onChange={(e) => toggle(r.key, e.target.checked)} />
            <span className="grow">{r.label}</span>
            <span className={r.priorityClass}>{r.priorityLabel}</span>
            <span className="meta" style={{ marginLeft: "var(--space-sm)", minWidth: "2.5rem", textAlign: "right" }}>
              {counts ? (counts[r.key as RoleGroupKey] ?? 0) : <span className="skeleton" role="status" style={{ display: "inline-block", width: "1.5rem" }} aria-label={labels.countsLoading} />}
            </span>
          </label>
        ))}
        {counts && excluded.length > 0 && (
          <p className="meta" style={{ padding: "var(--space-sm) var(--space-sm) 0" }}>
            {fillTemplate(labels.leftOutMeta, {
              n: String(roleGroupLeftOutCount(counts as Record<RoleGroupKey, number>, excluded)),
            })}
          </p>
        )}
        <div className="menu-sep" />
        <div className="row between menu-footer">
          <Link className="btn btn-ghost btn-sm" href="/playbook">
            {labels.guideLink}
          </Link>
          <div className="row" style={{ gap: "var(--space-sm)" }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy || draft.length === 0} onClick={() => setDraft([])}>
              {labels.reset}
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || included < 1} onClick={() => save(draft)}>
              {busy ? labels.saving : labels.save}
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}

/** One active exclusion as a chip; its "x" saves the list without that group (server-validated like the panel). */
export function ExcludedRoleGroupChips({
  rows,
  excluded,
  labels,
}: {
  rows: RoleGroupRow[];
  excluded: string[];
  labels: Pick<RoleGroupsLabels, "chipKey" | "chipRemoveAria" | "saveError" | "savedToast">;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function remove(key: string) {
    setBusy(true);
    try {
      const res = await saveFollowUpRoleGroupsAction(excluded.filter((k) => k !== key));
      showToast(res.ok ? labels.savedToast : labels.saveError, res.ok ? "success" : "error");
    } catch {
      showToast(labels.saveError, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {rows
        .filter((r) => excluded.includes(r.key))
        .map((r) => (
          <span className="chip" key={r.key}>
            <span className="k">{labels.chipKey}</span> {r.label}
            <button type="button" className="chip-remove" aria-label={fillTemplate(labels.chipRemoveAria, { label: r.label })} disabled={busy} onClick={() => remove(r.key)}>
              <CloseIcon className="icon" />
            </button>
          </span>
        ))}
    </>
  );
}

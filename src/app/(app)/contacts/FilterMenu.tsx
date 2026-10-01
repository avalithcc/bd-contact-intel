"use client";

/**
 * "Agregar filtro" (mockups/contacts.html toolbar): a dropdown listing the
 * 10 filter types; picking one opens THAT filter's own inline editor;
 * applying it adds a chip; clicking an existing chip reopens its editor
 * pre-filled. Client-only for which editor is showing — every actual
 * filter application is still a plain GET `<form>` navigation (no client
 * state holds filter VALUES, only which editor is visible), same
 * "query string is the only source of truth" convention as the rest of
 * this page.
 *
 * `baseParamsQuery` is the FULL current ad-hoc filter query string (every
 * field, plus view/q/sort/columns/layout) built once server-side
 * (page.tsx). Each editor form starts from that same string with only its
 * OWN field's key(s) removed, so submitting one field's edit can never
 * accidentally drop an unrelated filter.
 */
import { useEffect, useRef, useState } from "react";
import type { FilterChip, FilterChipField } from "@/lib/contacts/filterChips";
import { FILTER_FIELD_LABEL } from "@/lib/contacts/filterChips";
import {
  EXTRA_FILTER_MENU_ORDER,
  FIELD_PARAM_NAMES,
  FILTER_FIELD_KIND,
  FILTER_MENU_ORDER,
  type SelectFilterField,
} from "@/lib/contacts/filterFieldKinds";
import {
  checkboxSubmitMarker,
  isCheckboxFilterKey,
} from "@/lib/contacts/adHocFilterParams";
import { ROLE_GROUPS } from "@/lib/roleGroups";
import { PRIORITY_BADGE_CLASS, ROLE_GROUP_PLAYBOOK } from "@/lib/roleGroupPlaybook";
import { InfoIcon } from "@/components/icons";

// "Por qué estos grupos de rol" disclosure (openspec/changes/bd-playbook,
// surface 2) — shows only the extremes (Alta/No priorizar), same as the
// approved mockup (bd-playbook.html); the rest is one click away via the
// full guide link. Computed once at module scope: pure static content, no
// props needed.
const ALTA_GROUPS = ROLE_GROUPS.filter((g) => ROLE_GROUP_PLAYBOOK[g.key].priority === "alta");
const NO_PRIORIZAR_GROUPS = ROLE_GROUPS.filter((g) => ROLE_GROUP_PLAYBOOK[g.key].priority === "no_priorizar");

export interface SelectOption {
  value: string;
  label: string;
}

export interface FilterMenuLabels {
  addFilterLabel: string;
  removeFilterLabel: string;
  applyLabel: string;
  cancelLabel: string;
  anyLabel: string;
  roleGroupFilterHintLabel: string;
  roleGroupFilterHintMenuLabel: string;
  roleGroupFilterGuideLink: string;
}

export interface FilterMenuProps {
  baseParamsQuery: string;
  chips: FilterChip[];
  ownerSelectOptions: SelectOption[];
  bdConnectedOptions: SelectOption[];
  statusOptions: SelectOption[];
  emailStatusOptions: SelectOption[];
  marketOptions: SelectOption[];
  roleGroupOptions: SelectOption[];
  contactTypeOptions: SelectOption[];
  lastActivityOptions: SelectOption[];
  industryGroupOptions: SelectOption[];
  seniorityOptions: SelectOption[];
  labels: FilterMenuLabels;
}

/**
 * For a chip's "×" removal link: explicit empty string, not `.delete()` —
 * `applyAdHocContactFilterOverrides` (viewFilters.ts) only clears a field
 * when its param is PRESENT and empty; an entirely absent param leaves an
 * inherited system/saved-view value untouched. Removing a chip must always
 * clear the field regardless of where its current value came from.
 */
function paramsForRemoval(baseParamsQuery: string, field: FilterChipField): URLSearchParams {
  const params = new URLSearchParams(baseParamsQuery);
  for (const name of FIELD_PARAM_NAMES[field]) params.set(name, "");
  return params;
}

/** For an editor form's hidden "preserve every other filter" inputs: the
 * field being edited must be fully ABSENT (its own visible control
 * supplies the value on submit) — using `.set(name, "")` here would submit
 * both an empty hidden value AND the control's real value under the same
 * name. */
function hiddenParamsForEditor(baseParamsQuery: string, field: FilterChipField): URLSearchParams {
  const params = new URLSearchParams(baseParamsQuery);
  for (const name of FIELD_PARAM_NAMES[field]) params.delete(name);
  return params;
}

export function FilterMenu({
  baseParamsQuery,
  chips,
  ownerSelectOptions,
  bdConnectedOptions,
  statusOptions,
  emailStatusOptions,
  marketOptions,
  roleGroupOptions,
  contactTypeOptions,
  lastActivityOptions,
  industryGroupOptions,
  seniorityOptions,
  labels: l,
}: FilterMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<FilterChipField | null>(null);
  const current = new URLSearchParams(baseParamsQuery);
  const roleGroupLabelByKey = new Map(roleGroupOptions.map((o) => [o.value, o.label]));
  const editorRef = useRef<HTMLFormElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  function openEditor(field: FilterChipField, trigger?: HTMLButtonElement | null) {
    lastTriggerRef.current = trigger ?? null;
    setEditing(field);
    setMenuOpen(false);
  }

  function closeEditor() {
    setEditing(null);
    lastTriggerRef.current?.focus();
  }

  // Same "Escape closes, outside click closes" contract as DropdownMenu
  // (src/components/DropdownMenu.tsx) — the editor is a positioned overlay
  // just like that menu, so it must not trap a keyboard user once open.
  useEffect(() => {
    if (!editing) return;

    function onPointerDown(e: MouseEvent) {
      if (!editorRef.current?.contains(e.target as Node)) {
        setEditing(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeEditor();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function renderEditorFields(field: FilterChipField) {
    const kind = FILTER_FIELD_KIND[field];
    if (kind === "select") {
      // Required (not Partial) for every select-kind field — see SelectFilterField.
      const optionsByField: Record<SelectFilterField, SelectOption[]> = {
        owner: ownerSelectOptions,
        bdConnected: bdConnectedOptions,
        emailStatus: emailStatusOptions,
        market: marketOptions,
        roleGroup: roleGroupOptions,
        contactType: contactTypeOptions,
        lastActivityDays: lastActivityOptions,
        industryGroup: industryGroupOptions,
        seniority: seniorityOptions,
      };
      const options = optionsByField[field as SelectFilterField];
      return (
        <select name={FIELD_PARAM_NAMES[field][0]} defaultValue={current.get(FIELD_PARAM_NAMES[field][0]) ?? ""}>
          <option value="">{l.anyLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (kind === "multiselect") {
      const activeValues = current.getAll(FIELD_PARAM_NAMES[field][0]);
      return (
        <fieldset>
          {statusOptions.map((o) => (
            <label key={o.value} className="check">
              <input type="checkbox" name="status" value={o.value} defaultChecked={activeValues.includes(o.value)} />{" "}
              {o.label}
            </label>
          ))}
        </fieldset>
      );
    }
    if (kind === "checkbox") {
      const name = FIELD_PARAM_NAMES[field][0];
      return (
        <label className="check">
          {isCheckboxFilterKey(name) && <input type="hidden" name={checkboxSubmitMarker(name)} value="1" />}
          <input type="checkbox" name={name} value={name === "hiring" ? "1" : "on"} defaultChecked={!!current.get(name)} />{" "}
          {FILTER_FIELD_LABEL[field]}
        </label>
      );
    }
    // "text"
    const name = FIELD_PARAM_NAMES[field][0];
    return <input type="text" name={name} defaultValue={current.get(name) ?? ""} />;
  }

  function renderEditor(field: FilterChipField) {
    return (
      <form ref={editorRef} method="get" action="/contacts" className="menu left">
        {[...hiddenParamsForEditor(baseParamsQuery, field).entries()].map(([name, value], i) => (
          <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
        ))}
        <div className="menu-label">{FILTER_FIELD_LABEL[field]}</div>
        {renderEditorFields(field)}
        <div className="menu-sep" />
        <button type="submit" className="btn btn-primary btn-sm">
          {l.applyLabel}
        </button>
        <button type="button" className="btn btn-secondary btn-sm mt-lg" onClick={closeEditor}>
          {l.cancelLabel}
        </button>
      </form>
    );
  }

  const chipFields = new Set(chips.map((chip) => chip.field));
  // The editor must share a positioned ancestor with whatever opened it
  // (`.menu` is `position: absolute` — see design-system.css) so it lands
  // on screen next to that control instead of at the document's initial
  // containing block. An existing chip's editor anchors inside that
  // chip's own `.dropdown` wrapper; a field picked from the "Agregar
  // filtro" menu (not yet an active chip) has no chip to anchor to, so it
  // anchors inside that add-filter `.dropdown` instead.
  const editingFromMenu = editing !== null && !chipFields.has(editing);

  return (
    <>
      {chips.map((chip) => {
        const removeHref = `?${paramsForRemoval(baseParamsQuery, chip.field).toString()}`;
        return (
          <span key={chip.field} className="dropdown">
            <span className="chip">
              <button
                type="button"
                className="chip-target"
                onClick={(e) => openEditor(chip.field, e.currentTarget)}
              >
                <span className="k">{chip.label}:</span> {chip.valueText ?? l.anyLabel}
              </button>
              <a href={removeHref} aria-label={l.removeFilterLabel} className="chip-remove">
                ×
              </a>
            </span>
            {chip.field === "roleGroup" && (
              <details className="dropdown">
                <summary
                  className="btn btn-ghost btn-sm btn-icon"
                  aria-label={l.roleGroupFilterHintLabel}
                  title={l.roleGroupFilterHintLabel}
                >
                  <InfoIcon className="icon" />
                </summary>
                <div className="menu left" style={{ width: 280 }}>
                  <div className="menu-label">{l.roleGroupFilterHintMenuLabel}</div>
                  {[...ALTA_GROUPS, ...NO_PRIORIZAR_GROUPS].map((g) => {
                    const entry = ROLE_GROUP_PLAYBOOK[g.key];
                    return (
                      <a key={g.key} className="menu-item" href={`/playbook#${g.key}`}>
                        <span className={`${PRIORITY_BADGE_CLASS[entry.priority]} no-dot`}>{entry.priorityLabel}</span>
                        {roleGroupLabelByKey.get(g.key) ?? g.key}
                      </a>
                    );
                  })}
                  <div className="menu-sep" />
                  <a className="menu-item" href="/playbook">
                    {l.roleGroupFilterGuideLink}
                  </a>
                </div>
              </details>
            )}
            {editing === chip.field && renderEditor(chip.field)}
          </span>
        );
      })}

      <div className="dropdown">
        <button type="button" className="chip chip-add" onClick={() => setMenuOpen((o) => !o)}>
          {l.addFilterLabel}
        </button>
        {menuOpen && (
          <div className="menu left">
            <div className="menu-label">{l.addFilterLabel}</div>
            {FILTER_MENU_ORDER.map((field) => (
              <button
                key={field}
                type="button"
                className="menu-item"
                onClick={(e) => openEditor(field, e.currentTarget)}
              >
                {FILTER_FIELD_LABEL[field]}
              </button>
            ))}
            <div className="menu-sep" />
            {EXTRA_FILTER_MENU_ORDER.map((field) => (
              <button
                key={field}
                type="button"
                className="menu-item"
                onClick={(e) => openEditor(field, e.currentTarget)}
              >
                {FILTER_FIELD_LABEL[field]}
              </button>
            ))}
          </div>
        )}
        {editingFromMenu && renderEditor(editing)}
      </div>
    </>
  );
}

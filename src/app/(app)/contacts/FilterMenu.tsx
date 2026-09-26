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
import { useState } from "react";
import type { FilterChip, FilterChipField } from "@/lib/contacts/filterChips";
import { FILTER_FIELD_LABEL } from "@/lib/contacts/filterChips";
import { EXTRA_FILTER_MENU_ORDER, FILTER_FIELD_KIND, FILTER_MENU_ORDER } from "@/lib/contacts/filterFieldKinds";

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
  lastActivityOptions: SelectOption[];
  industryGroupOptions: SelectOption[];
  seniorityOptions: SelectOption[];
  labels: FilterMenuLabels;
}

/** Field name(s) this editor's control uses in the form — `status` posts
 * one entry per checked box under the same key. */
const FIELD_PARAM_NAMES: Record<FilterChipField, string[]> = {
  owner: ["owner"],
  status: ["status"],
  emailStatus: ["emailStatus"],
  hasPhone: ["hasPhone"],
  company: ["company"],
  hiring: ["hiring"],
  market: ["market"],
  roleGroup: ["roleGroup"],
  startupsOnly: ["startupsOnly"],
  bdConnected: ["bdConnected"],
  lastActivityDays: ["lastActivityDays"],
  industryGroup: ["industryGroup"],
  seniority: ["seniority"],
  emailVerified: ["emailVerified"],
};

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
  lastActivityOptions,
  industryGroupOptions,
  seniorityOptions,
  labels: l,
}: FilterMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<FilterChipField | null>(null);
  const current = new URLSearchParams(baseParamsQuery);

  function openEditor(field: FilterChipField) {
    setEditing(field);
    setMenuOpen(false);
  }

  function renderEditorFields(field: FilterChipField) {
    const kind = FILTER_FIELD_KIND[field];
    if (kind === "select") {
      const optionsByField: Partial<Record<FilterChipField, SelectOption[]>> = {
        owner: ownerSelectOptions,
        bdConnected: bdConnectedOptions,
        emailStatus: emailStatusOptions,
        market: marketOptions,
        roleGroup: roleGroupOptions,
        lastActivityDays: lastActivityOptions,
        industryGroup: industryGroupOptions,
        seniority: seniorityOptions,
      };
      const options = optionsByField[field] ?? [];
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
          <input type="checkbox" name={name} value={name === "hiring" ? "1" : "on"} defaultChecked={!!current.get(name)} />{" "}
          {FILTER_FIELD_LABEL[field]}
        </label>
      );
    }
    // "text"
    const name = FIELD_PARAM_NAMES[field][0];
    return <input type="text" name={name} defaultValue={current.get(name) ?? ""} />;
  }

  return (
    <>
      {chips.map((chip) => {
        const removeHref = `?${paramsForRemoval(baseParamsQuery, chip.field).toString()}`;
        return (
          <span key={chip.field} className="chip">
            <button type="button" className="k" onClick={() => openEditor(chip.field)}>
              {chip.label}:
            </button>{" "}
            {chip.valueText ?? l.anyLabel}
            <a href={removeHref} aria-label={l.removeFilterLabel}>
              ×
            </a>
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
              <button key={field} type="button" className="menu-item" onClick={() => openEditor(field)}>
                {FILTER_FIELD_LABEL[field]}
              </button>
            ))}
            <div className="menu-sep" />
            {EXTRA_FILTER_MENU_ORDER.map((field) => (
              <button key={field} type="button" className="menu-item" onClick={() => openEditor(field)}>
                {FILTER_FIELD_LABEL[field]}
              </button>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <form method="get" action="/contacts" className="menu left">
          {[...hiddenParamsForEditor(baseParamsQuery, editing).entries()].map(([name, value], i) => (
            <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
          ))}
          <div className="menu-label">{FILTER_FIELD_LABEL[editing]}</div>
          {renderEditorFields(editing)}
          <div className="menu-sep" />
          <button type="submit" className="btn btn-primary btn-sm">
            {l.applyLabel}
          </button>
          <button type="button" className="btn btn-secondary btn-sm mt-lg" onClick={() => setEditing(null)}>
            {l.cancelLabel}
          </button>
        </form>
      )}
    </>
  );
}

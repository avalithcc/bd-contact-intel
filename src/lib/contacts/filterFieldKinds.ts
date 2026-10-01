/**
 * "Agregar filtro" menu config (mockups/contacts.html toolbar dropdown):
 * which control type FilterMenu.tsx renders for each field's inline
 * editor, and the menu's own item order. Pure config only — no DOM.
 */
import type { FilterChipField } from "@/lib/contacts/filterChips";

export type FilterFieldKind = "select" | "multiselect" | "checkbox" | "text";

/** The mockup's 12 "Agregar filtro" options (migration 0016 added "Tiene
 * teléfono"; contact-type-ui added "Tipo de contacto" after "Grupo de rol"),
 * in menu order. */
export const FILTER_MENU_ORDER: readonly FilterChipField[] = [
  "owner",
  "status",
  "emailStatus",
  "hasPhone",
  "company",
  "hiring",
  "market",
  "roleGroup",
  "contactType",
  "startupsOnly",
  "bdConnected",
  "lastActivityDays",
];

/** industryGroup/seniority predate this batch's mockup-menu rework (task
 * 13.3 `/leads` parity gap) and aren't in the mockup's 10-item menu — kept
 * addable in a second "more filters" group below the mockup's own list
 * rather than silently regressing (they were reachable before this batch;
 * removing that would be a real feature loss, not a mockup-fidelity fix). */
export const EXTRA_FILTER_MENU_ORDER: readonly FilterChipField[] = ["industryGroup", "seniority"];

export const FILTER_FIELD_KIND = {
  owner: "select",
  status: "multiselect",
  emailStatus: "select",
  hasPhone: "checkbox",
  company: "text",
  hiring: "checkbox",
  market: "select",
  roleGroup: "select",
  contactType: "select",
  startupsOnly: "checkbox",
  bdConnected: "select",
  lastActivityDays: "select",
  industryGroup: "select",
  seniority: "select",
  emailVerified: "checkbox",
} as const satisfies Record<FilterChipField, FilterFieldKind>;

/** Every field whose editor is a `<select>` fed by an options list. Derived
 * from the kind map above (kept literal via `as const`), so FilterMenu's
 * options map is required to cover exactly these keys: a new select-kind
 * filter without options, or options for a non-select field, fails `tsc`.
 * ("multiselect" is only `status`, which has its own `statusOptions` prop.) */
export type SelectFilterField = {
  [K in FilterChipField]: (typeof FILTER_FIELD_KIND)[K] extends "select" ? K : never;
}[FilterChipField];

/** Field name(s) this editor's control uses in the form — `status` posts
 * one entry per checked box under the same key. */
export const FIELD_PARAM_NAMES: Record<FilterChipField, string[]> = {
  owner: ["owner"],
  status: ["status"],
  emailStatus: ["emailStatus"],
  hasPhone: ["hasPhone"],
  company: ["company"],
  hiring: ["hiring"],
  market: ["market"],
  roleGroup: ["roleGroup"],
  contactType: ["contactType"],
  startupsOnly: ["startupsOnly"],
  bdConnected: ["bdConnected"],
  lastActivityDays: ["lastActivityDays"],
  industryGroup: ["industryGroup"],
  seniority: ["seniority"],
  emailVerified: ["emailVerified"],
};


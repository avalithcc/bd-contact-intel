/**
 * "Agregar filtro" menu config (mockups/contacts.html toolbar dropdown):
 * which control type FilterMenu.tsx renders for each field's inline
 * editor, and the menu's own item order. Pure config only — no DOM.
 */
import type { FilterChipField } from "@/lib/contacts/filterChips";

export type FilterFieldKind = "select" | "multiselect" | "checkbox" | "text";

/** Exactly the mockup's 11 "Agregar filtro" options (migration 0016 added
 * "Tiene teléfono"), in menu order. */
export const FILTER_MENU_ORDER: readonly FilterChipField[] = [
  "owner",
  "status",
  "emailStatus",
  "hasPhone",
  "company",
  "hiring",
  "market",
  "roleGroup",
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

export const FILTER_FIELD_KIND: Record<FilterChipField, FilterFieldKind> = {
  owner: "select",
  status: "multiselect",
  emailStatus: "select",
  hasPhone: "checkbox",
  company: "text",
  hiring: "checkbox",
  market: "select",
  roleGroup: "select",
  startupsOnly: "checkbox",
  bdConnected: "select",
  lastActivityDays: "select",
  industryGroup: "select",
  seniority: "select",
  emailVerified: "checkbox",
};

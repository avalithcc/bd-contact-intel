/**
 * `/contacts` toolbar removable filter chips (mockups/contacts.html
 * `.chip` + "Quitar filtro" button per chip). Pure mapping only — no DB —
 * page.tsx renders one chip per entry returned here, each with a link that
 * clears exactly that field's ad-hoc query param (see
 * AdHocContactFilterInput in viewFilters.ts).
 */
import type { ContactFilters } from "@/lib/contacts/viewFilters";

export type FilterChipField = keyof ContactFilters;

export interface FilterChip {
  field: FilterChipField;
  label: string;
  /** `null` for a plain boolean toggle chip (e.g. "Empresa con vacantes
   * abiertas") that has no separate value to show beyond its own label. */
  valueText: string | null;
}

export interface FilterChipContext {
  ownerLabel(value: string): string;
  statusLabel(status: NonNullable<ContactFilters["status"]>[number]): string;
  emailStatusLabel(status: NonNullable<ContactFilters["emailStatus"]>): string;
  marketLabel(market: NonNullable<ContactFilters["market"]>): string;
  roleGroupLabel(key: string): string;
  bdName(bdId: string): string;
}

/** Shared Spanish field labels — one source of truth for both the chip row
 * and FilterMenu.tsx's "Agregar filtro" menu items, so the two can never
 * drift on wording. */
export const FILTER_FIELD_LABEL: Record<FilterChipField, string> = {
  owner: "Responsable",
  status: "Estado",
  emailStatus: "Estado del correo",
  company: "Empresa",
  hiring: "Empresa con vacantes abiertas",
  market: "Mercado de contratación",
  roleGroup: "Grupo de rol",
  startupsOnly: "Startup",
  bdConnected: "BD conectado",
  lastActivityDays: "Última actividad",
  industryGroup: "Industria",
  seniority: "Seniority",
  emailVerified: "Correo verificado",
};

/**
 * Order matches the mockup's "Agregar filtro" menu (contacts.html) exactly,
 * so chips always appear in the same left-to-right order regardless of
 * which filter a BD added first.
 */
export function buildActiveFilterChips(filters: ContactFilters, ctx: FilterChipContext): FilterChip[] {
  const chips: FilterChip[] = [];
  const L = FILTER_FIELD_LABEL;

  if (filters.owner) chips.push({ field: "owner", label: L.owner, valueText: ctx.ownerLabel(filters.owner) });
  if (filters.status?.length) {
    chips.push({ field: "status", label: L.status, valueText: filters.status.map(ctx.statusLabel).join(", ") });
  }
  if (filters.emailStatus) {
    chips.push({ field: "emailStatus", label: L.emailStatus, valueText: ctx.emailStatusLabel(filters.emailStatus) });
  }
  if (filters.company) chips.push({ field: "company", label: L.company, valueText: filters.company });
  if (filters.hiring) chips.push({ field: "hiring", label: L.hiring, valueText: null });
  if (filters.market) chips.push({ field: "market", label: L.market, valueText: ctx.marketLabel(filters.market) });
  if (filters.roleGroup) chips.push({ field: "roleGroup", label: L.roleGroup, valueText: ctx.roleGroupLabel(filters.roleGroup) });
  if (filters.startupsOnly) chips.push({ field: "startupsOnly", label: L.startupsOnly, valueText: null });
  if (filters.bdConnected) chips.push({ field: "bdConnected", label: L.bdConnected, valueText: ctx.bdName(filters.bdConnected) });
  if (filters.lastActivityDays) {
    chips.push({ field: "lastActivityDays", label: L.lastActivityDays, valueText: `últimos ${filters.lastActivityDays} días` });
  }
  // Older/secondary filters (not in the mockup's 10-item menu, but already
  // ad-hoc-overridable from before this batch) — kept last so the "official
  // 10" always come first, still removable via the same chip mechanism.
  if (filters.industryGroup) chips.push({ field: "industryGroup", label: L.industryGroup, valueText: filters.industryGroup });
  if (filters.seniority) chips.push({ field: "seniority", label: L.seniority, valueText: filters.seniority });
  if (filters.emailVerified) chips.push({ field: "emailVerified", label: L.emailVerified, valueText: null });

  return chips;
}

/**
 * "Incluye" summary for the "Guardar vista" modal (mockups/contacts.html
 * `#save-view`: "Estado: Nuevo, Contactado", "Grupo de rol: ... +2",
 * "Columnas: 8"). One line per active filter chip, plus a trailing
 * "Columnas: N" line — always present, even with zero active filters,
 * since the mockup's dialog always shows a columns count.
 */
export function buildSaveViewSummary(chips: FilterChip[], columnsCount: number, columnsLabel = "Columnas"): string[] {
  return [
    ...chips.map((chip) => (chip.valueText === null ? chip.label : `${chip.label}: ${chip.valueText}`)),
    `${columnsLabel}: ${columnsCount}`,
  ];
}

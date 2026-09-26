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

/**
 * Order matches the mockup's "Agregar filtro" menu (contacts.html) exactly,
 * so chips always appear in the same left-to-right order regardless of
 * which filter a BD added first.
 */
export function buildActiveFilterChips(filters: ContactFilters, ctx: FilterChipContext): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.owner) chips.push({ field: "owner", label: "Responsable", valueText: ctx.ownerLabel(filters.owner) });
  if (filters.status?.length) {
    chips.push({ field: "status", label: "Estado", valueText: filters.status.map(ctx.statusLabel).join(", ") });
  }
  if (filters.emailStatus) {
    chips.push({ field: "emailStatus", label: "Estado del correo", valueText: ctx.emailStatusLabel(filters.emailStatus) });
  }
  if (filters.company) chips.push({ field: "company", label: "Empresa", valueText: filters.company });
  if (filters.hiring) chips.push({ field: "hiring", label: "Empresa con vacantes abiertas", valueText: null });
  if (filters.market) chips.push({ field: "market", label: "Mercado de contratación", valueText: ctx.marketLabel(filters.market) });
  if (filters.roleGroup) chips.push({ field: "roleGroup", label: "Grupo de rol", valueText: ctx.roleGroupLabel(filters.roleGroup) });
  if (filters.startupsOnly) chips.push({ field: "startupsOnly", label: "Startup", valueText: null });
  if (filters.bdConnected) chips.push({ field: "bdConnected", label: "BD conectado", valueText: ctx.bdName(filters.bdConnected) });
  if (filters.lastActivityDays) {
    chips.push({ field: "lastActivityDays", label: "Última actividad", valueText: `últimos ${filters.lastActivityDays} días` });
  }
  // Older/secondary filters (not in the mockup's 10-item menu, but already
  // ad-hoc-overridable from before this batch) — kept last so the "official
  // 10" always come first, still removable via the same chip mechanism.
  if (filters.industryGroup) chips.push({ field: "industryGroup", label: "Industria", valueText: filters.industryGroup });
  if (filters.seniority) chips.push({ field: "seniority", label: "Seniority", valueText: filters.seniority });
  if (filters.emailVerified) chips.push({ field: "emailVerified", label: "Correo verificado", valueText: null });

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

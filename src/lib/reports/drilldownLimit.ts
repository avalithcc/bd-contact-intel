/**
 * Row cap shared by every /admin/reports KPI drill-down (reports-kpi-drilldown).
 * The first two dialogs cut at 500 rows silently; a cut is only honest when the
 * dialog says so, so the cap and the "is this list truncated?" rule live here
 * once, for the SQL limit and for the shared dialog.
 */
export const DRILLDOWN_ROW_LIMIT = 500;

/**
 * `null` unless the list was cut by the cap: the list reached the cap AND the
 * KPI's own total is larger. Fewer rows than the cap with a larger total is
 * count drift between page load and click, not a truncation — no note then.
 */
export function drilldownTruncation(shown: number, total: number): { shown: number; total: number } | null {
  return shown >= DRILLDOWN_ROW_LIMIT && total > shown ? { shown, total } : null;
}

/** Fills the dictionary's `{shown}`/`{total}` template (plain string, so it can cross to client components). */
export function fillTruncationNote(template: string, shown: number, total: number, numberLocale: string): string {
  return template.replace("{shown}", shown.toLocaleString(numberLocale)).replace("{total}", total.toLocaleString(numberLocale));
}

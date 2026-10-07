/**
 * Bug fix (owner report): the bulk-selection bar (BulkActionsBar.tsx) never
 * appeared — row checkboxes never updated `selectedCount`. Root cause: the
 * component wired its "change" listener imperatively via
 * `useEffect(() => form.addEventListener("change", ...), [])`, which
 * depends on `formRef.current` already being attached by the time the
 * effect runs. Replaced with a plain JSX `onChange` prop on the `<form>`
 * itself — React's own synthetic event delegation, attached from the very
 * first render, no ref-timing dependency at all. This module holds the one
 * pure DECISION that handler makes (is this change the header "select all"
 * toggle, and if so what should every row checkbox become) so it's
 * unit-tested without a DOM.
 */
export const SELECT_ALL_CHECKBOX_ID = "select-all-contacts";
/** The `/companies` list reuses the same decision with its own header id. */
export const SELECT_ALL_COMPANIES_CHECKBOX_ID = "select-all-companies";

/**
 * `null` means "this wasn't the select-all toggle — leave every row
 * checkbox exactly as the user just set it individually." A non-null
 * boolean means "set every `personId` row checkbox to this value."
 */
export function resolveSelectAllChecked(
  targetId: string,
  targetChecked: boolean,
  selectAllId: string = SELECT_ALL_CHECKBOX_ID,
): boolean | null {
  return targetId === selectAllId ? targetChecked : null;
}

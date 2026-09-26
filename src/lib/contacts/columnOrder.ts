/**
 * "Columnas" picker drag-and-drop / keyboard reorder (mockups/contacts.html:
 * "Columnas visibles · arrastrar para reordenar", `.drag` handles). Pure
 * array reordering only — no DOM — ColumnPicker.tsx (client component)
 * calls these from drag/drop and Up/Down keyboard-accessible button events,
 * then submits the resulting order through the same `columns` field
 * `sanitizeColumnKeys` already order-preserves.
 */
import type { ContactColumnKey } from "@/lib/contacts/columns";

/** The picker always lists every column (checked or not), visible ones
 * first in their current order, so unchecking/reordering never reshuffles
 * columns the BD hasn't touched yet. */
export function buildColumnOrder(
  all: readonly ContactColumnKey[],
  visible: readonly ContactColumnKey[],
): ContactColumnKey[] {
  const rest = all.filter((key) => !visible.includes(key));
  return [...visible, ...rest];
}

/** Keyboard-accessible reorder (Up/Down buttons) — swaps `key` with its
 * neighbor in `direction`. No-op at either boundary or for an unknown key. */
export function moveColumn(
  order: ContactColumnKey[],
  key: ContactColumnKey,
  direction: -1 | 1,
): ContactColumnKey[] {
  const idx = order.indexOf(key);
  if (idx === -1) return order;
  const swapWith = idx + direction;
  if (swapWith < 0 || swapWith >= order.length) return order;
  const next = [...order];
  [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
  return next;
}

/** Drag-and-drop reorder — moves `dragKey` to just before `dropOnKey`.
 * No-op when dragging onto itself or when either key is missing. */
export function reorderColumn(
  order: ContactColumnKey[],
  dragKey: ContactColumnKey,
  dropOnKey: ContactColumnKey,
): ContactColumnKey[] {
  if (dragKey === dropOnKey || !order.includes(dragKey)) return order;
  const next = order.filter((key) => key !== dragKey);
  const idx = next.indexOf(dropOnKey);
  if (idx === -1) return order;
  next.splice(idx, 0, dragKey);
  return next;
}

"use client";

/**
 * "Columnas" picker with drag-and-drop + keyboard-accessible reorder
 * (mockups/contacts.html: "Columnas visibles · arrastrar para reordenar",
 * `.drag` handles). Client component ONLY for the reorder interaction —
 * submission is still a plain `<form action={updateViewColumnsAction}>`
 * server action; the final DOM order of the checkbox rows IS the order
 * `columns` is submitted in (sanitizeColumnKeys now order-preserves,
 * src/lib/contacts/columns.ts), so dragging/moving a row really does
 * change what gets persisted.
 *
 * Keyboard accessibility beyond the static mockup: HTML5 drag-and-drop has
 * no keyboard equivalent, so each row also gets Up/Down buttons — an
 * intentional addition, not a mockup deviation in the "missing feature"
 * sense (task instruction: "keyboard-accessible").
 */
import { useState } from "react";
import { updateViewColumnsAction } from "./viewActions";
import { DEFAULT_CONTACT_COLUMNS, type ContactColumnKey } from "@/lib/contacts/columns";
import { buildColumnOrder, moveColumn, reorderColumn } from "@/lib/contacts/columnOrder";

export interface ColumnPickerLabels {
  pickerLabel: string;
  helpText: string;
  nameLabel: string;
  applyLabel: string;
  resetLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
}

export interface ColumnPickerProps {
  viewKey: string;
  allColumns: readonly ContactColumnKey[];
  visibleColumns: ContactColumnKey[];
  columnLabels: Record<ContactColumnKey, string>;
  labels: ColumnPickerLabels;
}

export function ColumnPicker({ viewKey, allColumns, visibleColumns, columnLabels, labels: l }: ColumnPickerProps) {
  const [order, setOrder] = useState<ContactColumnKey[]>(() => buildColumnOrder(allColumns, visibleColumns));
  const [checked, setChecked] = useState<Set<ContactColumnKey>>(() => new Set(visibleColumns));
  const [dragKey, setDragKey] = useState<ContactColumnKey | null>(null);

  function toggle(key: ContactColumnKey) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function reset() {
    setOrder(buildColumnOrder(allColumns, DEFAULT_CONTACT_COLUMNS));
    setChecked(new Set(DEFAULT_CONTACT_COLUMNS));
  }

  return (
    <details className="dropdown">
      <summary className="btn btn-secondary btn-sm">{l.pickerLabel}</summary>
      <form action={updateViewColumnsAction} className="menu">
        <input type="hidden" name="view" value={viewKey} />
        <div className="menu-label">{l.helpText}</div>
        <label className="check">
          <input type="checkbox" checked disabled /> {l.nameLabel}
        </label>
        {order.map((key, index) => (
          <label
            key={key}
            className="check"
            draggable
            onDragStart={() => setDragKey(key)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragKey) setOrder((prev) => reorderColumn(prev, dragKey, key));
              setDragKey(null);
            }}
          >
            <input
              type="checkbox"
              name="columns"
              value={key}
              checked={checked.has(key)}
              onChange={() => toggle(key)}
            />{" "}
            {columnLabels[key]}
            <span className="drag" aria-hidden="true">
              ⠿
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={`${l.moveUpLabel}: ${columnLabels[key]}`}
              disabled={index === 0}
              onClick={() => setOrder((prev) => moveColumn(prev, key, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={`${l.moveDownLabel}: ${columnLabels[key]}`}
              disabled={index === order.length - 1}
              onClick={() => setOrder((prev) => moveColumn(prev, key, 1))}
            >
              ↓
            </button>
          </label>
        ))}
        <div className="menu-sep" />
        <div className="row between menu-footer">
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            {l.resetLabel}
          </button>
          <button type="submit" className="btn btn-primary btn-sm">
            {l.applyLabel}
          </button>
        </div>
      </form>
    </details>
  );
}

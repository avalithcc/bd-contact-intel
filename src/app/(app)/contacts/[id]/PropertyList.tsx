"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import type { EditablePersonProperty } from "@/lib/contacts/propertyEdit";
import { updateContactPropertyAction } from "../actions";
import styles from "./AboutPane.module.css";

export interface AboutPaneProperty {
  key: EditablePersonProperty;
  label: string;
  value: string | null;
  lastUpdatedLabel: string | null;
}

export interface PropertyListProps {
  personId: string;
  labels: ContactRecordLabels;
  ownerLabel: string | null;
  properties: AboutPaneProperty[];
}

/**
 * Editable-properties list of the Contact record shell (task 9.4): the
 * `owner` row (read-only, see propertyEdit.ts's doc comment) plus one
 * inline-editable row per allow-listed property.
 */
export function PropertyList({ personId, labels: l, ownerLabel, properties }: PropertyListProps) {
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<EditablePersonProperty | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <dl className={styles.props}>
      <div className={styles.prop}>
        <dt>{l.propOwner}</dt>
        <dd>{ownerLabel ?? l.emptyValue}</dd>
        <dd className={styles.hint}>{l.ownerNotEditableNote}</dd>
      </div>
      {properties.map((prop) => (
        <PropertyRow
          key={prop.key}
          labels={l}
          prop={prop}
          editing={editingKey === prop.key}
          busy={busy}
          onStartEdit={() => setEditingKey(prop.key)}
          onCancel={() => setEditingKey(null)}
          onSave={async (value) => {
            setBusy(true);
            try {
              await updateContactPropertyAction(personId, prop.key, value);
              setEditingKey(null);
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        />
      ))}
    </dl>
  );
}

function PropertyRow({
  labels: l,
  prop,
  editing,
  busy,
  onStartEdit,
  onCancel,
  onSave,
}: {
  labels: ContactRecordLabels;
  prop: AboutPaneProperty;
  editing: boolean;
  busy: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(prop.value ?? "");

  if (editing) {
    return (
      <div className={styles.prop}>
        <dt>{prop.label}</dt>
        <dd>
          <input
            className={styles.input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </dd>
        <dd className={styles.editRow}>
          <button type="button" onClick={() => onSave(draft)} disabled={busy}>
            {l.save}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
        </dd>
      </div>
    );
  }

  return (
    <div className={styles.prop}>
      <dt>{prop.label}</dt>
      <dd>
        {prop.value ?? l.emptyValue}
        <button type="button" className={styles.editIcon} onClick={onStartEdit} aria-label={l.edit}>
          {l.edit}
        </button>
      </dd>
      {prop.lastUpdatedLabel && <dd className={styles.hint}>{prop.lastUpdatedLabel}</dd>}
    </div>
  );
}

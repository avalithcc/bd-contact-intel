"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
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
  const [error, setError] = useState<string | null>(null);

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
          error={editingKey === prop.key ? error : null}
          onStartEdit={() => {
            setError(null);
            setEditingKey(prop.key);
          }}
          onCancel={() => {
            setError(null);
            setEditingKey(null);
          }}
          onSave={async (value) => {
            setBusy(true);
            setError(null);
            try {
              // Fresh-review WARNING fix: check the typed result and keep
              // the field in edit mode (with the user's value) on error,
              // instead of silently swallowing a rejected save.
              const result = await updateContactPropertyAction(personId, prop.key, value);
              if (result.ok) {
                setEditingKey(null);
                router.refresh();
              } else {
                setError(contactActionErrorMessage(l, result.reason));
              }
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
  error,
  onStartEdit,
  onCancel,
  onSave,
}: {
  labels: ContactRecordLabels;
  prop: AboutPaneProperty;
  editing: boolean;
  busy: boolean;
  error: string | null;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(prop.value ?? "");
  const inputId = `contact-prop-${prop.key}`;

  if (editing) {
    return (
      <div className={styles.prop}>
        <dt id={`${inputId}-label`}>{prop.label}</dt>
        <dd>
          <input
            id={inputId}
            aria-labelledby={`${inputId}-label`}
            className={styles.input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </dd>
        {error && <dd className={styles.error}>{error}</dd>}
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
        <button type="button" className={styles.editIcon} onClick={onStartEdit}>
          {l.edit}
        </button>
      </dd>
      {prop.lastUpdatedLabel && <dd className={styles.hint}>{prop.lastUpdatedLabel}</dd>}
    </div>
  );
}

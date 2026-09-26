"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import type { EditablePersonProperty } from "@/lib/contacts/propertyEdit";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { statusBadgeClass } from "@/lib/contacts/statusBadge";
import { InfoIcon, EditPencilIcon } from "@/components/icons";
import { updateContactOwnerAction, updateContactPropertyAction } from "../actions";

export interface AboutPaneProperty {
  key: EditablePersonProperty;
  label: string;
  value: string | null;
  lastUpdatedLabel: string | null;
}

export interface OwnerOption {
  id: string;
  name: string;
}

export interface PropertyListProps {
  personId: string;
  labels: ContactRecordLabels;
  statusLabel: string;
  statusValue: string;
  statusReasonText: string | null;
  ownerLabel: string | null;
  ownerBdId: string | null;
  // R3 (design.md): reassignment is only allowed while the person has no
  // `person_bd_connection` row yet — same rule bulkAssignOwner enforces
  // server-side; this only decides whether to render the picker as busy/
  // disabled instead of silently letting a doomed request through.
  ownerLocked: boolean;
  ownerOptions: OwnerOption[];
  ownerHint: string | null;
  emailVerified: boolean;
  hunterHint: string | null;
  sourceText: string | null;
  createdText: string;
  properties: AboutPaneProperty[];
}

/**
 * Editable-properties list of the Contact record shell (task 9.4, mockup-
 * port r02 markup rework onto design-system.css's `.props`/`.prop`/
 * `.owner-chip` classes — contact-record.html:75-87). Leads with the
 * read-only derived "Estado" row (contact-record spec: status is never
 * edited directly), then the editable `owner` row (task 13.3), then one
 * inline-editable row per allow-listed property, then the read-only
 * "Origen"/"Creado" rows.
 */
export function PropertyList({
  personId,
  labels: l,
  statusLabel,
  statusValue,
  statusReasonText,
  ownerLabel,
  ownerBdId,
  ownerLocked,
  ownerOptions,
  ownerHint,
  emailVerified,
  hunterHint,
  sourceText,
  createdText,
  properties,
}: PropertyListProps) {
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<EditablePersonProperty | null>(null);
  const [ownerEditing, setOwnerEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [ownerDraft, setOwnerDraft] = useState(ownerBdId ?? "");

  return (
    <dl className="props">
      <div className="prop derived">
        <dt>{l.propStatus}</dt>
        <dd>
          <span className={statusBadgeClass(statusValue)}>{statusLabel}</span>
        </dd>
        {statusReasonText && (
          <dd className="why">
            <InfoIcon className="icon" /> {statusReasonText}
          </dd>
        )}
      </div>

      <div className="prop">
        <dt id="contact-prop-owner-label">{l.propOwner}</dt>
        {ownerEditing ? (
          <>
            <dd>
              <select
                aria-labelledby="contact-prop-owner-label"
                className="input"
                value={ownerDraft}
                onChange={(e) => setOwnerDraft(e.target.value)}
                disabled={busy}
                autoFocus
              >
                <option value="">{l.ownerUnassignedOption}</option>
                {ownerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </dd>
            {ownerError && (
              <dd className="error-text" role="alert">
                {ownerError}
              </dd>
            )}
            <dd className="row">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setOwnerError(null);
                  try {
                    const result = await updateContactOwnerAction(personId, ownerDraft);
                    if (result.ok) {
                      setOwnerEditing(false);
                      router.refresh();
                    } else {
                      setOwnerError(contactActionErrorMessage(l, result.reason));
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {l.save}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => {
                  setOwnerError(null);
                  setOwnerDraft(ownerBdId ?? "");
                  setOwnerEditing(false);
                }}
              >
                {l.cancel}
              </button>
            </dd>
          </>
        ) : (
          <dd>
            {ownerLabel ? (
              <span className="owner-chip">
                <Avatar id={ownerBdId ?? ownerLabel} initials={initialsFromName(ownerLabel)} variant="bd" size="sm" />
                {ownerLabel}
              </span>
            ) : (
              l.emptyValue
            )}
            {!ownerLocked && (
              <button type="button" className="edit" onClick={() => setOwnerEditing(true)} aria-label={l.edit}>
                <EditPencilIcon className="icon" />
              </button>
            )}
          </dd>
        )}
        {ownerLocked && <dd className="hint">{l.ownerLockedNote}</dd>}
        {!ownerLocked && ownerHint && <dd className="hint">{ownerHint}</dd>}
      </div>

      {properties.map((prop) => (
        <PropertyRow
          key={prop.key}
          labels={l}
          prop={prop}
          emailVerified={prop.key === "email" && emailVerified}
          hunterHint={prop.key === "email" ? hunterHint : null}
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

      {sourceText && (
        <div className="prop">
          <dt>{l.propSource}</dt>
          <dd>{sourceText}</dd>
        </div>
      )}

      <div className="prop">
        <dt>{l.propCreated}</dt>
        <dd className="soft">{createdText}</dd>
      </div>
    </dl>
  );
}

function PropertyRow({
  labels: l,
  prop,
  emailVerified,
  hunterHint,
  editing,
  busy,
  error,
  onStartEdit,
  onCancel,
  onSave,
}: {
  labels: ContactRecordLabels;
  prop: AboutPaneProperty;
  emailVerified: boolean;
  hunterHint: string | null;
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
      <div className="prop">
        <dt id={`${inputId}-label`}>{prop.label}</dt>
        <dd>
          <input
            id={inputId}
            aria-labelledby={`${inputId}-label`}
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </dd>
        {error && (
          <dd className="error-text" role="alert">
            {error}
          </dd>
        )}
        <dd className="row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSave(draft)} disabled={busy}>
            {l.save}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
        </dd>
      </div>
    );
  }

  return (
    <div className="prop">
      <dt>{prop.label}</dt>
      <dd>
        {prop.value ?? l.emptyValue}
        {emailVerified && prop.value && <span className="badge badge-verified">{l.verifiedBadge}</span>}
        <button type="button" className="edit" onClick={onStartEdit} aria-label={l.edit}>
          <EditPencilIcon className="icon" />
        </button>
      </dd>
      {hunterHint ? (
        <dd className="hint">{hunterHint}</dd>
      ) : (
        prop.lastUpdatedLabel && <dd className="hint">{prop.lastUpdatedLabel}</dd>
      )}
    </div>
  );
}

"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  contactActionErrorMessage,
  contactLocationActionErrorMessage,
  type ContactRecordLabels,
} from "@/lib/contacts/labels";
import type { EditablePersonProperty } from "@/lib/contacts/propertyEdit";
import { composeLocation } from "@/lib/contacts/locationDisplay";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { statusBadgeClass } from "@/lib/contacts/statusBadge";
import { InfoIcon, EditPencilIcon } from "@/components/icons";
import { toTelHref, type WhatsappLink } from "@/lib/phone";
import { PhoneValue } from "@/components/PhoneValue";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, contactTypeLabel } from "@/lib/contacts/contactType";
import { updateContactLocationAction, updateContactOwnerAction, updateContactPropertyAction } from "../actions";

export interface AboutPaneProperty {
  key: EditablePersonProperty;
  label: string;
  value: string | null;
  lastUpdatedLabel: string | null;
  // Phone rows only: the WhatsApp link, built on the server because the
  // parsing library (src/lib/whatsapp.ts) must not ship to the browser.
  whatsapp?: WhatsappLink;
}

export interface OwnerOption {
  id: string;
  name: string;
}

/**
 * "Por qué este rol" disclosure on the Cargo row (openspec/changes/
 * bd-playbook, surface 1) — computed server-side in page.tsx from
 * `classifyPosition(record.person.jobTitle)` (src/lib/roleGroups.ts) plus
 * the matching entry in src/lib/roleGroupPlaybook.ts. No new query: the
 * jobTitle is already fetched for the Cargo row itself.
 */
export interface JobTitleRoleGroupHint {
  roleGroupLabel: string;
  decides: string | null;
  painSolved: string | null;
  note: string | null;
  guideHref: string;
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
  // Pattern-inferred email (scripts/backfill-inferred-emails.ts) — renders
  // "Deducido" next to the value, same spot as the verified badge (mutually
  // exclusive: email_status is one of 'verified'/'probable'/'none').
  emailInferred: boolean;
  hunterHint: string | null;
  sourceText: string | null;
  createdText: string;
  properties: AboutPaneProperty[];
  // "Ubicación" composite row (contact-record.html:86) — city/region/country
  // stay independently editable, real properties with their own audit
  // history; this only composes how the collapsed row displays and expands
  // its own inline edit form (see LocationPropertyRow below).
  locationProperties: { city: AboutPaneProperty; region: AboutPaneProperty; country: AboutPaneProperty };
  jobTitleRoleGroupHint: JobTitleRoleGroupHint;
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
  emailInferred,
  hunterHint,
  sourceText,
  createdText,
  properties,
  locationProperties,
  jobTitleRoleGroupHint,
}: PropertyListProps) {
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<EditablePersonProperty | null>(null);
  const [ownerEditing, setOwnerEditing] = useState(false);
  const [locationEditing, setLocationEditing] = useState(false);
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
              <button type="button" className="btn btn-ghost btn-icon btn-sm edit" onClick={() => setOwnerEditing(true)} aria-label={l.edit}>
                <EditPencilIcon className="icon" />
              </button>
            )}
          </dd>
        )}
        {ownerLocked && <dd className="hint">{l.ownerLockedNote}</dd>}
        {!ownerLocked && ownerHint && <dd className="hint">{ownerHint}</dd>}
      </div>

      {properties.map((prop) => (
        <Fragment key={prop.key}>
          {prop.key === "industry" && (
            <LocationPropertyRow
              key="location"
              personId={personId}
              labels={l}
              city={locationProperties.city}
              region={locationProperties.region}
              country={locationProperties.country}
              editing={locationEditing}
              onStartEdit={() => setLocationEditing(true)}
              onCancel={() => setLocationEditing(false)}
              onSaved={() => {
                setLocationEditing(false);
                router.refresh();
              }}
              genericError={l.genericError}
            />
          )}
          <PropertyRow
            key={prop.key}
            labels={l}
            prop={prop}
            emailVerified={prop.key === "email" && emailVerified}
            emailInferred={prop.key === "email" && emailInferred}
            hunterHint={prop.key === "email" ? hunterHint : null}
            roleGroupHint={prop.key === "jobTitle" ? jobTitleRoleGroupHint : null}
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
        </Fragment>
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
  emailInferred,
  hunterHint,
  roleGroupHint,
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
  emailInferred: boolean;
  hunterHint: string | null;
  roleGroupHint?: JobTitleRoleGroupHint | null;
  editing: boolean;
  busy: boolean;
  error: string | null;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(prop.value ?? "");
  const inputId = `contact-prop-${prop.key}`;
  // "Teléfono"/"Móvil" rows are `tel:` links (contact-record.html), not
  // plain text — same phone.ts helper the record page's export and list
  // column use, so display/dialing can never disagree on what's a valid
  // number.
  const isPhoneProp = prop.key === "phone" || prop.key === "mobilePhone";
  const telHref = isPhoneProp && prop.value ? toTelHref(prop.value) : null;
  // Why the WhatsApp shortcut is missing, from the helper's own reason: a
  // malformed number is already plain text and needs no explanation.
  const whatsappReason = telHref && prop.value ? prop.whatsapp?.reason : undefined;
  const whatsappHint =
    whatsappReason === "no_country_code"
      ? l.whatsappNoCountryCodeHint
      : whatsappReason === "unsupported"
        ? l.whatsappUnavailableHint
        : null;

  if (editing) {
    return (
      <div className="prop">
        <dt id={`${inputId}-label`}>{prop.label}</dt>
        <dd>
          {prop.key === "contactType" ? (
            // Closed set: a select (stored values, Spanish labels) instead
            // of free text, plus an empty option to clear the property.
            <select
              id={inputId}
              aria-labelledby={`${inputId}-label`}
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              autoFocus
            >
              <option value="">{l.contactTypeNoneOption}</option>
              {CONTACT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CONTACT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={inputId}
              aria-labelledby={`${inputId}-label`}
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              autoFocus
            />
          )}
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
        {isPhoneProp && prop.value ? (
          <PhoneValue value={prop.value} whatsappUrl={prop.whatsapp?.url} labels={l} />
        ) : prop.key === "contactType" ? (
          contactTypeLabel(prop.value, l.emptyValue)
        ) : (
          (prop.value ?? l.emptyValue)
        )}
        {emailVerified && prop.value && <span className="badge badge-verified">{l.verifiedBadge}</span>}
        {emailInferred && prop.value && <span className="badge badge-probable">{l.inferredBadge}</span>}
        {roleGroupHint && (
          <details className="dropdown">
            <summary className="btn btn-ghost btn-sm btn-icon" aria-label={l.jobTitleHintLabel} title={l.jobTitleHintLabel}>
              <InfoIcon className="icon" />
            </summary>
            <div className="menu left" style={{ width: 300 }}>
              <div className="menu-label">{l.jobTitleHintMenuLabel}</div>
              {roleGroupHint.decides ? (
                <>
                  <p className="meta" style={{ padding: "0.4rem var(--space-sm)" }}>
                    <strong>{roleGroupHint.roleGroupLabel}.</strong> {roleGroupHint.decides}
                  </p>
                  {roleGroupHint.painSolved && (
                    <>
                      <div className="menu-sep" />
                      <p className="meta" style={{ padding: "0 var(--space-sm) 0.4rem" }}>
                        {l.jobTitlePainPrefix} {roleGroupHint.painSolved}
                      </p>
                    </>
                  )}
                </>
              ) : (
                <p className="meta" style={{ padding: "0.4rem var(--space-sm)" }}>
                  <strong>{roleGroupHint.roleGroupLabel}.</strong> {roleGroupHint.note}
                </p>
              )}
              <div className="menu-sep" />
              <a className="menu-item" href={roleGroupHint.guideHref}>
                {l.jobTitleGuideLinkText}
              </a>
            </div>
          </details>
        )}
        <button type="button" className="btn btn-ghost btn-icon btn-sm edit" onClick={onStartEdit} aria-label={l.edit}>
          <EditPencilIcon className="icon" />
        </button>
      </dd>
      {whatsappHint && <dd className="hint">{whatsappHint}</dd>}
      {hunterHint ? (
        <dd className="hint">{hunterHint}</dd>
      ) : (
        prop.lastUpdatedLabel && <dd className="hint">{prop.lastUpdatedLabel}</dd>
      )}
    </div>
  );
}

/**
 * The record's "Ubicación" row (contact-record.html:86) — a single row
 * displaying `composeLocation(city, country)`, matching the mockup exactly
 * (region is never shown collapsed). `city`/`region`/`country` are real,
 * independently editable columns with their own audit history (design R7:
 * contact-identity's "keep one current value per property"/who-last-
 * updated-it rule) — this is NOT a lossy free-text field: editing expands
 * the row into its 3 underlying inputs, each saved through the same
 * `updateContactPropertyAction` every other property row uses, so history
 * and validation (propertyEdit.ts) stay per-field. Only fields whose draft
 * actually changed are sent, so an untouched field never writes a no-op
 * history row.
 */
function LocationPropertyRow({
  personId,
  labels: l,
  city,
  region,
  country,
  editing,
  onStartEdit,
  onCancel,
  onSaved,
  genericError,
}: {
  personId: string;
  labels: ContactRecordLabels;
  city: AboutPaneProperty;
  region: AboutPaneProperty;
  country: AboutPaneProperty;
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSaved: () => void;
  genericError: string;
}) {
  const [cityDraft, setCityDraft] = useState(city.value ?? "");
  const [regionDraft, setRegionDraft] = useState(region.value ?? "");
  const [countryDraft, setCountryDraft] = useState(country.value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    // Fresh-review CRITICAL fix: one server-action call plans and writes
    // city/region/country together in a single transaction
    // (updateContactLocationAction -> planLocationEdit), instead of three
    // sequential per-field calls where a rejected second/third field left
    // the first one already persisted. A rejected field leaves every field
    // exactly as it was, so the drafts below are only ever reset from the
    // props on Cancelar, never left stale after a partial failure.
    const handleSave = async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await updateContactLocationAction(personId, {
          city: cityDraft,
          region: regionDraft,
          country: countryDraft,
        });
        if (result.ok) {
          onSaved();
        } else {
          setError(contactLocationActionErrorMessage(l, result));
        }
      } catch {
        setError(genericError);
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="prop">
        <dt id="contact-prop-location-label">{l.propLocation}</dt>
        <dd>
          <input
            aria-label={l.propCity}
            className="input"
            placeholder={l.propCity}
            value={cityDraft}
            onChange={(e) => setCityDraft(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </dd>
        <dd>
          <input
            aria-label={l.propRegion}
            className="input"
            placeholder={l.propRegion}
            value={regionDraft}
            onChange={(e) => setRegionDraft(e.target.value)}
            disabled={busy}
          />
        </dd>
        <dd>
          <input
            aria-label={l.propCountry}
            className="input"
            placeholder={l.propCountry}
            value={countryDraft}
            onChange={(e) => setCountryDraft(e.target.value)}
            disabled={busy}
          />
        </dd>
        {error && (
          <dd className="error-text" role="alert">
            {error}
          </dd>
        )}
        <dd className="row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleSave} disabled={busy}>
            {l.save}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => {
              setCityDraft(city.value ?? "");
              setRegionDraft(region.value ?? "");
              setCountryDraft(country.value ?? "");
              setError(null);
              onCancel();
            }}
          >
            {l.cancel}
          </button>
        </dd>
      </div>
    );
  }

  return (
    <div className="prop">
      <dt>{l.propLocation}</dt>
      <dd>
        {composeLocation(city.value, country.value) ?? l.emptyValue}
        <button type="button" className="btn btn-ghost btn-icon btn-sm edit" onClick={onStartEdit} aria-label={l.edit}>
          <EditPencilIcon className="icon" />
        </button>
      </dd>
    </div>
  );
}

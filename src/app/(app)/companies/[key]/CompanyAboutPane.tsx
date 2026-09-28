"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCompanyAction, updateCompanyPropertyAction, updateCompanyStageAction } from "../actions";
import { EditPencilIcon } from "@/components/icons";
import type { NewContactDialogLabels } from "@/app/(app)/contacts/NewContactDialog";
import { CompanyQuickActions, type CompanyQuickActionsLabels } from "./CompanyQuickActions";

const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

export interface OwnerOption {
  id: string;
  name: string;
}

export interface LastEdit {
  bdName: string | null;
  at: Date;
}

export interface CompanyAboutPaneLabels extends CompanyQuickActionsLabels {
  aboutSectionTitle: string;
  propStage: string;
  propOwner: string;
  propRevenuePotential: string;
  propIndustry: string;
  propCity: string;
  propCountry: string;
  propStartup: string;
  emptyValue: string;
  edit: string;
  ownerUnassignedOption: string;
  lastUpdatedByPrefix: string;
  stageProspect: string;
  stageQualified: string;
  stageProposalSent: string;
  stageWon: string;
  stageLost: string;
}

export interface CompanyAboutPaneProps {
  companyKey: string;
  companyName: string;
  logoInitials: string;
  headline: string;
  stage: string | null;
  stageBadgeClass: string;
  hiringBadgeText: string | null;
  revenuePotential: number | null;
  industry: string | null;
  ownerBdId: string | null;
  ownerName: string | null;
  city: string | null;
  country: string | null;
  ownerOptions: OwnerOption[];
  /** Last edit per editable property (industry/ownerBdId/city/country),
   * keyed by the same `EditableCompanyProperty` name — see
   * recordMappers.ts#latestEditByProperty. A plain object (not a Map): a
   * client component's props cross the server/client boundary as
   * RSC-serializable values. */
  lastEditByProperty: Record<string, LastEdit | undefined>;
  startupText: string;
  labels: CompanyAboutPaneLabels;
  newContactLabels: NewContactDialogLabels;
}

function stageLabel(l: CompanyAboutPaneLabels, s: Stage): string {
  switch (s) {
    case "prospect":
      return l.stageProspect;
    case "qualified":
      return l.stageQualified;
    case "proposal_sent":
      return l.stageProposalSent;
    case "won":
      return l.stageWon;
    case "lost":
      return l.stageLost;
  }
}

function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

function formatLastEdit(l: CompanyAboutPaneLabels, edit: LastEdit | undefined): string | null {
  if (!edit) return null;
  const dateLabel = edit.at.toLocaleDateString();
  return `${l.lastUpdatedByPrefix} ${edit.bdName ?? l.emptyValue} · ${dateLabel}`;
}

/**
 * Left panel of the company record shell (mockup-port c03/c05;
 * company-record.html:64-74) — same `.record-left`/`.record-identity`/
 * `.quick-actions`/`.props` classes as the Contact record's AboutPane, its
 * own component rather than a literal reuse: a company has a different,
 * smaller property set and its quick actions write through `companyKey`,
 * not `personId`. Industria/Responsable/Ciudad/País (c05) are inline-
 * editable through `updateCompanyPropertyAction`, same per-property edit +
 * history pattern as the Contact record's `PropertyList.tsx`; Responsable
 * uses a BD `<select>` (owner-approved: an owner is a real assignment, not
 * free text) instead of a text input.
 */
export function CompanyAboutPane({
  companyKey,
  companyName,
  logoInitials,
  headline,
  stage,
  stageBadgeClass,
  hiringBadgeText,
  revenuePotential,
  industry,
  ownerBdId,
  ownerName,
  city,
  country,
  ownerOptions,
  lastEditByProperty,
  startupText,
  labels: l,
  newContactLabels,
}: CompanyAboutPaneProps) {
  const router = useRouter();
  const [editingStage, setEditingStage] = useState(false);
  const [stageDraft, setStageDraft] = useState<Stage>(stage && isStage(stage) ? stage : "prospect");
  const [editingRevenue, setEditingRevenue] = useState(false);
  const [revenueDraft, setRevenueDraft] = useState(revenuePotential != null ? String(revenuePotential) : "");
  const [editingProperty, setEditingProperty] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveStage() {
    setBusy(true);
    setError(null);
    try {
      await updateCompanyStageAction(companyKey, stageDraft);
      setEditingStage(false);
      router.refresh();
    } catch {
      setError(l.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function saveRevenue() {
    setBusy(true);
    setError(null);
    try {
      const parsed = revenueDraft.trim() ? Number(revenueDraft) : undefined;
      await updateCompanyAction(companyKey, { revenuePotential: parsed });
      setEditingRevenue(false);
      router.refresh();
    } catch {
      setError(l.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function saveProperty(property: string, value: string) {
    setBusy(true);
    setError(null);
    try {
      await updateCompanyPropertyAction(companyKey, property, value);
      setEditingProperty(null);
      router.refresh();
    } catch {
      setError(l.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="record-left" aria-label={l.aboutSectionTitle}>
      <div className="record-identity">
        <span className="company-logo lg" aria-hidden="true">
          {logoInitials}
        </span>
        <div>
          <h1>{companyName}</h1>
          <p className="headline">{headline}</p>
        </div>
        <div className="row wrap">
          <span className={stageBadgeClass}>{stage && isStage(stage) ? stageLabel(l, stage) : l.emptyValue}</span>
          {hiringBadgeText && <span className="badge badge-success no-dot">{hiringBadgeText}</span>}
        </div>
      </div>

      <CompanyQuickActions companyKey={companyKey} companyName={companyName} labels={l} newContactLabels={newContactLabels} />

      <div className="section-title">{l.aboutSectionTitle}</div>

      <dl className="props">
        <div className="prop">
          <dt>{l.propStage}</dt>
          {editingStage ? (
            <>
              <dd>
                <select
                  className="input"
                  value={stageDraft}
                  onChange={(e) => setStageDraft(e.target.value as Stage)}
                  disabled={busy}
                  autoFocus
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {stageLabel(l, s)}
                    </option>
                  ))}
                </select>
              </dd>
              <dd className="row">
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={saveStage}>
                  {l.save}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditingStage(false)}>
                  {l.cancel}
                </button>
              </dd>
            </>
          ) : (
            <dd>
              <span className={stageBadgeClass}>{stage && isStage(stage) ? stageLabel(l, stage) : l.emptyValue}</span>
              <button type="button" className="edit" onClick={() => setEditingStage(true)} aria-label={l.edit}>
                <EditPencilIcon className="icon" />
              </button>
            </dd>
          )}
        </div>

        <OwnerPropertyRow
          label={l.propOwner}
          ownerBdId={ownerBdId}
          ownerName={ownerName}
          ownerOptions={ownerOptions}
          editing={editingProperty === "ownerBdId"}
          busy={busy}
          error={editingProperty === "ownerBdId" ? error : null}
          hint={formatLastEdit(l, lastEditByProperty.ownerBdId)}
          labels={l}
          onStartEdit={() => {
            setError(null);
            setEditingProperty("ownerBdId");
          }}
          onCancel={() => {
            setError(null);
            setEditingProperty(null);
          }}
          onSave={(value) => saveProperty("ownerBdId", value)}
        />

        <div className="prop">
          <dt>{l.propRevenuePotential}</dt>
          {editingRevenue ? (
            <>
              <dd>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={revenueDraft}
                  onChange={(e) => setRevenueDraft(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              </dd>
              <dd className="row">
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={saveRevenue}>
                  {l.save}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditingRevenue(false)}>
                  {l.cancel}
                </button>
              </dd>
            </>
          ) : (
            <dd>
              {revenuePotential != null ? revenuePotential.toLocaleString() : l.emptyValue}
              <button type="button" className="edit" onClick={() => setEditingRevenue(true)} aria-label={l.edit}>
                <EditPencilIcon className="icon" />
              </button>
            </dd>
          )}
        </div>

        <TextPropertyRow
          label={l.propIndustry}
          value={industry}
          editing={editingProperty === "industry"}
          busy={busy}
          error={editingProperty === "industry" ? error : null}
          hint={formatLastEdit(l, lastEditByProperty.industry)}
          labels={l}
          onStartEdit={() => {
            setError(null);
            setEditingProperty("industry");
          }}
          onCancel={() => {
            setError(null);
            setEditingProperty(null);
          }}
          onSave={(value) => saveProperty("industry", value)}
        />

        <TextPropertyRow
          label={l.propCity}
          value={city}
          editing={editingProperty === "city"}
          busy={busy}
          error={editingProperty === "city" ? error : null}
          hint={formatLastEdit(l, lastEditByProperty.city)}
          labels={l}
          onStartEdit={() => {
            setError(null);
            setEditingProperty("city");
          }}
          onCancel={() => {
            setError(null);
            setEditingProperty(null);
          }}
          onSave={(value) => saveProperty("city", value)}
        />

        <TextPropertyRow
          label={l.propCountry}
          value={country}
          editing={editingProperty === "country"}
          busy={busy}
          error={editingProperty === "country" ? error : null}
          hint={formatLastEdit(l, lastEditByProperty.country)}
          labels={l}
          onStartEdit={() => {
            setError(null);
            setEditingProperty("country");
          }}
          onCancel={() => {
            setError(null);
            setEditingProperty(null);
          }}
          onSave={(value) => saveProperty("country", value)}
        />

        <div className="prop">
          <dt>{l.propStartup}</dt>
          <dd>{startupText}</dd>
        </div>

        {error && !editingProperty && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </dl>
    </aside>
  );
}

interface TextPropertyRowProps {
  label: string;
  value: string | null;
  editing: boolean;
  busy: boolean;
  error: string | null;
  hint: string | null;
  labels: CompanyAboutPaneLabels;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}

/** Single-text-field inline edit row (Industria/Ciudad/País), same shape as
 * the Contact record's `PropertyRow` (contacts/[id]/PropertyList.tsx). */
function TextPropertyRow({ label, value, editing, busy, error, hint, labels: l, onStartEdit, onCancel, onSave }: TextPropertyRowProps) {
  const [draft, setDraft] = useState(value ?? "");

  if (editing) {
    return (
      <div className="prop">
        <dt>{label}</dt>
        <dd>
          <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} autoFocus />
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
      <dt>{label}</dt>
      <dd>
        {value ?? l.emptyValue}
        <button type="button" className="edit" onClick={onStartEdit} aria-label={l.edit}>
          <EditPencilIcon className="icon" />
        </button>
      </dd>
      {hint && <dd className="hint">{hint}</dd>}
    </div>
  );
}

interface OwnerPropertyRowProps {
  label: string;
  ownerBdId: string | null;
  ownerName: string | null;
  ownerOptions: OwnerOption[];
  editing: boolean;
  busy: boolean;
  error: string | null;
  hint: string | null;
  labels: CompanyAboutPaneLabels;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}

/** Responsable row — a BD `<select>`, not free text (owner-approved: an
 * owner is a real assignment). Mirrors the Contact record's owner-edit row
 * (PropertyList.tsx's inline `<select>` block) rather than the plain-text
 * `PropertyRow`. */
function OwnerPropertyRow({
  label,
  ownerBdId,
  ownerName,
  ownerOptions,
  editing,
  busy,
  error,
  hint,
  labels: l,
  onStartEdit,
  onCancel,
  onSave,
}: OwnerPropertyRowProps) {
  const [draft, setDraft] = useState(ownerBdId ?? "");

  if (editing) {
    return (
      <div className="prop">
        <dt>{label}</dt>
        <dd>
          <select className="input" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} autoFocus>
            <option value="">{l.ownerUnassignedOption}</option>
            {ownerOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
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
      <dt>{label}</dt>
      <dd>
        {ownerName ?? l.emptyValue}
        <button type="button" className="edit" onClick={onStartEdit} aria-label={l.edit}>
          <EditPencilIcon className="icon" />
        </button>
      </dd>
      {hint && <dd className="hint">{hint}</dd>}
    </div>
  );
}

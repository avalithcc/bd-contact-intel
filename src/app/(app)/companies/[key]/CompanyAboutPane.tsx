"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCompanyAction, updateCompanyStageAction } from "../actions";
import { EditPencilIcon } from "@/components/icons";
import type { NewContactDialogLabels } from "@/app/(app)/contacts/NewContactDialog";
import { CompanyQuickActions, type CompanyQuickActionsLabels } from "./CompanyQuickActions";

const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

export interface CompanyAboutPaneLabels extends CompanyQuickActionsLabels {
  aboutSectionTitle: string;
  propStage: string;
  propOwner: string;
  propRevenuePotential: string;
  propLocation: string;
  propStartup: string;
  emptyValue: string;
  edit: string;
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
  ownerText: string; // pending-D1 "—" until the parallel data branch merges
  locationText: string; // pending-D1
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

/**
 * Left panel of the company record shell (mockup-port c03;
 * company-record.html:64-74) — same `.record-left`/`.record-identity`/
 * `.quick-actions`/`.props` classes as the Contact record's AboutPane, its
 * own component rather than a literal reuse: a company has a different,
 * smaller property set (Etapa/Responsable/Potencial de ingresos/Sede/
 * Startup vs. the Contact's phone/email/LinkedIn/source properties) and its
 * quick actions write through `companyKey`, not `personId`.
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
  ownerText,
  locationText,
  startupText,
  labels: l,
  newContactLabels,
}: CompanyAboutPaneProps) {
  const router = useRouter();
  const [editingStage, setEditingStage] = useState(false);
  const [stageDraft, setStageDraft] = useState<Stage>(stage && isStage(stage) ? stage : "prospect");
  const [editingRevenue, setEditingRevenue] = useState(false);
  const [revenueDraft, setRevenueDraft] = useState(revenuePotential != null ? String(revenuePotential) : "");
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

        {/* Pending D1 (owner-approved): company.owner_bd_id is being added by
            the parallel feat/company-fields-01… branch. Read-only "—" until
            it merges — no edit affordance for a field that doesn't exist
            yet. */}
        <div className="prop">
          <dt>{l.propOwner}</dt>
          <dd>{ownerText}</dd>
        </div>

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

        {/* Pending D1: company.city/country. */}
        <div className="prop">
          <dt>{l.propLocation}</dt>
          <dd>{locationText}</dd>
        </div>

        <div className="prop">
          <dt>{l.propStartup}</dt>
          <dd>{startupText}</dd>
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </dl>
    </aside>
  );
}

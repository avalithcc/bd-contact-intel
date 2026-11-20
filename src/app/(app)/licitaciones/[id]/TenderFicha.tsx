import Link from "next/link";
import type { ReactNode } from "react";
import { canAnalyse, currentDocument, type TenderAnalysis } from "@/lib/tenders/analysis";
import type { TenderDetail, TenderEventView } from "@/lib/tenders/detail";
import { isTenderTriage, type TenderTriage } from "@/lib/tenders/triage";
import { fillTemplate } from "@/lib/i18n/template";
import { formatAttachmentSize } from "@/lib/email/attachments/policy";
import { formatArgentinaDayMonthTime, formatArgentinaDayMonthYear } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { TenderTriageSelect } from "../TenderTriageSelect";
import { CopyNumber } from "./CopyNumber";
import { TenderAnalyseButton } from "./TenderAnalyseButton";
import { TenderDocumentUpload } from "./TenderDocumentUpload";
import { TenderNoteForm } from "./TenderNoteForm";
import { TenderOwnerSelect } from "./TenderOwnerSelect";
import { TenderPortalBlock } from "./TenderPortalBlock";
import { TenderRequirementStatusSelect } from "./TenderRequirementStatusSelect";
import { TenderRequirementNote } from "./TenderRequirementNote";
import { isRequirementKey, type RequirementStatus } from "@/lib/tenders/requirementStatus";
import { MUST_LIST_ROWS, mustListLines, mustListText } from "@/lib/tenders/mustList";

/** COMPR.AR has no stable link per process (its result links are `__doPostBack`), so the number is pasted into the portal's own search. */
/**
 * COMPR.AR's process search. NOT the site root: this page carries the "Búsqueda rápida / Número de proceso" box, so
 * the BD lands where the number they just copied is actually usable. Verified by hand on 2026-11-18 — the portal has
 * NO per-tender URL at all (its process links are __doPostBack), so this is as close as a link can get.
 */
export const COMPRAR_PORTAL_URL = "https://comprar.gob.ar/BuscarAvanzado.aspx";

export interface TenderFichaActions {
  saveNote(id: string, text: string): Promise<boolean>;
  registerDocument(input: { tenderId: string; storagePath: string; filename: string; size: number }): Promise<{ ok: boolean }>;
  setTriage(id: string, status: string): Promise<void>;
  analyse(tenderId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  setOwner(id: string, ownerBdId: string): Promise<void>;
  setRequirementStatus(id: string, key: string, status: string | undefined, note?: string): Promise<void>;
}

const when = (d: Date) => `${formatArgentinaDayMonthYear(d)}, ${formatArgentinaDayMonthTime(d).split(", ")[1]}`;

/** Exported for the test: the one place a log entry becomes a sentence. */
export function eventText(e: TenderEventView, l: Dictionary["tenderDetail"], triage: Record<TenderTriage, string>): string {
  const name = (s?: string) => (s && isTenderTriage(s) ? triage[s] : (s ?? ""));
  switch (e.kind) {
    case "triage":
      return fillTemplate(l.eventTriage, { from: name(e.detail.from), to: name(e.detail.to) });
    case "note":
      return e.detail.text ? l.eventNote : l.eventNoteCleared;
    case "document":
      return fillTemplate(l.eventDocument, { filename: e.detail.filename ?? "" });
    case "analysis":
      return fillTemplate(l.eventAnalysis, { filename: e.detail.filename ?? "" });
    case "owner":
      return e.detail.to ? fillTemplate(l.eventOwnerSet, { who: e.detail.to }) : l.eventOwnerCleared;
    case "requirement": {
      const key = e.detail.key;
      const label = key && isRequirementKey(key) ? l[MUST_LIST_ROWS.find(([k]) => k === key)![1]] : (key ?? "");
      const status: Record<string, string> = { pending: l.reqStatusPending, have: l.reqStatusHave, missing: l.reqStatusMissing };
      return fillTemplate(l.eventRequirement, { requirement: label, status: status[e.detail.to ?? ""] ?? "" });
    }
    case "requirement_note": {
      const key = e.detail.key;
      const label = key && isRequirementKey(key) ? l[MUST_LIST_ROWS.find(([k]) => k === key)![1]] : (key ?? "");
      return e.detail.text ? fillTemplate(l.eventRequirementNote, { requirement: label, note: e.detail.text }) : fillTemplate(l.eventRequirementNoteCleared, { requirement: label });
    }
    case "opening": {
      const at = (iso?: string) => (iso && !Number.isNaN(new Date(iso).getTime()) ? when(new Date(iso)) : "");
      return fillTemplate(l.eventOpeningMoved, { from: at(e.detail.from), to: at(e.detail.to) });
    }
    case "relevance":
      return e.detail.to === "relevant" ? l.eventRelevanceRelevant : e.detail.to === "irrelevant" ? l.eventRelevanceIrrelevant : l.eventRelevanceAuto;
  }
}

function Reading({
  analysis,
  tender,
  statuses,
  notes,
  labels: l,
  actions,
}: {
  analysis: TenderAnalysis;
  tender: { id: string; processNumber: string; name: string };
  statuses: TenderDetail["requirementStatuses"];
  notes: TenderDetail["requirementNotes"];
  labels: Dictionary["tenderDetail"];
  actions: TenderFichaActions;
}): ReactNode {
  const lines = mustListLines(analysis.requirements, l, statuses, notes);
  const statusLabels: Record<RequirementStatus, string> = { pending: l.reqStatusPending, have: l.reqStatusHave, missing: l.reqStatusMissing };
  const economicsLines = [
    { label: l.econBudget, value: analysis.economics.budget },
    { label: l.econPayment, value: analysis.economics.paymentTerms },
    { label: l.econPenalties, value: analysis.economics.penalties },
  ];
  return (
    <>
      <p className="strong">{l.analysisSummary}</p>
      <p className="meta">{analysis.summary}</p>
      <p className="strong">{l.analysisViability}</p>
      <p className="meta">{analysis.viability}</p>
      <p className="strong">{analysis.mustListIncluded ? l.mustTitle : l.analysisRequirements}</p>
      {analysis.mustListIncluded ? <p className="help">{l.mustIntro}</p> : <p className="help">{l.mustReanalyse}</p>}
      <ul className="meta">
        {/* A reading from before the must-list only knows the first four; the rest were never asked, so they are not listed as "not stated". */}
        {(analysis.mustListIncluded ? lines : lines.slice(0, 4)).map((line) => (
          <li key={line.key}>
            <span className="strong">{line.label}:</span> {line.value ?? l.reqNotStated}{" "}
            {/* Keyed by the requirement key, not its text: a re-analysis rewrites the text and must not move the answer. */}
            <TenderRequirementStatusSelect
              id={tender.id}
              requirementKey={line.key}
              value={line.status}
              labels={statusLabels}
              ariaLabel={fillTemplate(l.reqStatusLabel, { requirement: line.label })}
              errorLabel={l.reqStatusError}
              setStatus={actions.setRequirementStatus}
            />{" "}
            <TenderRequirementNote
              id={tender.id}
              requirementKey={line.key}
              initial={line.note ?? ""}
              save={actions.setRequirementStatus}
              labels={{ label: fillTemplate(l.reqNoteLabel, { requirement: line.label }), placeholder: l.reqNotePlaceholder, save: l.reqNoteSave, saving: l.reqNoteSaving, error: l.reqNoteError }}
            />
          </li>
        ))}
      </ul>
      {analysis.mustListIncluded && <CopyNumber value={mustListText(analysis.requirements, l, tender, statuses, notes)} label={l.mustCopy} doneLabel={l.mustCopied} />}
      <p className="strong">{l.economicsTitle}</p>
      {analysis.economicsIncluded ? <p className="help">{l.economicsIntro}</p> : <p className="help">{l.economicsReanalyse}</p>}
      {/* A reading from before the economics block never asked these questions, so no line is shown rather than "not stated". */}
      {analysis.economicsIncluded && (
        <ul className="meta">
          {economicsLines.map((line) => (
            <li key={line.label}>
              <span className="strong">{line.label}:</span> {line.value ?? l.reqNotStated}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The ficha of one tender: every stored field, the note, the pliego, its reading and the progress log. Pure view over `detail`. */
export function TenderFicha({
  detail,
  labels: l,
  triageLabels,
  actions,
}: {
  detail: TenderDetail;
  labels: Dictionary["tenderDetail"];
  triageLabels: Record<TenderTriage, string>;
  actions: TenderFichaActions;
}) {
  const { tender: t, documents, events } = detail;
  const doc = currentDocument(documents);
  const analysis = doc?.analysis ?? null;
  // An owner who is not an admin (cannot be set any more, but may predate the rule) is not in the options: show "no owner"
  // rather than a select that silently displays the wrong person. The digest treats such a tender as unowned too.
  const ownerValue = detail.bdOptions.some((o) => o.id === t.ownerBdId) ? (t.ownerBdId ?? "") : "";
  const triage = isTenderTriage(t.triageStatus) ? t.triageStatus : "a_revisar";
  const fields: [string, string][] = [
    [l.fieldFile, t.fileNumber],
    [l.fieldType, t.processType],
    [l.fieldOpening, when(t.openingAt)],
    [l.fieldPortalState, t.portalStatus],
    [l.fieldUnit, t.executingUnit],
    [l.fieldService, t.financialAdminService],
  ];

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">
            <Link href="/licitaciones">{l.back}</Link>
          </div>
          <h1>
            {t.name}
            <span className="dot">.</span>
          </h1>
        </div>
      </div>

      <div className="grid-2 mb-lg">
        <div className="card">
          <div className="card-header">
            <h3>{l.dataTitle}</h3>
          </div>
          <div className="card-body">
            <dl className="props">
              <div className="prop">
                <dt>{l.fieldProcess}</dt>
                <dd>
                  <span className="mono strong">{t.processNumber}</span>
                  <CopyNumber value={t.processNumber} label={l.copy} doneLabel={l.copied} />
                  <a className="btn btn-secondary btn-sm" href={COMPRAR_PORTAL_URL} target="_blank" rel="noopener noreferrer">
                    {l.openPortal}
                  </a>
                </dd>
                <span className="hint">{l.portalHint}</span>
              </div>
              {fields
                .filter(([, v]) => v !== "")
                .map(([label, value]) => (
                  <div className="prop" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              <div className="prop">
                <dt>{l.ownerLabel}</dt>
                <dd>
                  <TenderOwnerSelect id={t.id} value={ownerValue} options={detail.bdOptions} noneLabel={l.ownerNone} ariaLabel={l.ownerLabel} errorLabel={l.ownerError} setOwner={actions.setOwner} />
                  <div className="meta">{l.ownerAdminsOnly}</div>
                </dd>
              </div>
              <div className="prop">
                <dt>{l.fieldTriage}</dt>
                <dd>
                  <TenderTriageSelect id={t.id} value={triage} labels={triageLabels} ariaLabel={l.fieldTriage} errorLabel={l.noteError} setTriage={actions.setTriage} />
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{l.noteTitle}</h3>
          </div>
          <div className="card-body">
            <TenderNoteForm
              tenderId={t.id}
              initial={t.note ?? ""}
              save={actions.saveNote}
              labels={{ label: l.noteLabel, placeholder: l.notePlaceholder, save: l.noteSave, saving: l.noteSaving, saved: l.noteSaved, error: l.noteError }}
            />
          </div>
        </div>
      </div>

      <TenderPortalBlock portal={detail.portal} labels={l} when={when} />

      <div className="card mb-lg">
        <div className="card-header">
          <h3>{l.documentTitle}</h3>
        </div>
        <div className="card-body stack">
          {doc && (
            <p className="meta">
              <a className="strong" href={`/licitaciones/${t.id}/documento`}>
                {doc.filename}
              </a>{" "}
              · {fillTemplate(doc.uploadedBy ? l.documentMetaBy : l.documentMeta, { size: formatAttachmentSize(doc.sizeBytes), who: doc.uploadedBy ?? "", when: when(doc.createdAt) })}
            </p>
          )}
          <TenderDocumentUpload
            tenderId={t.id}
            register={actions.registerDocument}
            labels={{ label: l.uploadLabel, help: l.uploadHelp, uploading: l.uploading, errors: l.uploadErrors }}
          />
        </div>
      </div>

      <div className="card mb-lg">
        <div className="card-header">
          <h3>{l.analysisTitle}</h3>
        </div>
        <div className="card-body stack">
          {!doc && (
            <div className="alert alert-warn">
              <div>
                <span className="title">{l.noDocTitle}</span> {l.noDocBody}
              </div>
            </div>
          )}
          {doc && analysis && (
            <>
              <p className="help">
                {fillTemplate(analysis.pages ? l.analysisGeneratedPages : l.analysisGenerated, { filename: doc.filename, pages: String(analysis.pages ?? ""), when: doc.analyzedAt ? when(doc.analyzedAt) : "" })}
                {doc.analyzedBy ? fillTemplate(l.analysisGeneratedBy, { who: doc.analyzedBy }) : ""}
              </p>
              <Reading analysis={analysis} tender={t} statuses={detail.requirementStatuses} notes={detail.requirementNotes} labels={l} actions={actions} />
            </>
          )}
          {doc && !analysis && <p className="meta">{l.analysisPending}</p>}
          <TenderAnalyseButton
            tenderId={t.id}
            disabled={!canAnalyse(doc)}
            label={analysis ? l.reanalyse : l.analyse}
            busyLabel={l.analysing}
            analyse={actions.analyse}
            errors={l.analysisErrors}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{l.logTitle}</h3>
        </div>
        <div className="card-body">
          {events.length === 0 ? (
            <p className="meta">{l.logEmpty}</p>
          ) : (
            <div className="tl">
              {events.map((e) => (
                <div className="tl-item" key={e.id}>
                  <div className="tl-icon system" aria-hidden="true" />
                  <div className="tl-card system">
                    <div className="tl-head">
                      <span className="what">{eventText(e, l, triageLabels)}</span>
                      <span className="when">
                        {e.actor ?? (e.kind === "opening" ? l.eventActorPortal : l.someone)}, {when(e.createdAt)}
                      </span>
                    </div>
                    {e.kind === "note" && e.detail.text && <div className="tl-body"><blockquote>{e.detail.text}</blockquote></div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

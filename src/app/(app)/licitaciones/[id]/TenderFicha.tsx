import Link from "next/link";
import type { ReactNode } from "react";
import { canAnalyse, currentDocument, type TenderAnalysis } from "@/lib/tenders/analysis";
import type { TenderDetail, TenderEventView } from "@/lib/tenders/detail";
import { isTenderTriage, type TenderTriage } from "@/lib/tenders/triage";
import { formatAttachmentSize } from "@/lib/email/attachments/policy";
import { formatArgentinaDayMonthTime, formatArgentinaDayMonthYear } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { TenderTriageSelect } from "../TenderTriageSelect";
import { CopyNumber } from "./CopyNumber";
import { TenderAnalyseButton } from "./TenderAnalyseButton";
import { TenderDocumentUpload } from "./TenderDocumentUpload";
import { TenderNoteForm } from "./TenderNoteForm";

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
}

const when = (d: Date) => `${formatArgentinaDayMonthYear(d)}, ${formatArgentinaDayMonthTime(d).split(", ")[1]}`;

function eventText(e: TenderEventView, l: Dictionary["tenderDetail"], triage: Record<TenderTriage, string>): string {
  const name = (s?: string) => (s && isTenderTriage(s) ? triage[s] : (s ?? ""));
  switch (e.kind) {
    case "triage":
      return l.eventTriage(name(e.detail.from), name(e.detail.to));
    case "note":
      return e.detail.text ? l.eventNote : l.eventNoteCleared;
    case "document":
      return l.eventDocument(e.detail.filename ?? "");
    case "analysis":
      return l.eventAnalysis(e.detail.filename ?? "");
  }
}

function Reading({ analysis, labels: l }: { analysis: TenderAnalysis; labels: Dictionary["tenderDetail"] }): ReactNode {
  const r = analysis.requirements;
  const rows: [string, string | null][] = [
    [l.reqRegistration, r.registration],
    [l.reqAntecedents, r.antecedents],
    [l.reqGuarantee, r.guarantee],
    [l.reqDeadline, r.submissionDeadline],
  ];
  return (
    <>
      <p className="strong">{l.analysisSummary}</p>
      <p className="meta">{analysis.summary}</p>
      <p className="strong">{l.analysisViability}</p>
      <p className="meta">{analysis.viability}</p>
      <p className="strong">{l.analysisRequirements}</p>
      <ul className="meta">
        {rows.map(([label, value]) => (
          <li key={label}>
            <span className="strong">{label}:</span> {value ?? l.reqNotStated}
          </li>
        ))}
      </ul>
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
              · {l.documentMeta(formatAttachmentSize(doc.sizeBytes), doc.uploadedBy, when(doc.createdAt))}
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
              <p className="help">{l.analysisGenerated(doc.filename, analysis.pages, doc.analyzedAt ? when(doc.analyzedAt) : "", doc.analyzedBy)}</p>
              <Reading analysis={analysis} labels={l} />
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
                        {e.actor ?? l.someone}, {when(e.createdAt)}
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

/**
 * Static content for `/contact-status` (openspec/changes/contact-status-guide).
 * Spanish-only, developer-edited, not DB-backed — same convention as
 * `src/lib/roleGroupPlaybook.ts` for the sibling "Guía de roles" page (D10,
 * `src/lib/i18n/locales.ts`: the product ships Spanish-only). Every row here
 * was checked against `src/lib/status/deriveStatus.ts` (the
 * `FIXED_STAGE_BY_TYPE` table, `callStage`, `pickHigherStage`,
 * `deriveStatusFull`'s discard rule) and `src/lib/reports/pipeline.ts`
 * (`PIPELINE_STAGE_ORDER`) before being written — see that change's
 * README.md "Accuracy".
 */
import type { StatusStage } from "@/lib/status/deriveStatus";
import { PIPELINE_STAGE_ORDER, type PipelineStage } from "@/lib/reports/pipeline";

/** Stage progression order for the page's top "Nuevo → ... → Reunión" strip. */
export const STATUS_STAGE_ORDER: readonly StatusStage[] = ["new", "contacted", "replied", "meeting"];

/**
 * "Qué mueve cada etapa" table rows — one row per activity type/rule that
 * `activityStageCandidate`/`connectionStageCandidate` recognize
 * (deriveStatus.ts). Order matches the copy the owner approved, not the
 * source file's declaration order.
 */
export interface ActivityStageRow {
  activity: string;
  /**
   * Omitted for a row that does NOT move the status (`callStage`'s inbound,
   * not-connected case returns `null`) — the page then renders `resultText`
   * as plain text instead of a status badge, so a non-outcome can never be
   * mistaken for a fake stage.
   */
  stage?: StatusStage;
  /** Plain-text result shown instead of a badge when `stage` is absent. */
  resultText?: string;
}

export const ACTIVITY_STAGE_ROWS: readonly ActivityStageRow[] = [
  { activity: "Correo enviado", stage: "contacted" },
  { activity: "Respuesta recibida", stage: "replied" },
  { activity: "Reunión registrada", stage: "meeting" },
  // `callStage` (deriveStatus.ts): connected -> replied (either direction);
  // outbound not connected -> contacted; inbound not connected -> no stage.
  { activity: "Llamada conectada, entrante o saliente", stage: "replied" },
  { activity: "Llamada saliente que no conectó", stage: "contacted" },
  { activity: "Llamada entrante que no conectó", resultText: "No cambia el estado" },
  { activity: "Conexión de LinkedIn con mensajes que enviaste", stage: "contacted" },
  { activity: "Conexión de LinkedIn con mensajes que recibiste", stage: "replied" },
];

/**
 * "Etapa de la empresa" table — one reason per `PIPELINE_STAGE_ORDER` entry
 * (pipeline.ts). Keyed by stage so rendering can iterate
 * `PIPELINE_STAGE_ORDER` itself and never drift out of sync with it.
 */
export const PIPELINE_STAGE_REASON: Record<PipelineStage, string> = {
  prospect: "Todavía no sabemos si hay oportunidad",
  qualified: "Confirmamos que hay necesidad, presupuesto y con quién hablar",
  proposal_sent: "Ya mandamos números",
  won: "Cerró",
  lost: "Se cayó, o no va a avanzar",
};

/** Re-exported so the page doesn't need a second import for the same order. */
export { PIPELINE_STAGE_ORDER };

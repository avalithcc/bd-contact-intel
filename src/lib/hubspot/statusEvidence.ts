/**
 * Pure past-outreach -> `status_backfill` activity planning (design D5,
 * hubspot-import spec "Status-evidence backfill activities" / "Discard
 * evidence preserves the historical date"). No DB access — the caller
 * (src/lib/hubspot/planner.ts, task 3.9) writes the planned activities.
 *
 * At most ONE stage backfill (the highest of contacted/replied) plus at
 * most ONE discard are emitted per row — they are evaluated independently
 * (a row can carry both contacted evidence AND a `No calificado` lead
 * status), sharing the exact same `originalAt`. Because `deriveStatus()`
 * (src/lib/status/deriveStatus.ts) picks the discard when it is NEWER THAN
 * OR EQUAL TO every stage event, a same-timestamp discard always wins —
 * this is deliberate (design D5: "the discard wins in deriveStatus").
 */
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";

export type StatusBackfillStage = "contacted" | "replied";
export type StatusEvidenceStatus = StatusBackfillStage | "discarded";

export interface StatusEvidenceActivityMetadata {
  status: StatusEvidenceStatus;
  reason?: "wrong_profile";
  originalEditorBdId: string | null;
  /** ISO string — the historical evidence date, never the import run time
   * unless every date field on the row was missing (see `dateFallback`). */
  originalAt: string;
  source: "hubspot_import";
  hubspotContactId: string;
}

export interface StatusEvidenceActivity {
  status: StatusEvidenceStatus;
  reason?: "wrong_profile";
  /** `(hubspotContactId, status)` (task 3.7) — lets the caller skip an
   * insert when an activity with this key already exists (idempotent
   * re-import: a later export can advance a status without duplicates). */
  idempotencyKey: string;
  metadata: StatusEvidenceActivityMetadata;
}

export interface StatusEvidencePlan {
  activities: StatusEvidenceActivity[];
  originalAt: Date;
  /** True when every one of lastContactAt/lastActivityAt/createdAt was
   * missing and `originalAt` fell back to the import run time. */
  dateFallback: boolean;
  /** The raw HubSpot lead status text when it is non-empty and NOT one of
   * the known values below (H6 dry-run finding: the real export uses
   * different labels than initially assumed) — reported by the caller
   * under `report.warnings.unknownLeadStatuses`, never used to plan an
   * activity. `null` for empty or recognized statuses. */
  unknownLeadStatus: string | null;
}

/** Every lead status value this module knows how to interpret — anything
 * else (non-empty) is reported as `unknownLeadStatus` instead of silently
 * producing no evidence. `Nuevo`/`Abierto` are known but intentionally
 * carry no evidence (design D5). */
const KNOWN_LEAD_STATUSES = new Set([
  "Nuevo",
  "Abierto",
  "En curso",
  "Conectado",
  "Mal momento",
  "Negocio abierto",
  "Intento de contacto",
  "Sin calificar",
  "No calificado",
]);

/** An open deal means the contact engaged (H6 dry-run finding). */
const REPLIED_LEAD_STATUSES = new Set(["Conectado", "Mal momento", "Negocio abierto"]);
/** `Sin calificar` is the value the real HubSpot export actually uses;
 * `No calificado` is kept as an accepted alias (H6 dry-run finding: the
 * initial mapping assumed the latter and the discarded count came out 0). */
const DISCARD_LEAD_STATUSES = new Set(["Sin calificar", "No calificado"]);
const CONTACTED_LEAD_STATUSES = new Set(["En curso", "Intento de contacto"]);

function resolveStage(contact: HubSpotContactRow): StatusBackfillStage | null {
  if (contact.leadStatus && REPLIED_LEAD_STATUSES.has(contact.leadStatus)) return "replied";
  if (
    contact.timesContacted > 0 ||
    contact.lastContactAt !== null ||
    (contact.leadStatus !== null && CONTACTED_LEAD_STATUSES.has(contact.leadStatus))
  ) {
    return "contacted";
  }
  return null;
}

function resolveUnknownLeadStatus(contact: HubSpotContactRow): string | null {
  const status = contact.leadStatus;
  if (!status || !status.trim()) return null;
  return KNOWN_LEAD_STATUSES.has(status) ? null : status;
}

function resolveOriginalAt(contact: HubSpotContactRow, runAt: Date): { at: Date; dateFallback: boolean } {
  const candidate = contact.lastContactAt ?? contact.lastActivityAt ?? contact.createdAt;
  return candidate ? { at: candidate, dateFallback: false } : { at: runAt, dateFallback: true };
}

/** `(hubspotContactId, status)` (task 3.7). */
export function statusBackfillIdempotencyKey(hubspotContactId: string, status: StatusEvidenceStatus): string {
  return `${hubspotContactId}:${status}`;
}

function buildActivity(
  contact: HubSpotContactRow,
  status: StatusEvidenceStatus,
  reason: "wrong_profile" | undefined,
  originalEditorBdId: string | null,
  originalAt: Date,
): StatusEvidenceActivity {
  const metadata: StatusEvidenceActivityMetadata = {
    status,
    originalEditorBdId,
    originalAt: originalAt.toISOString(),
    source: "hubspot_import",
    hubspotContactId: contact.hubspotContactId,
  };
  if (reason) metadata.reason = reason;
  return {
    status,
    ...(reason ? { reason } : {}),
    idempotencyKey: statusBackfillIdempotencyKey(contact.hubspotContactId, status),
    metadata,
  };
}

/**
 * Plans (at most) one stage-backfill activity and (at most) one discard
 * activity for a single HubSpot contact row (tasks 3.5-3.7).
 */
export function planStatusEvidence(
  contact: HubSpotContactRow,
  ownerBdId: string | null,
  runAt: Date,
): StatusEvidencePlan {
  const { at: originalAt, dateFallback } = resolveOriginalAt(contact, runAt);
  const activities: StatusEvidenceActivity[] = [];

  const stage = resolveStage(contact);
  if (stage) activities.push(buildActivity(contact, stage, undefined, ownerBdId, originalAt));

  if (contact.leadStatus !== null && DISCARD_LEAD_STATUSES.has(contact.leadStatus)) {
    activities.push(buildActivity(contact, "discarded", "wrong_profile", ownerBdId, originalAt));
  }

  return { activities, originalAt, dateFallback, unknownLeadStatus: resolveUnknownLeadStatus(contact) };
}

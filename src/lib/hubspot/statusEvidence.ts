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
}

const REPLIED_LEAD_STATUSES = new Set(["Conectado", "Mal momento"]);
const DISCARD_LEAD_STATUS = "No calificado";

function resolveStage(contact: HubSpotContactRow): StatusBackfillStage | null {
  if (contact.leadStatus && REPLIED_LEAD_STATUSES.has(contact.leadStatus)) return "replied";
  if (contact.timesContacted > 0 || contact.lastContactAt !== null || contact.leadStatus === "En curso") {
    return "contacted";
  }
  return null;
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

  if (contact.leadStatus === DISCARD_LEAD_STATUS) {
    activities.push(buildActivity(contact, "discarded", "wrong_profile", ownerBdId, originalAt));
  }

  return { activities, originalAt, dateFallback };
}

/**
 * Pure re-import planner (design D4 "Re-import (R7/Q3)", task 3.8) for a
 * HubSpot row whose `hubspotContactId` was already imported in a prior run
 * (the "already_imported" outcome, task 3.10) — these rows skip the
 * matcher entirely (design D4: "Rows already mapped skip the matcher").
 *
 * Distinct from R7 (src/lib/identity/matcher.ts's mergeProperty, used by
 * the live-ingestion resolver's default 'r7' mergePolicy): R7 lets a MORE
 * SPECIFIC incoming value win a genuine conflict, even over a non-empty
 * existing value. `planHubSpotRefill` never does that — it only ever fills
 * a field that is CURRENTLY empty, so re-running the same export twice is
 * a true no-op on every field a human has since edited in the app. No DB
 * access — src/lib/hubspot/planner.ts (task 3.9) wires this against the
 * DB snapshot and writes personUpdate + historyRows in the execute
 * transaction.
 */
import type { NewPerson, NewPersonPropertyHistory } from "@/db/schema";
import type { EmailStatus } from "@/lib/identity/matcher";

type HistoryRow = Omit<NewPersonPropertyHistory, "id" | "at">;

export interface HubSpotRefillExistingPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  jobTitle: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  ownerBdId: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
}

export interface HubSpotRefillIncoming {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyKey: string | null;
  jobTitle: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  ownerBdId: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
}

export interface HubSpotRefillPlan {
  changed: boolean;
  personUpdate: Partial<NewPerson> | null;
  historyRows: HistoryRow[];
}

function hasValue(v: string | null): boolean {
  return v != null && v !== "";
}

/** Fills one scalar field only when `existingValue` is empty; returns the
 * history row to append, or null when there's nothing to fill (existing
 * already has a value, or incoming has nothing to offer). */
function fillField(
  personId: string,
  property: string,
  existingValue: string | null,
  incomingValue: string | null,
): { value: string; historyRow: HistoryRow } | null {
  if (hasValue(existingValue) || !hasValue(incomingValue)) return null;
  return {
    value: incomingValue!,
    historyRow: { personId, property, oldValue: existingValue ?? null, newValue: incomingValue, changedByBdId: null, source: "import" },
  };
}

/**
 * Plans a re-import fill (task 3.8): every field independently fills only
 * when currently empty; the email fields (email/emailNormalized/
 * emailStatus/emailConfidence/emailSource) move together as ONE unit, only
 * filling when the existing `email` is empty — an existing email (any
 * status, even `'none'`-with-no-value doesn't count, but a real `'probable'`
 * one does) is never replaced.
 */
export function planHubSpotRefill(
  existingPerson: HubSpotRefillExistingPerson,
  incomingRow: HubSpotRefillIncoming,
): HubSpotRefillPlan {
  const personUpdate: Partial<NewPerson> = {};
  const historyRows: HistoryRow[] = [];

type SimpleRefillField =
  | "firstName"
  | "lastName"
  | "company"
  | "companyKey"
  | "jobTitle"
  | "industry"
  | "city"
  | "country"
  | "ownerBdId";

const SIMPLE_REFILL_FIELDS: readonly SimpleRefillField[] = [
  "firstName",
  "lastName",
  "company",
  "companyKey",
  "jobTitle",
  "industry",
  "city",
  "country",
  "ownerBdId",
];
  for (const field of SIMPLE_REFILL_FIELDS) {
    const filled = fillField(existingPerson.id, field, existingPerson[field], incomingRow[field]);
    if (!filled) continue;
    (personUpdate as Record<string, unknown>)[field] = filled.value;
    historyRows.push(filled.historyRow);
  }

  if (!hasValue(existingPerson.email) && hasValue(incomingRow.email)) {
    const newEmail = incomingRow.email!;
    const newNormalized = newEmail.trim().toLowerCase();
    personUpdate.email = newEmail;
    personUpdate.emailNormalized = newNormalized;
    personUpdate.emailStatus = incomingRow.emailStatus;
    personUpdate.emailConfidence = incomingRow.emailConfidence ?? null;
    personUpdate.emailSource = incomingRow.emailSource ?? null;
    historyRows.push(
      { personId: existingPerson.id, property: "email", oldValue: existingPerson.email ?? null, newValue: newEmail, changedByBdId: null, source: "import" },
      { personId: existingPerson.id, property: "emailNormalized", oldValue: existingPerson.emailNormalized ?? null, newValue: newNormalized, changedByBdId: null, source: "import" },
      { personId: existingPerson.id, property: "emailStatus", oldValue: existingPerson.emailStatus ?? null, newValue: incomingRow.emailStatus, changedByBdId: null, source: "import" },
      { personId: existingPerson.id, property: "emailSource", oldValue: existingPerson.emailSource ?? null, newValue: incomingRow.emailSource ?? null, changedByBdId: null, source: "import" },
    );
  }

  if (Object.keys(personUpdate).length === 0) {
    return { changed: false, personUpdate: null, historyRows: [] };
  }
  personUpdate.updatedAt = new Date();
  return { changed: true, personUpdate, historyRows };
}

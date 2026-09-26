/**
 * Pure HubSpotContactRow -> IdentityIngestRow mapper (design D4, task 3.4).
 * No DB access — the caller resolves `companyKey` (src/lib/hubspot/
 * companies.ts, Phase 2) and `ownerBdId` (src/lib/hubspot/owners.ts) first
 * and passes them in, so this module stays pure and independently testable.
 */
import { normalizeProfileKey } from "@/lib/csv";
import { hubspotLegacyId } from "@/lib/hubspot/uuidv5";
import type { IdentityIngestRow } from "@/lib/identity/resolve";
import type { HubSpotContactRow } from "@/lib/hubspot/contacts";

export interface MapHubSpotContactToIdentityRowInput {
  contact: HubSpotContactRow;
  /** Resolved via src/lib/hubspot/companies.ts#resolveContactCompanyKey (Phase 2) — null when unresolved/own-company. */
  companyKey: string | null;
  /** Resolved via src/lib/hubspot/owners.ts#matchHubSpotOwner — null when unassigned. */
  ownerBdId: string | null;
  /** The migration_run creating this row; null outside an execute transaction (e.g. dry-run planning). */
  migrationRunId: string | null;
}

/**
 * Maps one HubSpot contact row to an `IdentityIngestRow` (contact-identity
 * spec "HubSpot emails are stored as probable"; design D4): `legacyTable:
 * 'hubspot_contact'`, a deterministic `legacyId` (uuid v5 over the raw
 * HubSpot record id), `profileKey` from the contact's LinkedIn URL,
 * `emailStatus: 'probable'`/`emailSource: 'hubspot_import'` only when an
 * email is present (no email keeps the ordinary `'none'` default so an
 * empty string never masquerades as a real, if unverified, email). `bdId`
 * mirrors `ownerBdId` — nullable, no `person_bd_connection` row is written
 * for a HubSpot owner (design D4: "a HubSpot owner is not a LinkedIn
 * connection").
 */
export function mapHubSpotContactToIdentityRow({
  contact,
  companyKey,
  ownerBdId,
  migrationRunId,
}: MapHubSpotContactToIdentityRowInput): IdentityIngestRow {
  const hasEmail = contact.email !== null;
  return {
    legacyTable: "hubspot_contact",
    legacyId: hubspotLegacyId(contact.hubspotContactId),
    bdId: ownerBdId,
    profileKey: contact.linkedinUrl ? normalizeProfileKey(contact.linkedinUrl) : null,
    connectedOn: null,
    firstName: contact.firstName,
    lastName: contact.lastName,
    // No raw company display text is captured on the HubSpot contact export
    // (only the resolved company link, Phase 2) — left null; the resolved
    // companyKey below is the source of truth for matching and linking.
    company: null,
    companyKey,
    jobTitle: contact.jobTitle,
    industry: null,
    email: contact.email,
    emailStatus: hasEmail ? "probable" : "none",
    emailConfidence: null,
    emailSource: hasEmail ? "hubspot_import" : null,
    ownerBdId,
    city: contact.city,
    country: contact.country,
    migrationRunId,
  };
}

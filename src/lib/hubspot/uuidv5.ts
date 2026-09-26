/**
 * Deterministic HubSpot record id -> uuid derivation (design D1).
 *
 * `person_id_map.legacy_id` is a `uuid` column, and the contact-migration
 * delta forbids changing it to `text`. HubSpot record IDs are numeric
 * strings, so they are mapped via UUID v5 (name-based, SHA-1) under a fixed
 * namespace, scoped by `legacy_table = 'hubspot_contact'` so they can never
 * collide with the existing `contact`/`lead` legacy ids.
 *
 * HUBSPOT_NAMESPACE is pinned by a test vector (tests/unit/hubspotUuidv5.test.ts).
 * Changing it would silently break idempotent re-import for every
 * already-imported contact, since the same HubSpot id would derive a new
 * `legacy_id` on the next run.
 */
import { createHash } from "node:crypto";

export const HUBSPOT_NAMESPACE = "db3997e9-495c-4cb4-aa7c-02c858215bac";

function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const hash = createHash("sha1").update(Buffer.concat([namespaceBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // Per RFC 4122 §4.3: set version (5) and variant (RFC 4122) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Deterministic `person_id_map.legacy_id` for a HubSpot record id. */
export function hubspotLegacyId(hubspotRecordId: string): string {
  return uuidv5(hubspotRecordId, HUBSPOT_NAMESPACE);
}

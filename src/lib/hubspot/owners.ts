/**
 * HubSpot owner -> BD mapping (hubspot-import spec "Owner mapping", design
 * D4). `normalizeNameKey(hubspotOwner) === normalizeNameKey(bd.name)` —
 * reuses the accent/case-insensitive name fold already used for
 * leads-import owner matching, so "Macarena Davila" matches BD
 * "Macarena Dávila". Blank or deactivated owners are unassigned. An unknown
 * (non-blank, non-deactivated) name is also unassigned, but reported
 * distinctly so the dry-run report can surface it. BD names are not
 * contact PII.
 */
import { normalizeNameKey } from "@/lib/leads/csv";

const DEACTIVATED_SUFFIX_RE = /\(deactivated[^)]*\)\s*$/i;

export interface HubSpotOwnerMatch {
  /** Matched BD id, or null when unassigned (blank, deactivated, or unknown). */
  bdId: string | null;
  /** The raw owner name, only when it was non-blank, non-deactivated, and
   * did not match any BD — for the dry-run report's "unknown owners" count. */
  unknownOwnerName: string | null;
}

/** True for HubSpot's "(Deactivated User)" (or similar) owner-name suffix. */
export function isDeactivatedOwner(ownerRaw: string): boolean {
  return DEACTIVATED_SUFFIX_RE.test(ownerRaw.trim());
}

export function matchHubSpotOwner(
  ownerRaw: string,
  bds: readonly { id: string; name: string }[],
): HubSpotOwnerMatch {
  const trimmed = ownerRaw.trim();
  if (!trimmed || isDeactivatedOwner(trimmed)) {
    return { bdId: null, unknownOwnerName: null };
  }

  const ownerKey = normalizeNameKey(trimmed);
  const match = bds.find((bd) => normalizeNameKey(bd.name) === ownerKey);
  if (match) {
    return { bdId: match.id, unknownOwnerName: null };
  }

  return { bdId: null, unknownOwnerName: trimmed };
}

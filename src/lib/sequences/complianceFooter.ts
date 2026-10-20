/**
 * Deterministic CAN-SPAM footer: postal address + opt-out text + per-recipient link, appended by the system after the
 * generated body, never written by the model. Pure: the config is a parameter, so the footer is testable and a changed
 * address in config.ts changes it with no other edit.
 *
 * An address with no config entry returns an explicit `unmapped` result. There is no default address.
 */
import type { ComplianceAddress } from "@/lib/sequences/complianceAudience";
import type { AddressComplianceEntry, ComplianceConfig } from "@/lib/sequences/config";

export type FooterResult = { status: "ok"; text: string } | { status: "unmapped"; address: ComplianceAddress };
export type AppendResult = { status: "ok"; body: string } | { status: "unmapped"; address: ComplianceAddress };

function entryFor(config: ComplianceConfig, address: ComplianceAddress): AddressComplianceEntry | null {
  return Object.hasOwn(config, address) ? (config[address] ?? null) : null;
}

export function buildFooter(config: ComplianceConfig, address: ComplianceAddress, unsubscribeUrl: string): FooterResult {
  const entry = entryFor(config, address);
  if (!entry) return { status: "unmapped", address };
  return { status: "ok", text: `--\n${entry.postalAddress}\n\n${entry.optOutText}\n${unsubscribeUrl}` };
}

/** The generated body, then a blank line, then the footer. Used for step 1 and for the reminder. */
export function appendFooter(
  body: string,
  config: ComplianceConfig,
  address: ComplianceAddress,
  unsubscribeUrl: string,
): AppendResult {
  const footer = buildFooter(config, address, unsubscribeUrl);
  if (footer.status === "unmapped") return footer;
  return { status: "ok", body: `${body.trimEnd()}\n\n${footer.text}` };
}

/**
 * Send gate on the FINAL body (after any BD edit): true only when the address's configured address and opt-out text are
 * both still present. False for an address with no entry. The per-recipient link is not checked here: it varies per member.
 */
export function bodyHasFooter(body: string, config: ComplianceConfig, address: ComplianceAddress): boolean {
  const entry = entryFor(config, address);
  if (!entry) return false;
  return body.includes(entry.postalAddress) && body.includes(entry.optOutText);
}

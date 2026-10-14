/**
 * Company-wide send suppression (CAN-SPAM opt-out). Pure: no DB import, so it is unit-testable with no DATABASE_URL.
 *
 * Deliberately NOT the per-BD "never log" list. email_never_log makes the classifier discard the ENTIRE message when
 * any participant matches, which would hide that person's future replies and erase threads where they are only CC'd.
 * A suppressed address must still be seen by reply detection; it must only never be written to.
 *
 * `SuppressionRule` and `NeverLogRule` are distinct types on purpose: the rule field is `ruleKind`, not `kind`, so
 * neither is assignable to the other and a suppression list can never be handed to the classifier by mistake.
 */
import { normalizeNeverLogValue } from "@/lib/gmail/neverLogRules";

export type SuppressionKind = "address" | "domain";

export interface SuppressionRule {
  readonly ruleKind: SuppressionKind;
  /** Already normalized (see normalizeSuppressionValue). */
  readonly value: string;
}

/** One normalization rule for both lists: trim + lowercase, and strip a leading "@" from a domain. */
export function normalizeSuppressionValue(kind: SuppressionKind, rawValue: string): string {
  return normalizeNeverLogValue(kind, rawValue);
}

/**
 * True when the address must never receive Sequence email. A domain rule matches that EXACT domain, the same
 * semantics as never-log (no subdomain or suffix matching). An address that cannot be parsed fails CLOSED: it cannot
 * be sent to anyway, and "unknown" must never read as "allowed".
 */
export function isSuppressed(address: string, rules: readonly SuppressionRule[]): boolean {
  const normalized = normalizeSuppressionValue("address", address);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return true;
  const domain = normalized.slice(at + 1);
  return rules.some((rule) => (rule.ruleKind === "address" ? rule.value === normalized : rule.value === domain));
}

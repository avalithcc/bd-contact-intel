/**
 * The SINGLE source of the sender's postal address and the opt-out text for Sequence email (CAN-SPAM). Nothing else
 * under src/lib/sequences may carry these strings (tests/unit/sequencesNoHardcodedAddress.test.ts enforces it), so a
 * later change of office is an edit to this file only.
 *
 * Keyed by the RECIPIENT's market (classifyMarket in src/lib/hiring/markets.ts), and the key is mandatory, not a
 * default. `other` has deliberately NO entry: the system refuses to send rather than pick an address, because a wrong
 * country's address is still a compliance failure. Do not add a fallback here.
 *
 * `Ste G` is confirmed against the primary Florida record (search.sunbiz.org, document P18000083350). Commercial
 * aggregators report `Ste K`; they are wrong and are not a source for this field.
 */
import type { MarketKey } from "@/lib/hiring/markets";

export interface MarketComplianceEntry {
  /** One line, exactly as it must appear in the message. */
  readonly postalAddress: string;
  /** The opt-out instruction. The per-recipient link is appended after it by the footer builder. */
  readonly optOutText: string;
}

export type ComplianceConfig = Readonly<Partial<Record<MarketKey, MarketComplianceEntry>>>;

const OPT_OUT_TEXT =
  "If you would rather not receive further emails from us, use the link below or simply reply with \"unsubscribe\".";

export const COMPLIANCE_CONFIG: ComplianceConfig = {
  us: {
    postalAddress: "Avalith Corporation, 470 Ansin Blvd Ste G, Hallandale, FL 33009, USA",
    optOutText: OPT_OUT_TEXT,
  },
  latam: {
    postalAddress: "Avalith, Formosa 2531, B7600 Mar del Plata, Buenos Aires, Argentina",
    optOutText: OPT_OUT_TEXT,
  },
};

/**
 * The SINGLE source of the sender's postal address and the opt-out text for Sequence email (CAN-SPAM). Nothing else
 * under src/lib/sequences may carry these strings (tests/unit/sequencesNoHardcodedAddress.test.ts enforces it), so a
 * later change of office is an edit to this file only.
 *
 * Keyed by the ADDRESS the recipient's audience resolves to (resolveComplianceAudience in complianceAudience.ts):
 * "mdp" for Argentina, "miami" for every other located country. The key is mandatory, not a default. A contact with no
 * audience (no location signal, or an embargoed jurisdiction) has NO address: the system refuses to send rather than pick
 * one, because a wrong country's address is still a compliance failure. Do not add a fallback here. The keys of
 * COMPLIANCE_CONFIG are about the postal address only. The opt-out sentence is the audience's OTHER field: it is keyed by
 * LANGUAGE in OPT_OUT_TEXT below, because the two are independent (a Spanish email can carry the Miami address).
 *
 * `Ste G` is confirmed against the primary Florida record (search.sunbiz.org, document P18000083350). Commercial
 * aggregators report `Ste K`; they are wrong and are not a source for this field.
 */
import type { AudienceLanguage, ComplianceAddress } from "./complianceAudience";

export interface AddressComplianceEntry {
  /** One line, exactly as it must appear in the message. */
  readonly postalAddress: string;
}

export type ComplianceConfig = Readonly<Partial<Record<ComplianceAddress, AddressComplianceEntry>>>;

/**
 * The opt-out instruction, keyed by the audience's language. The per-recipient link is appended after it by the footer
 * builder. The keys are AudienceLanguage (es | en) on purpose: that is all the compliance audience ever resolves to
 * (audienceOfCountry, fromPostingBucket). MessageLanguage also has "pt", but that belongs to the one-off message dialog,
 * which has no footer; a "pt" entry here would be unreachable.
 *
 * Each sentence names the word a recipient can reply with ("unsubscribe", "baja"), and that word MUST be one the advisory
 * detector recognises (PHRASES in optOutPhrases.ts), or we would tell people to do something the system ignores. The
 * detector also strips every sentence here before matching (ALL_OPT_OUT_TEXTS), so quoting our footer never raises a prompt.
 */
export const OPT_OUT_TEXT: Readonly<Record<AudienceLanguage, string>> = {
  en: "If you would rather not receive further emails from us, use the link below or simply reply with \"unsubscribe\".",
  es: "Si prefieres no recibir más correos nuestros, usa el enlace de abajo o simplemente responde a este mensaje con la palabra \"baja\".",
};

/** Every configured sentence in every language: what the send gate accepts and what the detector strips. */
export const ALL_OPT_OUT_TEXTS: readonly string[] = Object.values(OPT_OUT_TEXT);

export const COMPLIANCE_CONFIG: ComplianceConfig = {
  miami: {
    postalAddress: "Avalith Corporation, 470 Ansin Blvd Ste G, Hallandale, FL 33009, USA",
  },
  mdp: {
    postalAddress: "Avalith, Formosa 2531, B7600 Mar del Plata, Buenos Aires, Argentina",
  },
};

/**
 * How old `email_account.last_synced_at` may be before a REMINDER is held instead of sent (reply detection needs the
 * Gmail sync to have seen any reply). 26h = the 24h daily Vercel safety net (`/api/gmail/sync` in vercel.json, the only
 * cadence this repo itself guarantees) + the spec's 2h grace. The real cadence is pg_cron every 2 minutes, but pinning
 * the check to that would hold nearly every reminder whenever pg_cron is paused; pinning it to the guarantee holds only
 * when the guarantee is actually missed. If the daily net ever stops being the floor, drop this to 2min + 2h.
 */
export const SEQUENCE_SYNC_STALE_MS = 26 * 60 * 60 * 1000;

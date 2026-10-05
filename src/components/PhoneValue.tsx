import { safeWhatsappHref, toTelHref } from "@/lib/phone";
import { WhatsAppIcon } from "@/components/icons";
import { PhoneCallLink } from "@/components/PhoneCallLink";

export interface PhoneValueLabels {
  whatsappTitle: string;
  whatsappLabelPrefix: string;
  phoneUnrecognizedTitle: string;
}

/**
 * One stored phone number as the contacts list and the contact record show
 * it (contact-whatsapp-access mockup, variant A):
 *
 * - valid number: a `tel:` link, plus the WhatsApp shortcut when the server
 *   built one (`whatsappLinkFor`, src/lib/whatsapp.ts);
 * - valid without a country code: the call link alone;
 * - malformed: plain text, no `tel:` and no WhatsApp (as before).
 *
 * Returns a fragment so each caller keeps its own layout (`.phone-cell` in
 * the list, the property row's `dd` on the record). The shortcut only opens
 * a chat: it logs nothing and claims nothing about the number being on
 * WhatsApp.
 *
 * With `call`, clicking the `tel:` link also records a call attempt and asks
 * the outcome (CallAttemptProvider). The WhatsApp shortcut is unchanged.
 *
 * `whatsappUrl` is computed on the server (the parsing library must not
 * reach the browser bundle) and is re-checked here: it only becomes an
 * `href` if the number passed `toTelHref` AND the URL passes
 * `safeWhatsappHref`.
 */
export function PhoneValue({
  value,
  whatsappUrl,
  labels,
  call,
}: {
  value: string;
  whatsappUrl?: string | null;
  labels: PhoneValueLabels;
  call?: { personId: string; personName: string };
}) {
  const telHref = toTelHref(value);
  if (!telHref) {
    return (
      <span className="phone-plain" title={labels.phoneUnrecognizedTitle}>
        {value}
      </span>
    );
  }
  const waHref = safeWhatsappHref(whatsappUrl);
  return (
    <>
      <PhoneCallLink href={telHref} value={value} personId={call?.personId} personName={call?.personName} />
      {waHref && (
        <a
          className="wa-btn"
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          title={labels.whatsappTitle}
          aria-label={`${labels.whatsappLabelPrefix} ${value}`}
        >
          <WhatsAppIcon className="icon" />
        </a>
      )}
    </>
  );
}

import { toTelHref, whatsappLinkFor } from "@/lib/phone";
import { WhatsAppIcon } from "@/components/icons";

export interface PhoneValueLabels {
  whatsappTitle: string;
  whatsappLabelPrefix: string;
  phoneUnrecognizedTitle: string;
}

/**
 * One stored phone number as the contacts list and the contact record show
 * it (contact-whatsapp-access mockup, variant A):
 *
 * - valid number: a `tel:` link, plus the WhatsApp shortcut when the number
 *   carries a country code (`whatsappLinkFor`);
 * - valid without a country code: the call link alone;
 * - malformed: plain text, no `tel:` and no WhatsApp (as before).
 *
 * Returns a fragment so each caller keeps its own layout (`.phone-cell` in
 * the list, the property row's `dd` on the record). The shortcut only opens
 * a chat: it logs nothing and claims nothing about the number being on
 * WhatsApp.
 */
export function PhoneValue({ value, labels }: { value: string; labels: PhoneValueLabels }) {
  const telHref = toTelHref(value);
  if (!telHref) {
    return (
      <span className="phone-plain" title={labels.phoneUnrecognizedTitle}>
        {value}
      </span>
    );
  }
  const waHref = whatsappLinkFor(value);
  return (
    <>
      <a className="num" href={telHref}>
        {value}
      </a>
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

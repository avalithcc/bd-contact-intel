// The confirmation shown before dialling a number Lusha flagged, built in one place for both surfaces that can dial
// (the contact record and the contacts list) so the wording never drifts between them.

import type { DoNotCallWarning } from "@/components/PhoneCallLink";

export function doNotCallWarning(l: { lushaDncConfirmTitle: string; lushaDncConfirmBody: string; lushaDncConfirmCall: string; cancel: string }, number: string): DoNotCallWarning {
  return { title: l.lushaDncConfirmTitle, body: l.lushaDncConfirmBody.replace("{number}", number), confirm: l.lushaDncConfirmCall, cancel: l.cancel };
}

import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { RecipientZone } from "./zones";

/** The strings of the send control; flat, so the whole slice can cross to the client components. */
export type SendControlLabels = ClientStrings<Dictionary["sendControl"]>;

/** What the contact record hands its composer: the labels, the sender's address and where the recipient probably is. */
export interface ContactSendContext {
  labels: SendControlLabels;
  fromAddress: string;
  recipientZone: RecipientZone | null;
}

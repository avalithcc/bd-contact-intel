import { assertSafeHeaderValue } from "@/lib/gmail/rawMessage";
import { checkRecipientShape } from "@/lib/gmail/recipient";
import { resolveSurvivor } from "@/lib/contacts/queries";

/**
 * A scheduled email may only go to the Contact's own address (the live survivor's, after merges), and the address must be
 * header-safe. `invalid_email` (CR/LF/NUL) and `schedule_recipient_invalid` (someone else's address) are typed reasons.
 */
export async function checkRecipient(personId: string, to: string): Promise<"ok" | "invalid_email" | "multiple_recipients" | "schedule_recipient_invalid"> {
  try {
    assertSafeHeaderValue("To", to);
  } catch {
    return "invalid_email";
  }
  const shape = checkRecipientShape(to);
  if (!shape.ok) return shape.reason === "multiple" ? "multiple_recipients" : "invalid_email";
  const survivor = await resolveSurvivor(personId);
  const own = survivor?.emailNormalized ?? survivor?.email?.trim().toLowerCase();
  return own && own === to.trim().toLowerCase() ? "ok" : "schedule_recipient_invalid";
}

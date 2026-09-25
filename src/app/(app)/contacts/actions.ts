"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBd } from "@/lib/queries";
import { updateContactProperty } from "@/lib/contacts/propertyEditDb";
import { isEditablePersonProperty } from "@/lib/contacts/propertyEdit";

/**
 * Server action behind the About pane's per-property inline edit (task 9.2,
 * 9.4). Rejects any property outside the allow-list up front — see
 * src/lib/contacts/propertyEdit.ts's doc comment for why `ownerBdId` and
 * `status` are excluded.
 */
export async function updateContactPropertyAction(
  personId: string,
  property: string,
  value: string,
) {
  if (!isEditablePersonProperty(property)) {
    throw new Error(`Property is not editable from the record page: ${property}`);
  }

  const me = await getCurrentBd();
  const updated = await updateContactProperty(personId, property, value, me.id);
  revalidatePath(`/contacts/${personId}`);
  return updated;
}

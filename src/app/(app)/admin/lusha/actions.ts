"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { setLushaEnabled } from "@/lib/lusha/adminDb";
import { isUuid } from "@/lib/uuid";

/**
 * Flips one BD's Lusha switch. requireAdmin runs FIRST and throws for anyone else, so a BD cannot enable themselves by
 * calling this directly; setLushaEnabled asserts the role again before it writes. The change and its audit_log row are one
 * transaction. Admins are not exempt: the same call switches an admin's own access.
 */
export async function setLushaEnabledAction(bdId: string, enabled: boolean): Promise<{ ok: boolean }> {
  const admin = await requireAdmin();
  if (!isUuid(bdId) || typeof enabled !== "boolean") return { ok: false };
  const result = await setLushaEnabled({ actor: admin, bdId, enabled });
  if (result.ok) revalidatePath("/admin/lusha");
  return { ok: result.ok };
}

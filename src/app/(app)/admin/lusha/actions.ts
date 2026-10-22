"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getRevealsDrilldown, setLushaEnabled, setLushaPersonalCap } from "@/lib/lusha/adminDb";
import { parsePersonalDailyCap } from "@/lib/lusha/cap";
import type { RevealDrilldownRow } from "@/lib/lusha/revealsDrilldown";
import { parseReportPeriod, periodWindow } from "@/lib/lusha/usageReport";
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

/**
 * Sets (a number) or clears (null) one BD's personal Lusha cap, in credits per Argentina day. requireAdmin runs FIRST, then the input is
 * validated without touching the database: only null or an integer 0-999 passes, and null (no cap) is never confused with 0 (blocked).
 * setLushaPersonalCap asserts the role again and writes the change and its audit row in one transaction. `changed` is false when the
 * value was already that one: nothing was written or recorded, and the caller must not say otherwise.
 */
export async function setLushaPersonalCapAction(bdId: string, cap: number | null): Promise<{ ok: boolean; changed: boolean }> {
  const admin = await requireAdmin();
  const parsed = parsePersonalDailyCap(cap);
  if (!isUuid(bdId) || !parsed.ok) return { ok: false, changed: false };
  const result = await setLushaPersonalCap({ actor: admin, bdId, cap: parsed.cap });
  if (result.ok) revalidatePath("/admin/lusha");
  return { ok: result.ok, changed: result.ok ? result.changed : false };
}

/**
 * The reveals behind the "Revelados" KPI, fetched when its dialog opens. Deliberate deviation from the reports drill-downs,
 * which accept `fromIso`/`toIso`: this takes the PERIOD NAME and derives its own window with the same periodWindow that
 * produced the KPI, so the list and the number cannot disagree about the range and no caller can ask for an arbitrary range
 * of the spend ledger. The cost is a sub-second race if someone clicks exactly as a calendar period rolls over; that is
 * cheaper than the validation surface. Anything that is not a known period falls back to the page's default, as the page does.
 */
export async function getRevealsDrilldownAction(period: string): Promise<{ ok: true; rows: RevealDrilldownRow[] } | { ok: false }> {
  try {
    await requireAdmin();
    const rows = await getRevealsDrilldown(periodWindow(parseReportPeriod(period), new Date()));
    return { ok: true, rows };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[lusha] getRevealsDrilldownAction failed", err);
    return { ok: false };
  }
}

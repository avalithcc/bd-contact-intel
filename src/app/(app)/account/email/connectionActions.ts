"use server";

/**
 * Server actions behind /account/email's connected-state footer
 * (email-sync.html:244,249,256,371-372): "Desconectar", "Sincronizar ahora",
 * and the one-time reconnect banner's close button. Each is scoped to the
 * signed-in BD's own `email_account` row — never another BD's.
 */
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { getCurrentBd } from "@/lib/queries";
import { getSyncableAccountForBd } from "@/lib/gmail/syncQueries";
import { syncOneAccountNow } from "@/lib/gmail/syncOneAccountNow";
import { checkSyncCooldown } from "@/lib/gmail/syncCooldown";

export type ConnectionActionResult =
  | { ok: true }
  | { ok: false; reason: "unexpected" | "not_syncable" | "cooldown" | "in_progress" };

function actionFailure(err: unknown): { ok: false; reason: "unexpected" } {
  unstable_rethrow(err);
  console.error("[account/email] connection action failed", err);
  return { ok: false, reason: "unexpected" };
}

/** "Desconectar" (email-sync.html:244,249,256) — a soft disconnect, same shape `disconnectedAt` already reserved for. */
export async function disconnectEmailAccountAction(): Promise<ConnectionActionResult> {
  try {
    const me = await getCurrentBd();
    await db
      .update(emailAccount)
      .set({ status: "disconnected", disconnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(emailAccount.bdId, me.id));
    revalidatePath("/account/email");
    revalidatePath("/account");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * "Sincronizar ahora" (email-sync.html:249) — runs the exact per-account
 * sync turn the 2-minute cron runs, once, for this BD alone.
 *
 * Fresh-review fix (2026-10-01): the button's own client-side `busy` flag
 * is not a real guard — it only prevents a double-click on the SAME mounted
 * button, not a second tab, a reload mid-request, or a fast double submit
 * before React re-renders. `checkSyncCooldown` (syncCooldown.ts) is the
 * actual guard, enforced here server-side: refuses within 60s of the
 * account's own `lastSyncedAt`, or at all while a first-sync backfill is
 * still in progress (`backfillPageToken` set) — both read off the SAME row
 * `getSyncableAccountForBd` already fetched, no extra round trip.
 */
export async function syncEmailAccountNowAction(): Promise<ConnectionActionResult> {
  try {
    const me = await getCurrentBd();
    const account = await getSyncableAccountForBd(me.id);
    if (!account) return { ok: false, reason: "not_syncable" };
    const cooldown = checkSyncCooldown({
      lastSyncedAt: account.lastSyncedAt,
      backfillPageToken: account.backfillPageToken,
      now: new Date(),
    });
    if (!cooldown.ok) return { ok: false, reason: cooldown.reason };
    await syncOneAccountNow(account);
    revalidatePath("/account/email");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Reconnect banner's close button (email-sync.html:372; README decision 5).
 * Persisted on `email_account` (not `localStorage`) so it stays dismissed
 * across devices — see the column's doc comment in src/db/schema.ts.
 */
export async function dismissReconnectBannerAction(): Promise<ConnectionActionResult> {
  try {
    const me = await getCurrentBd();
    await db
      .update(emailAccount)
      .set({ reconnectBannerDismissedAt: new Date() })
      .where(eq(emailAccount.bdId, me.id));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

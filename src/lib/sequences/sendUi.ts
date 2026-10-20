/**
 * Pure helpers of the Sequence screen's send control: the toast that follows an immediate release, and the recipients handed
 * to the time-zone reference. Kept out of the components so the wording decisions are tested.
 */
import type { SendRecipient } from "@/lib/sendSchedule/advice";
import { resolveRecipientZone, type RecipientPlace } from "@/lib/sendSchedule/zones";

export interface ReleaseCounts {
  released: number;
  deferred: number;
  held: number;
  failed: number;
  /** Claims another run won first: benign, the member goes with that run or the next tick. */
  lost?: number;
}

export type ReleaseToast =
  | { key: "sentNow" | "capDeferred" | "held" | "pending"; tone: "success" }
  | { key: "sentNowMany"; n: number; tone: "success" }
  | { key: "capDeferredMany"; sent: number; n: number; tone: "success" }
  | { key: "failed"; tone: "error" };

/**
 * `total` members were approved with "Enviar ahora"; `outcome` is what the immediate release did (undefined when it could not
 * run, which is not a failure: the minute cron takes them). A member over the daily cap stays approved and is said so.
 */
export function releaseToast(outcome: ReleaseCounts | undefined, total: number): ReleaseToast {
  if (!outcome) return { key: "pending", tone: "success" };
  if (outcome.failed > 0) return { key: "failed", tone: "error" };
  if (outcome.deferred > 0) return outcome.released > 0 ? { key: "capDeferredMany", sent: outcome.released, n: outcome.deferred, tone: "success" } : { key: "capDeferred", tone: "success" };
  if (outcome.held > 0) return { key: "held", tone: "success" };
  // "Enviado" only when something actually left; a member queued behind another run, or skipped as in flight, is still approved.
  if (outcome.released === 0) return { key: "pending", tone: "success" };
  return total === 1 ? { key: "sentNow", tone: "success" } : { key: "sentNowMany", n: outcome.released, tone: "success" };
}

export function sendRecipients(members: readonly { firstName: string | null; lastName: string | null; place?: RecipientPlace }[]): SendRecipient[] {
  return members.map((m) => ({ name: [m.firstName, m.lastName].filter(Boolean).join(" "), zone: resolveRecipientZone(m.place ?? {}) }));
}

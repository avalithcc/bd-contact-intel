import type { ContactActionResult } from "@/app/(app)/contacts/actionErrors";

/**
 * Server actions on the record page already return a typed `{ ok: false }`
 * for every failure they can name. What they cannot do is answer at all when
 * the request itself dies (dropped connection, HTTP 500): the client's
 * `await` then THROWS, and a handler written for `{ ok }` skips everything
 * after it (including `setBusy(false)`), freezing the form.
 *
 * `settleAction` closes that seam: it never rejects. A throw becomes the
 * `unconfirmed` reason, which is deliberately NOT "not saved" — when the
 * transport fails mid-request the write may or may not have landed, and the
 * copy has to say so rather than invite a blind retry (a duplicate).
 */
export async function settleAction(run: () => Promise<ContactActionResult>): Promise<ContactActionResult> {
  try {
    return await run();
  } catch {
    return { ok: false, reason: "unconfirmed" };
  }
}

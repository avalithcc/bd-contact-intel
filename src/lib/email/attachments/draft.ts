import { MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES, checkAttachmentMeta } from "./policy";

/**
 * The composer's attachment list, as plain data, and the client-side checks. Pure and free of browser APIs so it is
 * unit-tested; the server re-runs the same policy on every send (the client is never trusted).
 */
export interface DraftItem {
  key: string;
  filename: string;
  size: number;
  status: "uploading" | "ready" | "error";
}

export type DraftRefusal = "type" | "size" | "empty" | "too_many" | "total";
export type DraftPlan = { ok: true } | { ok: false; reason: DraftRefusal };

/** Only files that will be sent count toward the quota: an errored file is shown, but neither sent nor counted. */
const counted = (items: readonly DraftItem[]) => items.filter((i) => i.status !== "error");

/**
 * Decides, file by file in order, whether each dropped file may join the list. A refused file does not use up the quota,
 * so a bad file in the middle of a drop never blocks the good ones after it.
 */
export function planNewFiles(existing: readonly DraftItem[], files: readonly { name: string; size: number; type: string }[]): DraftPlan[] {
  let count = counted(existing).length;
  let bytes = counted(existing).reduce((sum, i) => sum + i.size, 0);
  return files.map((f): DraftPlan => {
    const meta = checkAttachmentMeta({ filename: f.name, contentType: f.type, size: f.size });
    if (!meta.ok) return { ok: false, reason: meta.reason === "type_not_allowed" ? "type" : meta.reason === "empty" ? "empty" : "size" };
    if (count + 1 > MAX_ATTACHMENTS) return { ok: false, reason: "too_many" };
    if (bytes + f.size > MAX_TOTAL_ATTACHMENT_BYTES) return { ok: false, reason: "total" };
    count += 1;
    bytes += f.size;
    return { ok: true };
  });
}

export function attachmentTotals(items: readonly DraftItem[]): { count: number; bytes: number; uploading: boolean } {
  const live = counted(items);
  return { count: live.length, bytes: live.reduce((sum, i) => sum + i.size, 0), uploading: items.some((i) => i.status === "uploading") };
}

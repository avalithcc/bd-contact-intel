import type { AttachmentStorage } from "./storage";

/**
 * The attachment sweeper's orchestration, with its side effects injected (the cron route passes the real queries and the
 * service-role storage; tests pass fakes). Owner decision: the CRM must not keep files. Storage is asked first; a row stops
 * being tracked ONLY after Storage confirmed, so a failed delete is retried on the next run instead of leaking an object.
 */
export interface SweepDeps {
  selectSweepable(limit: number): Promise<{ storagePath: string }[]>;
  markRemoved(paths: string[]): Promise<void>;
  storage: AttachmentStorage;
}

export interface SweepSummary {
  selected: number;
  removed: number;
  failed: number;
}

export const SWEEP_BATCH = 50;

export async function sweepAttachments(deps: SweepDeps, limit = SWEEP_BATCH): Promise<SweepSummary> {
  const candidates = await deps.selectSweepable(limit);
  if (candidates.length === 0) return { selected: 0, removed: 0, failed: 0 };
  const paths = candidates.map((c) => c.storagePath);
  // One Storage call for the batch; if it fails nothing is marked, so the whole batch is retried.
  const confirmed = await deps.storage.remove(paths).catch(() => false);
  if (!confirmed) return { selected: paths.length, removed: 0, failed: paths.length };
  await deps.markRemoved(paths);
  return { selected: paths.length, removed: paths.length, failed: 0 };
}

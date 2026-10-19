import type { AttachmentStorage } from "./storage";

/**
 * The attachment sweepers' orchestration, with their side effects injected (the cron route passes the real queries and the
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

/** True when a listing of the object's folder shows it is not there (nothing left to delete). A failed listing is "unknown". */
async function isGone(storage: AttachmentStorage, path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const entries = await storage.list(path.slice(0, slash), 100).catch(() => null);
  return entries !== null && !entries.some((e) => e.name === path.slice(slash + 1));
}

/** Tracked files that must go: orphans, cancelled leftovers, sent leftovers (see queries.ts `selectSweepable`). */
export async function sweepAttachments(deps: SweepDeps, limit = SWEEP_BATCH): Promise<SweepSummary> {
  const candidates = await deps.selectSweepable(limit);
  if (candidates.length === 0) return { selected: 0, removed: 0, failed: 0 };
  const paths = candidates.map((c) => c.storagePath);
  // One Storage call for the batch.
  if (await deps.storage.remove(paths).catch(() => false)) {
    await deps.markRemoved(paths);
    return { selected: paths.length, removed: paths.length, failed: 0 };
  }
  // Not confirmed for all of them: one by one, so a file that was never there (or is already gone) stops being tracked
  // instead of failing the whole batch on every run, and a real failure stays tracked for the next run.
  const gone: string[] = [];
  for (const path of paths) {
    if ((await deps.storage.remove([path]).catch(() => false)) || (await isGone(deps.storage, path))) gone.push(path);
  }
  if (gone.length) await deps.markRemoved(gone);
  return { selected: paths.length, removed: gone.length, failed: paths.length - gone.length };
}

export const UNREGISTERED_AFTER_MS = 24 * 60 * 60_000;
/** Upload folders looked at per run: Storage is listed one level per call, so the walk is bounded. */
export const MAX_UPLOAD_FOLDERS = 100;
const LIST_LIMIT = 100;

export interface UnregisteredDeps {
  storage: AttachmentStorage;
  /** Of these paths, the ones a live (not removed) email_attachment row still tracks. */
  tracked(paths: string[]): Promise<Set<string>>;
}

/**
 * Objects the browser uploaded but nothing ever registered (the register call failed, or the tab closed in between) have no
 * row, so the database sweeper cannot see them. Walks the bucket (`<owner>/<upload>/<file>`) and deletes objects older than
 * 24 h that no live row tracks. Capped per run; meant to run now and then (the route calls it about once an hour).
 */
export async function sweepUnregisteredObjects(deps: UnregisteredDeps, now: Date): Promise<{ scanned: number; removed: number; failed: number }> {
  const stale: string[] = [];
  let folders = 0;
  let scanned = 0;
  const owners = (await deps.storage.list("", LIST_LIMIT).catch(() => null)) ?? [];
  walk: for (const owner of owners.filter((e) => e.isFolder)) {
    for (const upload of ((await deps.storage.list(owner.name, LIST_LIMIT).catch(() => null)) ?? []).filter((e) => e.isFolder)) {
      if (folders++ >= MAX_UPLOAD_FOLDERS) break walk;
      for (const file of ((await deps.storage.list(`${owner.name}/${upload.name}`, LIST_LIMIT).catch(() => null)) ?? []).filter((e) => !e.isFolder)) {
        scanned++;
        if (file.createdAt && now.getTime() - file.createdAt.getTime() > UNREGISTERED_AFTER_MS) stale.push(`${owner.name}/${upload.name}/${file.name}`);
      }
    }
  }
  if (stale.length === 0) return { scanned, removed: 0, failed: 0 };
  const kept = await deps.tracked(stale);
  const doomed = stale.filter((p) => !kept.has(p));
  let removed = 0;
  for (let i = 0; i < doomed.length; i += SWEEP_BATCH) {
    const batch = doomed.slice(i, i + SWEEP_BATCH);
    if (await deps.storage.remove(batch).catch(() => false)) removed += batch.length;
  }
  return { scanned, removed, failed: doomed.length - removed };
}

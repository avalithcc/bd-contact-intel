import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_ATTACHMENTS_BUCKET } from "./storagePath";

/**
 * The Storage operations the server needs, behind a port so the load/send/sweep logic is tested with a fake (Storage
 * cannot run locally). The real adapter wraps a Supabase client: the caller's own session for an immediate send (the
 * bucket's RLS lets a user read and delete only their own folder), the service-role client for the scheduled-send cron and
 * the sweeper (no session there).
 */
export interface StorageEntry {
  name: string;
  /** Folders have no id in Supabase Storage. */
  isFolder: boolean;
  createdAt: Date | null;
}

export interface AttachmentStorage {
  /** The object's bytes, or null when it does not exist (or cannot be read). */
  download(path: string): Promise<Uint8Array | null>;
  /**
   * Deletes the objects; true only when Storage confirmed EVERY one of them (it answers with the objects it removed, so a
   * shorter answer is a failure). Callers mark an object as gone only on true.
   */
  remove(paths: string[]): Promise<boolean>;
  /** One level of the bucket under `prefix` ('' = the root), at most `limit` entries; null when the listing failed. */
  list(prefix: string, limit: number): Promise<StorageEntry[] | null>;
}

export function supabaseAttachmentStorage(client: Pick<SupabaseClient, "storage">): AttachmentStorage {
  const bucket = () => client.storage.from(EMAIL_ATTACHMENTS_BUCKET);
  return {
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return true;
      const { data, error } = await bucket().remove(paths);
      return !error && Array.isArray(data) && data.length === paths.length;
    },
    async list(prefix, limit) {
      const { data, error } = await bucket().list(prefix, { limit, sortBy: { column: "name", order: "asc" } });
      if (error || !data) return null;
      return data.map((e) => ({ name: e.name, isFolder: e.id === null, createdAt: e.created_at ? new Date(e.created_at) : null }));
    },
  };
}

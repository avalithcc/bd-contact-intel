import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_ATTACHMENTS_BUCKET } from "./storagePath";

/**
 * The two Storage operations the server needs, behind a port so the load/send/sweep logic is tested with a fake (Storage
 * cannot run locally). The real adapter wraps a Supabase client: the caller's own session for an immediate send (the
 * bucket's RLS lets a user read and delete only their own folder), the service-role client for the scheduled-send cron and
 * the sweeper (no session there).
 */
export interface AttachmentStorage {
  /** The object's bytes, or null when it does not exist (or cannot be read). */
  download(path: string): Promise<Uint8Array | null>;
  /** Deletes the objects; true only when Storage confirmed. A missing object counts as removed. */
  remove(paths: string[]): Promise<boolean>;
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
      const { error } = await bucket().remove(paths);
      return !error;
    },
  };
}

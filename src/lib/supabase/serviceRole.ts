import { createClient } from "@supabase/supabase-js";
import { supabaseAttachmentStorage, type AttachmentStorage } from "@/lib/email/attachments/storage";

/**
 * SERVER-ONLY. The service-role key bypasses every RLS policy, so this module must never be imported by a "use client"
 * file or by anything a client component imports (tests/unit/serviceRoleBoundary.test.ts pins the direct case). It exists
 * for the one job that has no user session: the scheduled-send cron reading an attachment, and the sweeper deleting
 * orphans. Everything else uses the signed-in user's own session.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is not set in every environment. Callers treat "not configured" as a first-class answer:
 * scheduling WITH files is refused up front, and a due row that needs files fails closed, never sending without them.
 */
export function serviceRoleConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function serviceRoleAttachmentStorage(): AttachmentStorage | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return null;
  return supabaseAttachmentStorage(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}

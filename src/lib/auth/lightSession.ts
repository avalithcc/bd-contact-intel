/**
 * A session check for read-only endpoints that must NOT count as the BD being present in the CRM
 * (getCurrentBd stamps `bd.last_seen_at`, which feeds the Gmail reminder series; browsing LinkedIn with the
 * extension installed is not CRM presence). It enforces the same two rules getCurrentBd and the middleware
 * enforce, an allowed work-email domain and a confirmed email, but never touches the database.
 */
import { isAllowedWorkEmail } from "@/lib/auth/allowedEmail";
import { createClient } from "@/lib/supabase/server";

export interface SessionUserLike {
  email?: string | null;
  email_confirmed_at?: string | null;
}

/** Pure rule shared with the tests; fails closed. */
export function isUsableSessionUser(user: SessionUserLike | null | undefined): boolean {
  return Boolean(user?.email && isAllowedWorkEmail(user.email) && user.email_confirmed_at);
}

export async function hasUsableSession(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isUsableSessionUser(user);
}

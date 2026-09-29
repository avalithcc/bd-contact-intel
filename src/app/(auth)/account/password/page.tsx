import { getLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { isRecoverySession } from "@/lib/auth/recoverySession";
import { PasswordForm } from "./PasswordForm";

export default async function SetPasswordPage() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  // Local JWT claim read only (no network round trip) — see
  // src/lib/auth/recoverySession.ts. Drives which fields PasswordForm
  // renders; every actual password change still goes through Supabase's
  // own auth calls regardless of this value.
  const isRecovery = isRecoverySession(session?.access_token);

  return <PasswordForm locale={locale} isRecovery={isRecovery} />;
}

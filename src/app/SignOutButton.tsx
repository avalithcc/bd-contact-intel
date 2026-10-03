"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CONTACTS_LIST_MEMORY_KEY } from "@/lib/contacts/listMemory";
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";

export function SignOutButton({ locale }: { locale: Locale }) {
  const router = useRouter();
  async function signOut() {
    // The remembered contacts-list query belongs to this BD; the next one to
    // sign in on this tab must not inherit it.
    try {
      sessionStorage.removeItem(CONTACTS_LIST_MEMORY_KEY);
    } catch {
      // Storage blocked: nothing was remembered.
    }
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <button type="button" className="secondary" onClick={signOut}>
      {t(locale).common.signOut}
    </button>
  );
}

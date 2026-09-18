"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";

export function PasswordForm({
  locale,
  localeSwitcher,
}: {
  locale: Locale;
  localeSwitcher: React.ReactNode;
}) {
  const dict = t(locale);
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setMsg(dict.account.passwordTooShort);
      return;
    }
    if (password !== confirm) {
      setMsg(dict.account.passwordsDontMatch);
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="form-narrow">
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        {localeSwitcher}
      </div>
      <div className="eyebrow">{dict.account.eyebrow}</div>
      <h1>
        {dict.account.title}
        <span className="dot">.</span>
      </h1>
      <p className="soft">{dict.account.subtitle}</p>

      <form className="panel mt-xl" onSubmit={submit}>
        <div className="mb-lg">
          <label htmlFor="password">{dict.account.newPassword}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="mb-lg">
          <label htmlFor="confirm">{dict.account.confirmPassword}</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={busy}>
          {busy ? dict.common.ellipsis : dict.account.saveAndContinue}
        </button>
        {msg && (
          <p className="soft mb-0 mt-md">
            {msg}
          </p>
        )}
      </form>
    </main>
  );
}

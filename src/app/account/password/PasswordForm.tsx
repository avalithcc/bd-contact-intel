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
    <main style={{ maxWidth: 400 }}>
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

      <form className="panel" style={{ marginTop: "1.25rem" }} onSubmit={submit}>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="password">{dict.account.newPassword}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
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
          <p className="soft" style={{ marginBottom: 0, marginTop: "0.75rem" }}>
            {msg}
          </p>
        )}
      </form>
    </main>
  );
}

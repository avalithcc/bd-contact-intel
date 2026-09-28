"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";

export function ForgotPasswordForm({ locale }: { locale: Locale }) {
  const dict = t(locale);
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    // Deliberately ignore the result: whether the email belongs to an
    // account or not, the response to the user is identical, so no
    // account-enumeration signal ever reaches the client.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirm?next=/account/password`,
    });
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="form-narrow">
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
      </div>
      <div className="eyebrow">{dict.forgotPassword.eyebrow}</div>
      <h1>
        {dict.forgotPassword.title}
        <span className="dot">.</span>
      </h1>
      <p className="soft">{dict.forgotPassword.subtitle}</p>
      <form className="panel mt-xl" onSubmit={submit}>
        <div className="mb-lg">
          <label htmlFor="email">{dict.forgotPassword.workEmail}</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={sent}
          />
        </div>
        {!sent && (
          <button type="submit" disabled={busy}>
            {busy ? dict.common.ellipsis : dict.forgotPassword.submit}
          </button>
        )}
        {sent && (
          <p className="muted mb-0">{dict.forgotPassword.genericConfirmation}</p>
        )}
        <p className="soft mb-0 mt-md">
          <Link href="/login">{dict.forgotPassword.backToLogin}</Link>
        </p>
      </form>
    </main>
  );
}

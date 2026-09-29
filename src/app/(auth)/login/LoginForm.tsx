"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import { sanitizeNextPath } from "@/lib/auth/nextPath";
import { PASSWORD_RESET_ENABLED } from "@/lib/auth/passwordReset";
import { ALLOWED_WORK_EMAIL_DOMAIN } from "@/lib/auth/allowedEmail";

export function LoginForm({
  locale,
  next,
  error,
}: {
  locale: Locale;
  next?: string;
  error?: string;
}) {
  const dict = t(locale);
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(
    error === "invalid_or_expired_link"
      ? dict.login.expiredLinkError
      : error === "not_authorized"
        ? dict.login.notAuthorizedError
        : null,
  );
  const [busy, setBusy] = useState(false);
  const safeNext = sanitizeNextPath(next);

  function validate(): boolean {
    if (!email.trim() || !password) {
      setMsg(dict.login.enterEmailPassword);
      return false;
    }
    return true;
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    router.push(safeNext);
    router.refresh();
  }

  return (
    <main className="form-narrow">
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
      </div>
      <div className="eyebrow">{dict.common.brandEyebrow}</div>
      <h1>
        {dict.login.title}
        <span className="dot">.</span>
      </h1>
      <form className="panel mt-xl" onSubmit={signIn}>
        <div className="mb-lg">
          <label htmlFor="email">{dict.login.workEmail}</label>
          <input
            id="email"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={`you${ALLOWED_WORK_EMAIL_DOMAIN}`}
            required
          />
        </div>
        <div className="mb-lg">
          <label htmlFor="password">{dict.login.password}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="legacy-row">
          <button type="submit" disabled={busy}>
            {busy ? dict.common.ellipsis : dict.login.signIn}
          </button>
        </div>
        {msg && (
          <p className="muted mb-0 mt-md">
            {msg}
          </p>
        )}
        {PASSWORD_RESET_ENABLED && (
          <p className="soft mb-0 mt-md">
            <Link href="/forgot-password">{dict.login.forgotPasswordLink}</Link>
          </p>
        )}
      </form>
    </main>
  );
}

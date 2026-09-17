"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";

const ALLOWED_DOMAIN = "@avalith.net";

export function LoginForm({
  locale,
  localeSwitcher,
}: {
  locale: Locale;
  localeSwitcher: React.ReactNode;
}) {
  const dict = t(locale);
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    router.push("/");
    router.refresh();
  }

  async function signUp() {
    if (!validate()) return;
    if (!email.trim().toLowerCase().endsWith(ALLOWED_DOMAIN)) {
      setMsg(dict.login.domainRestricted(ALLOWED_DOMAIN));
      return;
    }
    if (password.length < 8) {
      setMsg(dict.login.passwordTooShort);
      return;
    }
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    if (data.session) {
      // email confirmation disabled → already signed in
      router.push("/");
      router.refresh();
      return;
    }
    setMsg(dict.login.accountCreated);
  }

  return (
    <main style={{ maxWidth: 400 }}>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        {localeSwitcher}
      </div>
      <div className="eyebrow">{dict.common.brandEyebrow}</div>
      <h1>
        {dict.login.title}
        <span className="dot">.</span>
      </h1>
      <p className="soft">
        {dict.login.signUpIntro} {dict.login.signUpHintPrefix}
        <strong>{ALLOWED_DOMAIN}</strong>
        {dict.login.signUpHintSuffix}
      </p>
      <form className="panel" style={{ marginTop: "1.25rem" }} onSubmit={signIn}>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="email">{dict.login.workEmail}</label>
          <input
            id="email"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={`you${ALLOWED_DOMAIN}`}
            required
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="password">{dict.login.password}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? dict.common.ellipsis : dict.login.signIn}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={signUp}
            disabled={busy}
          >
            {dict.login.createAccount}
          </button>
        </div>
        {msg && (
          <p className="muted" style={{ marginBottom: 0, marginTop: "0.75rem" }}>
            {msg}
          </p>
        )}
      </form>
    </main>
  );
}

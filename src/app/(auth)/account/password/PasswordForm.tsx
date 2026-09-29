"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import {
  MIN_NEW_PASSWORD_LENGTH,
  mapUpdateUserError,
  validatePasswordChange,
  type PasswordChangeError,
  type PasswordChangeErrorField,
} from "@/lib/auth/passwordPolicy";

/**
 * "incorrect" is a runtime, server-verified outcome (signInWithPassword
 * rejected the current password) — distinct from the pure, synchronous
 * codes validatePasswordChange returns, so it is added here rather than in
 * the shared policy module.
 */
type FormError =
  | PasswordChangeError
  | { field: "current"; code: "incorrect" };

export function PasswordForm({
  locale,
  isRecovery,
}: {
  locale: Locale;
  isRecovery: boolean;
}) {
  const dict = t(locale);
  const router = useRouter();
  const supabase = createClient();
  // A recovery-link session (see src/lib/auth/recoverySession.ts) has no
  // current password to give — mockups/account-password.html's 3-field form
  // is the normal-flow case; the recovery case drops the first field.
  const requireCurrent = !isRecovery;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<FormError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function messageFor(field: PasswordChangeErrorField): string | null {
    if (!fieldError || fieldError.field !== field) return null;
    switch (fieldError.code) {
      case "required":
        return dict.account.currentPasswordRequired;
      case "incorrect":
        return dict.account.currentPasswordIncorrect;
      case "tooShort":
        // Doubles as the persistent helper text below — the mockup shows
        // one message serving both roles for this field.
        return dict.account.newPasswordHelp(MIN_NEW_PASSWORD_LENGTH);
      case "sameAsCurrent":
        return dict.account.newPasswordSameAsCurrent;
      case "mismatch":
        return dict.account.passwordsDontMatch;
      default:
        return null;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const validation = validatePasswordChange({
      currentPassword,
      newPassword,
      confirmPassword,
      requireCurrent,
    });
    setFieldError(validation);
    if (validation) return;

    setBusy(true);
    try {
      if (requireCurrent) {
        // UX layer only — this is NOT the enforcement. Supabase has no
        // dedicated "check this password" call, so this re-authenticates
        // with the given current password purely to show a fast, clear
        // per-field error before touching anything. A hijacked session
        // could skip this entirely and call updateUser() directly (browser
        // console, REST API) — the `current_password` field passed to
        // updateUser below is what actually closes that gap, and only if
        // the owner has enabled it (see the comment there).
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const email = session?.user?.email;
        if (!email) {
          setFormError(dict.account.genericError);
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword(
          { email, password: currentPassword },
        );
        if (signInError) {
          // Never surface more than "incorrect current password" — not the
          // provider's raw message (rate limiting, etc).
          setFieldError({ field: "current", code: "incorrect" });
          return;
        }
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
        // Real, server-side enforcement of "you must know the current
        // password to change it" — but ONLY if the OWNER has enabled it.
        // The underlying server config is
        // GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD (the
        // name confirmed in this SDK's own types —
        // node_modules/@supabase/auth-js/dist/module/lib/types.d.ts,
        // UserAttributes.current_password's doc comment: "This is only ever
        // present when the user is resetting their password and
        // GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD is
        // true"). The owner must find and enable the matching toggle in the
        // Supabase dashboard (see
        // https://supabase.com/docs/guides/auth/password-security) and
        // confirm it is actually on — this comment does not assert the
        // dashboard's exact label/location, only the verified server
        // config name. Until the owner verifies that setting is enabled,
        // GoTrue silently ignores this field and the signInWithPassword
        // check above is the only gate — which a stolen session can
        // bypass entirely (browser console, REST API, skipping this form).
        // Omitted entirely on the recovery path: there is no current
        // password to send, and whether GoTrue exempts recovery sessions
        // from this setting is not documented (see passwordReset.ts's
        // "verify end to end" note).
        ...(requireCurrent ? { current_password: currentPassword } : {}),
      });
      if (updateError) {
        const outcome = mapUpdateUserError(updateError.code, requireCurrent);
        if (outcome.field === "current" || outcome.field === "new") {
          setFieldError(outcome);
        } else {
          setFormError(dict.account.genericError);
        }
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const title = isRecovery ? dict.account.recoveryTitle : dict.account.title;
  const subtitle = isRecovery
    ? dict.account.recoverySubtitle
    : dict.account.subtitle;
  const eyebrow = isRecovery
    ? dict.account.recoveryEyebrow
    : dict.account.eyebrow;

  const currentError = messageFor("current");
  const newError = messageFor("new");
  const confirmError = messageFor("confirm");

  return (
    <main className="form-narrow">
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
      </div>
      <div className="eyebrow">{eyebrow}</div>
      <h1>
        {title}
        <span className="dot">.</span>
      </h1>
      <p className="soft">{subtitle}</p>

      <form className="panel mt-xl stack" onSubmit={submit}>
        {requireCurrent && (
          <div className="field">
            <label className="label" htmlFor="cp">
              {dict.account.currentPasswordLabel}
            </label>
            <input
              className={`input${currentError ? " is-invalid" : ""}`}
              id="cp"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              aria-invalid={currentError ? true : undefined}
              aria-describedby={currentError ? "cp-e" : undefined}
              required
            />
            {currentError && (
              <span className="error-text" id="cp-e">
                {currentError}
              </span>
            )}
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="np">
            {dict.account.newPasswordLabel}
          </label>
          <input
            className={`input${newError ? " is-invalid" : ""}`}
            id="np"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-invalid={newError ? true : undefined}
            aria-describedby={newError ? "np-e" : "np-h"}
            required
          />
          {newError ? (
            <span className="error-text" id="np-e">
              {newError}
            </span>
          ) : (
            <span className="help" id="np-h">
              {dict.account.newPasswordHelp(MIN_NEW_PASSWORD_LENGTH)}
            </span>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="np2">
            {dict.account.confirmPasswordLabel}
          </label>
          <input
            className={`input${confirmError ? " is-invalid" : ""}`}
            id="np2"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={confirmError ? true : undefined}
            aria-describedby={confirmError ? "np2-e" : undefined}
            required
          />
          {confirmError && (
            <span className="error-text" id="np2-e">
              {confirmError}
            </span>
          )}
        </div>

        {formError && (
          <p className="alert alert-danger" role="alert">
            {formError}
          </p>
        )}

        <div className="row">
          <span className="grow" />
          <Link href="/account" className="btn btn-secondary">
            {dict.account.cancel}
          </Link>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? dict.common.ellipsis : dict.account.submit}
          </button>
        </div>
      </form>
    </main>
  );
}

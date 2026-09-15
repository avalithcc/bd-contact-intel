"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ALLOWED_DOMAIN = "@avalith.net";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): boolean {
    if (!email.trim() || !password) {
      setMsg("Enter your email and password first.");
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
      setMsg(`Accounts are limited to ${ALLOWED_DOMAIN} emails.`);
      return;
    }
    if (password.length < 8) {
      setMsg("Use at least 8 characters for your password.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setBusy(false);
    setMsg(
      error
        ? error.message
        : "Account created. If email confirmation is enabled, check your inbox — otherwise sign in now.",
    );
  }

  return (
    <main style={{ maxWidth: 400 }}>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
      </div>
      <div className="eyebrow">// bd_contact_intelligence</div>
      <h1>
        sign in<span className="dot">.</span>
      </h1>
      <p className="soft">
        New here? Create an account with your <strong>@avalith.net</strong>{" "}
        email.
      </p>
      <form className="panel" style={{ marginTop: "1.25rem" }} onSubmit={signIn}>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@avalith.net"
            required
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="password">Password</label>
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
            {busy ? "…" : "Sign in"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={signUp}
            disabled={busy}
          >
            Create account
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

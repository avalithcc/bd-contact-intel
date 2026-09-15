"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
    <main style={{ maxWidth: 380 }}>
      <h1>BD Contact Intelligence</h1>
      <form className="panel" onSubmit={signIn}>
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
            onClick={signUp}
            disabled={busy}
            style={{ background: "transparent", border: "1px solid var(--border)" }}
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

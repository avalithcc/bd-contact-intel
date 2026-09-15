"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setMsg("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setMsg("Passwords don't match.");
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
      </div>
      <div className="eyebrow">// welcome</div>
      <h1>
        Set your password<span className="dot">.</span>
      </h1>
      <p className="soft">Choose a password to finish setting up your account.</p>

      <form className="panel" style={{ marginTop: "1.25rem" }} onSubmit={submit}>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={busy}>
          {busy ? "…" : "Save and continue"}
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

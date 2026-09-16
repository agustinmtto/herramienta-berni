"use client";
import { useState, type FormEvent } from "react";

export default function LoginForm() {
  const [user, setUser] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user || !pw || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pw }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? "No se pudo entrar.");
        setLoading(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.href = next.startsWith("/") ? next : "/";
    } catch {
      setErr("Error de red.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="login-form">
      <input
        type="text"
        value={user}
        onChange={(e) => setUser(e.target.value)}
        placeholder="Usuario"
        autoFocus
        autoComplete="username"
      />
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="Contraseña de acceso"
        autoComplete="current-password"
      />
      <button type="submit" className="login-btn" disabled={loading}>
        {loading ? "Entrando…" : "Entrar al OS"}
      </button>
      {err && <div className="login-err">{err}</div>}
    </form>
  );
}

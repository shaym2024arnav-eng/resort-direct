import { useState } from "react";
import { useAuth } from "../auth";

// Sign in or create an account. Used on its own page and inline in checkout.
export default function AuthForm({ onDone, initialMode = "login", heading = true }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = mode === "login"
        ? await login(f.email.trim(), f.password)
        : await register({ name: f.name.trim(), email: f.email.trim(), password: f.password, ...(f.phone.trim() ? { phone: f.phone.trim() } : {}) });
      onDone?.(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {heading && <h2 className="h3">{mode === "login" ? "Sign in" : "Create an account"}</h2>}
      {mode === "register" && (
        <>
          <label className="field"><span>Full name</span><input value={f.name} onChange={set("name")} autoComplete="name" required minLength={2} /></label>
          <label className="field"><span>Mobile (optional)</span><input value={f.phone} onChange={set("phone")} autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" /></label>
        </>
      )}
      <label className="field"><span>Email</span><input type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></label>
      <label className="field">
        <span>Password</span>
        <input type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : 1} />
        {mode === "register" && <small className="muted">At least 8 characters.</small>}
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      <p className="small">
        {mode === "login" ? "New here? " : "Already have an account? "}
        <button type="button" className="link-btn" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Create an account" : "Sign in instead"}
        </button>
      </p>
    </form>
  );
}

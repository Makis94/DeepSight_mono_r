import { useState, type FormEvent } from "react";
import { adminLogin } from "../lib/api.js";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await adminLogin(username, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="admin-login" onSubmit={(event) => void handleSubmit(event)}>
      <h1>HyperTracker Admin</h1>
      <input
        type="text"
        placeholder="Username"
        autoComplete="username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error && <span className="admin-error">{error}</span>}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

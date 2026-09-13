import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { ErrorNote } from "../components/primitives";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="max-w-md mx-auto card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-extrabold">Check your email</h1>
        <p className="text-sm text-[#9297b3]">
          If an account exists for <b>{email}</b>, we've sent a link to reset its password. The
          link expires in 30 minutes.
        </p>
        <Link to="/login" className="text-sm text-[var(--color-accent)]">
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto card p-6 flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-extrabold">Reset your password</h1>
        <p className="text-sm text-[#9297b3] mt-1">
          Enter the email on your account and we'll send a link to set a new password.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            await api.forgotPassword({ email });
            setSent(true);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            className="input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" disabled={busy || !email}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <Link to="/login" className="text-sm text-[#9297b3] hover:text-white">
        ← Back to sign in
      </Link>

      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

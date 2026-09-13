import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { ErrorNote } from "../components/primitives";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="max-w-md mx-auto card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-extrabold">Invalid reset link</h1>
        <p className="text-sm text-[#9297b3]">
          This link is missing its reset token. Request a new one from the forgot-password page.
        </p>
        <Link to="/forgot-password" className="text-sm text-[var(--color-accent)]">
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-extrabold">Password updated</h1>
        <p className="text-sm text-[#9297b3]">
          Your password has been changed and every existing session was signed out, including
          this one. Sign in with your new password.
        </p>
        <Link to="/login" className="btn btn-primary text-center">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto card p-6 flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-extrabold">Set a new password</h1>
        <p className="text-sm text-[#9297b3] mt-1">
          Choose a new password for your account. This will sign you out everywhere else.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (newPassword !== confirm) {
            setError("Passwords don't match.");
            return;
          }
          setBusy(true);
          try {
            await api.resetPassword({ token, newPassword });
            setDone(true);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          New password
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <span className="text-xs text-[#7e849e]">At least 8 characters.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Confirm new password
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" disabled={busy || !newPassword || !confirm}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>

      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

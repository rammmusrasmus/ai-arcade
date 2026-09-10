import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { API_URL, errorMessage } from "../api";
import { ErrorNote } from "../components/primitives";

type Mode = "signin" | "register";

export function LoginPage() {
  const { providers, register, login, devLogin, user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // dev login (local only) has its own tiny form
  const [devEmail, setDevEmail] = useState("");

  if (user) {
    navigate("/", { replace: true });
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await register({ email, password, displayName });
      } else {
        await login({ email, password });
      }
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto card p-6 flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-extrabold">
          {mode === "register" ? "Create your account" : "Sign in"}
        </h1>
        <p className="text-sm text-[#9297b3] mt-1">
          {mode === "register"
            ? "A profile lets you submit games and rate what you play."
            : "Welcome back."}
        </p>
      </div>

      {providers.password && (
        <>
          <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm">
            {(["signin", "register"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`flex-1 py-1.5 rounded-md font-medium transition ${
                  mode === m ? "bg-[var(--color-surface-2)] text-white" : "text-[#9297b3]"
                }`}
              >
                {m === "signin" ? "Sign in" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            {mode === "register" && (
              <label className="flex flex-col gap-1 text-sm">
                Display name
                <input
                  className="input"
                  required
                  minLength={2}
                  maxLength={60}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
            )}
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
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input
                className="input"
                type="password"
                required
                minLength={mode === "register" ? 8 : 1}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode === "register" && (
                <span className="text-xs text-[#7e849e]">At least 8 characters.</span>
              )}
            </label>
            <button className="btn btn-primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "register"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
        </>
      )}

      {providers.github && (
        <a
          className="btn"
          href={`${API_URL}/auth/github?returnTo=${encodeURIComponent(window.location.origin)}`}
        >
          Continue with GitHub
        </a>
      )}

      {providers.devLogin && (
        <form
          className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setBusy(true);
            try {
              await devLogin(devEmail);
              navigate("/");
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="text-xs uppercase tracking-wide text-[#7e849e]">Dev login (local only)</div>
          <div className="flex gap-2">
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
            />
            <button className="btn" disabled={busy || !devEmail}>
              Go
            </button>
          </div>
        </form>
      )}

      {!providers.password && !providers.github && !providers.devLogin && (
        <ErrorNote>No sign-in methods are enabled on this server.</ErrorNote>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

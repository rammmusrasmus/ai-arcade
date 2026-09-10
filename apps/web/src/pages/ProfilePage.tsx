import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Spinner } from "../components/primitives";

export function ProfilePage() {
  const { user, loading, updateProfile, changePassword, providers } = useAuth();

  if (loading) return <Spinner />;
  if (!user)
    return (
      <div className="card p-6 text-center">
        <p>
          <Link to="/login" className="text-[var(--color-accent)]">
            Sign in
          </Link>{" "}
          to view your profile.
        </p>
      </div>
    );

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Your profile</h1>

      <ProfileForm
        key={user.displayName + user.bio + user.avatarUrl}
        initial={{ displayName: user.displayName, bio: user.bio ?? "", avatarUrl: user.avatarUrl }}
        onSave={updateProfile}
      />

      {providers.password && (
        <PasswordForm hasPassword={user.hasPassword} onSave={changePassword} />
      )}

      <div className="card p-5 text-sm text-[#9297b3]">
        <div className="flex justify-between">
          <span>Email</span>
          <span className="text-[#c5c9dd]">{user.email}</span>
        </div>
        <div className="flex justify-between mt-1">
          <span>Role</span>
          <span className="text-[#c5c9dd]">{user.role}</span>
        </div>
        <div className="flex justify-between mt-1">
          <span>Member since</span>
          <span className="text-[#c5c9dd]">{new Date(user.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

function ProfileForm({
  initial,
  onSave,
}: {
  initial: { displayName: string; bio: string; avatarUrl: string | null };
  onSave: (i: { displayName?: string; bio?: string; avatarUrl?: string | null }) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-[var(--color-surface-2)] grid place-items-center text-2xl">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            displayName.charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="input" />
          <div className="flex gap-2">
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                const file = fileRef.current?.files?.[0];
                if (!file) {
                  setError("Choose an image first");
                  return;
                }
                run(async () => {
                  const { url } = await api.uploadImage(file);
                  setAvatarUrl(url);
                  await onSave({ avatarUrl: url });
                }, "Avatar updated.");
              }}
            >
              Upload avatar
            </button>
            {avatarUrl && (
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => run(async () => {
                  setAvatarUrl(null);
                  await onSave({ avatarUrl: null });
                }, "Avatar removed.")}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Display name
        <input
          className="input"
          value={displayName}
          minLength={2}
          maxLength={60}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Bio
        <textarea
          className="textarea"
          rows={3}
          maxLength={500}
          placeholder="Tell people what you build…"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
      </label>

      <button
        className="btn btn-primary self-start"
        disabled={busy}
        onClick={() => run(() => onSave({ displayName, bio }), "Profile saved.")}
      >
        Save profile
      </button>

      {msg && <p className="text-xs text-[#7ef0b0]">{msg}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </section>
  );
}

function PasswordForm({
  hasPassword,
  onSave,
}: {
  hasPassword: boolean;
  onSave: (newPassword: string, currentPassword?: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="card p-5 flex flex-col gap-3">
      <h2 className="font-semibold">{hasPassword ? "Change password" : "Set a password"}</h2>
      {!hasPassword && (
        <p className="text-sm text-[#9297b3]">
          Your account was created via another method. Set a password to also sign in with email.
        </p>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setMsg(null);
          try {
            await onSave(next, hasPassword ? current : undefined);
            setMsg("Password updated.");
            setCurrent("");
            setNext("");
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {hasPassword && (
          <input
            className="input"
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        )}
        <input
          className="input"
          type="password"
          placeholder="New password (min 8 chars)"
          autoComplete="new-password"
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <button className="btn self-start" disabled={busy}>
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
      {msg && <p className="text-xs text-[#7ef0b0]">{msg}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </section>
  );
}

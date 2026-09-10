import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

function navClass({ isActive }: { isActive: boolean }) {
  return [
    "px-3 py-1.5 rounded-lg text-sm font-medium transition",
    isActive ? "bg-[var(--color-surface-2)] text-white" : "text-[#aeb3cc] hover:text-white",
  ].join(" ");
}

export function Layout() {
  const { user, isModerator, logout, loading } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 backdrop-blur-md bg-[rgba(10,11,18,0.7)] border-b border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2 font-extrabold tracking-tight text-lg">
            <span className="inline-grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] text-black">
              ▶
            </span>
            AI&nbsp;Arcade
          </Link>

          <nav className="ml-4 flex items-center gap-1">
            <NavLink to="/" className={navClass} end>
              Store
            </NavLink>
            {user && (
              <NavLink to="/my-games" className={navClass}>
                My games
              </NavLink>
            )}
            {isModerator && (
              <NavLink to="/moderation" className={navClass}>
                Moderation
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link to="/submit" className="btn btn-primary">
              Submit a game
            </Link>
            {loading ? null : user ? (
              <div className="flex items-center gap-2">
                <Link
                  to="/profile"
                  className="flex items-center gap-2 hover:opacity-80"
                  title="Your profile"
                >
                  <span className="text-sm text-[#aeb3cc] hidden sm:block">{user.displayName}</span>
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-[var(--color-surface-2)] grid place-items-center text-sm">
                      {user.displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                </Link>
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    await logout();
                    navigate("/");
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link to="/login" className="btn">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-6xl w-full px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-xs text-[#7e849e]">
        AI Arcade · free games made with AI · be kind, credit your tools
      </footer>
    </div>
  );
}

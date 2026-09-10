import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { GameCard } from "../components/GameCard";
import { EmptyState, Spinner } from "../components/primitives";
import { useMyGames } from "../queries";

export function MyGamesPage() {
  const { user, loading } = useAuth();
  const mine = useMyGames(Boolean(user));

  if (loading) return <Spinner />;
  if (!user)
    return (
      <div className="card p-6 text-center">
        <p>
          <Link to="/login" className="text-[var(--color-accent)]">
            Sign in
          </Link>{" "}
          to see your games.
        </p>
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">My games</h1>
        <Link to="/submit" className="btn btn-primary">
          New submission
        </Link>
      </div>

      {mine.isLoading ? (
        <Spinner />
      ) : !mine.data || mine.data.length === 0 ? (
        <EmptyState title="Nothing here yet" hint="Submit your first AI game." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mine.data.map((g) => (
            <div key={g.id} className="flex flex-col gap-2">
              <GameCard game={g} showStatus />
              <Link to={`/manage/${g.slug}`} className="btn btn-ghost text-sm">
                Manage →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

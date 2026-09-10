import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { API_URL } from "../api";
import { GamePlayer } from "../components/GamePlayer";
import { ErrorNote, Spinner, Stars, StatusBadge } from "../components/primitives";
import { useGame, useRateGame } from "../queries";

export function GameDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const game = useGame(slug);
  const rate = useRateGame(slug ?? "");

  if (game.isLoading) return <Spinner />;
  if (game.isError || !game.data)
    return <ErrorNote>That game could not be found.</ErrorNote>;

  const g = game.data;
  const isOwner = user?.id === g.author.id;
  const canPlay = g.status === "approved" && (g.currentVersion || g.playType === "external");

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-8">
      <div className="flex flex-col gap-6 min-w-0">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-2xl font-extrabold tracking-tight">{g.title}</h1>
          {g.status !== "approved" && <StatusBadge status={g.status} />}
          {isOwner && (
            <Link to={`/manage/${g.slug}`} className="btn btn-ghost ml-auto">
              Manage
            </Link>
          )}
        </div>

        <p className="text-[#c5c9dd]">{g.summary}</p>

        {canPlay ? (
          <GamePlayer slug={g.slug} title={g.title} />
        ) : (
          <div className="card p-6 text-[#9297b3]">
            This game isn’t published yet, so it can’t be played.
          </div>
        )}

        {g.screenshots.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {g.screenshots.map((s) => (
              <img key={s} src={s} alt="" className="rounded-lg border border-[var(--color-border)]" />
            ))}
          </div>
        )}

        {g.description && (
          <div className="card p-5 whitespace-pre-wrap text-[#c5c9dd] leading-relaxed">
            {g.description}
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="card p-4 flex flex-col gap-3">
          <Row label="Author" value={g.author.displayName} />
          <Row label="Type" value={g.playType === "external" ? "External link" : "Browser (HTML)"} />
          <Row label="Plays" value={String(g.stats.playCount)} />
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#8b90ab]">Rating</span>
            <Stars value={g.stats.ratingAvg} count={g.stats.ratingCount} />
          </div>
          {g.currentVersion && (
            <Row label="Version" value={`v${g.currentVersion.version}`} />
          )}
        </div>

        {g.tags.length > 0 && (
          <div className="card p-4">
            <p className="text-sm text-[#8b90ab] mb-2">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {g.tags.map((t) => (
                <Link key={t} to={`/?tag=${encodeURIComponent(t)}`} className="badge">
                  {t}
                </Link>
              ))}
            </div>
          </div>
        )}

        {g.aiTools.length > 0 && (
          <div className="card p-4">
            <p className="text-sm text-[#8b90ab] mb-2">Built with</p>
            <div className="flex flex-wrap gap-1.5">
              {g.aiTools.map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {g.status === "approved" && g.playType === "html" && (
          <a className="btn" href={`${API_URL}/games/${g.slug}/download`}>
            ⬇ Download .zip
          </a>
        )}

        {user && !isOwner && g.status === "approved" && (
          <div className="card p-4">
            <p className="text-sm text-[#8b90ab] mb-2">Rate this game</p>
            <div className="flex gap-1 text-2xl">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className="hover:scale-110 transition disabled:opacity-50"
                  disabled={rate.isPending}
                  onClick={() => rate.mutate(n)}
                  aria-label={`${n} stars`}
                >
                  <span className="text-[#ffd166]">★</span>
                </button>
              ))}
            </div>
            {rate.isSuccess && <p className="text-xs text-[#7ef0b0] mt-1">Thanks for rating!</p>}
          </div>
        )}
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[#8b90ab]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

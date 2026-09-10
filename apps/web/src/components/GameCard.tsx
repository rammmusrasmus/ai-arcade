import { Link } from "react-router-dom";
import type { Game } from "@ai-arcade/shared";
import { Stars, StatusBadge } from "./primitives";

export function GameCard({ game, showStatus = false }: { game: Game; showStatus?: boolean }) {
  return (
    <Link
      to={`/games/${game.slug}`}
      className="card overflow-hidden group hover:border-[var(--color-accent)] transition flex flex-col"
    >
      <div className="aspect-[16/10] bg-[var(--color-surface-2)] relative overflow-hidden">
        {game.coverImageUrl ? (
          <img
            src={game.coverImageUrl}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-4xl opacity-40">
            {game.playType === "external" ? "🔗" : "🎮"}
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          {game.playType === "external" && <span className="badge">external</span>}
          {showStatus && <StatusBadge status={game.status} />}
        </div>
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-tight">{game.title}</h3>
        </div>
        <p className="text-sm text-[#9297b3] line-clamp-2 flex-1">{game.summary}</p>
        <div className="flex items-center justify-between pt-1">
          <Stars value={game.stats.ratingAvg} count={game.stats.ratingCount} />
          <span className="text-xs text-[#7e849e]">{game.stats.playCount} plays</span>
        </div>
        {game.aiTools.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {game.aiTools.slice(0, 3).map((t) => (
              <span key={t} className="badge">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

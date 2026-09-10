import { useState } from "react";
import { Link } from "react-router-dom";
import type { Game, ReviewAction } from "@ai-arcade/shared";
import { API_URL, errorMessage } from "../api";
import { useAuth } from "../auth";
import { GamePlayer } from "../components/GamePlayer";
import { EmptyState, ErrorNote, Spinner } from "../components/primitives";
import { useModerationDecision, useModerationQueue, useReviewHistory } from "../queries";

export function ModerationPage() {
  const { isModerator, loading } = useAuth();
  const queue = useModerationQueue(isModerator);

  if (loading) return <Spinner />;
  if (!isModerator) return <ErrorNote>Moderators only.</ErrorNote>;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold tracking-tight">Moderation queue</h1>
      {queue.isLoading ? (
        <Spinner />
      ) : !queue.data || queue.data.length === 0 ? (
        <EmptyState title="Queue is clear" hint="No games waiting for review." />
      ) : (
        <div className="flex flex-col gap-4">
          {queue.data.map((g) => (
            <ReviewCard key={g.id} game={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ game }: { game: Game }) {
  const decide = useModerationDecision();
  const history = useReviewHistory(game.id);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const pv = game.pendingVersion;
  const act = (action: ReviewAction) => {
    setError(null);
    decide.mutate(
      { gameId: game.id, input: { action, note } },
      { onError: (err) => setError(errorMessage(err)), onSuccess: () => setNote("") },
    );
  };

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-lg">
            <Link to={`/games/${game.slug}`} className="hover:text-[var(--color-accent)]">
              {game.title}
            </Link>
          </h3>
          <p className="text-sm text-[#9297b3]">
            by {game.author.displayName} · {game.playType} ·{" "}
            {game.status === "approved" ? "update to a live game" : "first submission"}
          </p>
        </div>
        <span className="badge ml-auto">{game.status}</span>
      </div>

      <p className="text-sm text-[#c5c9dd]">{game.summary}</p>

      <div className="flex flex-wrap gap-2 text-xs text-[#8b90ab]">
        {game.tags.map((t) => (
          <span key={t} className="badge">
            {t}
          </span>
        ))}
        {game.aiTools.map((t) => (
          <span key={t} className="badge">
            🤖 {t}
          </span>
        ))}
      </div>

      {pv && (
        <div className="text-sm text-[#9297b3] flex flex-wrap gap-x-4 gap-y-1">
          <span>pending v{pv.version}</span>
          {pv.fileCount != null && <span>{pv.fileCount} files</span>}
          {pv.unzippedBytes != null && <span>{(pv.unzippedBytes / 1024).toFixed(0)} KB unzipped</span>}
          {pv.entryPath && <span>entry: {pv.entryPath}</span>}
          {pv.sha256 && <span className="font-mono text-xs">{pv.sha256.slice(0, 12)}…</span>}
        </div>
      )}

      {pv && pv.externalRefs && pv.externalRefs.length > 0 && (
        <div className="card p-3 border-[#5c4a1f] bg-[#2a220f] text-[#ffd58a] text-sm">
          <p className="font-semibold">
            ⚠ Requests {pv.externalRefs.length} external URL
            {pv.externalRefs.length === 1 ? "" : "s"} — won’t load in the desktop client
          </p>
          <p className="text-[#c9b98a] mt-1">
            The desktop app blocks all outside network access. A bundled game should ship every
            asset. (Fine to ignore if these are only in comments/strings.)
          </p>
          <ul className="mt-2 font-mono text-xs break-all list-disc pl-5">
            {pv.externalRefs.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-ghost" onClick={() => setPreview((p) => !p)}>
          {preview ? "Hide preview" : "Preview game"}
        </button>
        {game.playType === "html" && (
          <a className="btn btn-ghost" href={`${API_URL}/games/${game.slug}/download`}>
            Download .zip
          </a>
        )}
      </div>

      {preview && (
        <div className="pt-1">
          <GamePlayer slug={game.slug} title={game.title} />
          <p className="text-xs text-[#7e849e] mt-1">
            Preview loads the latest build (pending or live) in a sandboxed frame.
          </p>
        </div>
      )}

      <textarea
        className="textarea"
        rows={2}
        placeholder="Note to the author (required for rejections)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2 flex-wrap">
        <button
          className="btn btn-primary"
          disabled={decide.isPending}
          onClick={() => act("approve")}
        >
          Approve & publish
        </button>
        <button
          className="btn"
          disabled={decide.isPending || !note.trim()}
          onClick={() => act("request_changes")}
        >
          Request changes
        </button>
        <button
          className="btn btn-danger"
          disabled={decide.isPending || !note.trim()}
          onClick={() => act("reject")}
        >
          Reject
        </button>
        <button className="btn btn-ghost" disabled={decide.isPending} onClick={() => act("comment")}>
          Comment only
        </button>
      </div>

      {history.data && history.data.length > 0 && (
        <details className="text-sm text-[#9297b3]">
          <summary className="cursor-pointer">History ({history.data.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {history.data.map((h) => (
              <li key={h.id}>
                <span className="badge">{h.action}</span> {h.note}{" "}
                <span className="text-[#7e849e]">
                  — {h.moderator.displayName}, {new Date(h.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

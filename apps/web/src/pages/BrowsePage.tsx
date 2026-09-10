import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ListGamesQuery } from "@ai-arcade/shared";
import { GameCard } from "../components/GameCard";
import { EmptyState, ErrorNote, Spinner } from "../components/primitives";
import { useGames, useTags } from "../queries";

const SORTS: { value: ListGamesQuery["sort"]; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "popular", label: "Most played" },
  { value: "top_rated", label: "Top rated" },
  { value: "updated", label: "Recently updated" },
];

export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const [qInput, setQInput] = useState(params.get("q") ?? "");

  const query = useMemo<Partial<ListGamesQuery>>(
    () => ({
      q: params.get("q") ?? undefined,
      tag: params.get("tag") ?? undefined,
      sort: (params.get("sort") as ListGamesQuery["sort"]) ?? "newest",
      page: Number(params.get("page") ?? "1"),
      pageSize: 24,
    }),
    [params],
  );

  const games = useGames(query);
  const tags = useTags();

  function patch(next: Record<string, string | undefined>) {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "") merged.delete(k);
      else merged.set(k, v);
    }
    if (!("page" in next)) merged.delete("page");
    setParams(merged);
  }

  const activeTag = params.get("tag") ?? undefined;

  return (
    <div className="flex flex-col gap-6">
      <section className="card p-6 sm:p-8 bg-gradient-to-br from-[var(--color-surface)] to-[#15182a]">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
          Free games, made with AI.
        </h1>
        <p className="text-[#9297b3] mt-2 max-w-xl">
          A community storefront for games built with Claude and other AI tools. Play in your
          browser, or grab the desktop app to build a library.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex-1 min-w-[220px]"
          onSubmit={(e) => {
            e.preventDefault();
            patch({ q: qInput || undefined });
          }}
        >
          <input
            className="input"
            placeholder="Search games…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </form>
        <select
          className="select max-w-[190px]"
          value={query.sort}
          onChange={(e) => patch({ sort: e.target.value })}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {tags.data && tags.data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            className={`badge ${!activeTag ? "border-[var(--color-accent)] text-white" : ""}`}
            onClick={() => patch({ tag: undefined })}
          >
            all
          </button>
          {tags.data.slice(0, 20).map((t) => (
            <button
              key={t.tag}
              className={`badge ${activeTag === t.tag ? "border-[var(--color-accent)] text-white" : ""}`}
              onClick={() => patch({ tag: activeTag === t.tag ? undefined : t.tag })}
            >
              {t.tag} <span className="text-[#7e849e]">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {games.isLoading ? (
        <Spinner label="Loading games…" />
      ) : games.isError ? (
        <ErrorNote>Could not load games. Is the API running on port 4000?</ErrorNote>
      ) : !games.data || games.data.items.length === 0 ? (
        <EmptyState title="No games yet" hint="Be the first to submit one." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {games.data.items.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
          <Pagination
            page={games.data.page}
            pageSize={games.data.pageSize}
            total={games.data.total}
            onPage={(p) => patch({ page: String(p) })}
          />
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="text-sm text-[#9297b3]">
        Page {page} of {pages}
      </span>
      <button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

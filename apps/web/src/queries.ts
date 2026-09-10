import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type {
  CreateGameInput,
  Game,
  ListGamesQuery,
  ModerationDecisionInput,
  UpdateGameInput,
} from "@ai-arcade/shared";
import { api } from "./api";

export function useGames(query: Partial<ListGamesQuery>) {
  return useQuery({
    queryKey: ["games", query],
    queryFn: () => api.listGames(query),
  });
}

export function useGame(slug: string | undefined, opts?: Partial<UseQueryOptions<Game>>) {
  return useQuery({
    queryKey: ["game", slug],
    queryFn: () => api.getGame(slug!),
    enabled: Boolean(slug),
    ...opts,
  });
}

export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: () => api.listTags(), staleTime: 60_000 });
}

export function useMyGames(enabled: boolean) {
  return useQuery({ queryKey: ["my-games"], queryFn: () => api.myGames(), enabled });
}

export function useModerationQueue(enabled: boolean) {
  return useQuery({
    queryKey: ["moderation-queue"],
    queryFn: () => api.moderationQueue(),
    enabled,
    refetchInterval: 20_000,
  });
}

export function useReviewHistory(gameId: string | undefined) {
  return useQuery({
    queryKey: ["review-history", gameId],
    queryFn: () => api.reviewHistory(gameId!),
    enabled: Boolean(gameId),
  });
}

export function useGameVersions(gameId: string | undefined) {
  return useQuery({
    queryKey: ["game-versions", gameId],
    queryFn: () => api.getGameVersions(gameId!),
    enabled: Boolean(gameId),
  });
}

/* ---------------- mutations ---------------- */

export function useCreateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGameInput) => api.createGame(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-games"] }),
  });
}

export function useUpdateGame(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGameInput) => api.updateGame(slug, input),
    onSuccess: (game) => {
      qc.setQueryData(["game", slug], game);
      qc.invalidateQueries({ queryKey: ["my-games"] });
    },
  });
}

export function useUploadVersion(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bundle, changelog }: { bundle: File; changelog: string }) =>
      api.uploadVersion(slug, bundle, { changelog }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["game", slug] });
      qc.invalidateQueries({ queryKey: ["game-versions"] });
    },
  });
}

export function useSubmitForReview(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => api.submitForReview(slug, { note }),
    onSuccess: (game) => {
      qc.setQueryData(["game", slug], game);
      qc.invalidateQueries({ queryKey: ["my-games"] });
    },
  });
}

export function useUnpublish(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.unpublishOwnGame(slug),
    onSuccess: (game) => {
      qc.setQueryData(["game", slug], game);
      qc.invalidateQueries({ queryKey: ["my-games"] });
    },
  });
}

export function useSetMedia(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (media: { coverImageUrl?: string | null; screenshots?: string[] }) =>
      api.setGameMedia(slug, media),
    onSuccess: (game) => qc.setQueryData(["game", slug], game),
  });
}

export function useModerationDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ gameId, input }: { gameId: string; input: ModerationDecisionInput }) =>
      api.decideModeration(gameId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moderation-queue"] });
      qc.invalidateQueries({ queryKey: ["games"] });
    },
  });
}

export function useRateGame(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: number) => api.rateGame(slug, { value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game", slug] }),
  });
}

import { and, desc, eq, like, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ListGamesQuery, RateGameInput } from "@ai-arcade/shared";
import { requireUser } from "../auth/index.js";
import { db } from "../db/index.js";
import { games, gameVersions, ratings } from "../db/schema.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { rateLimit } from "../lib/rateLimit.js";
import {
  findGame,
  requireGame,
  serializeBundle,
  serializeGameRows,
} from "../lib/gameLoader.js";
import { toGameVersion } from "../serializers.js";

export async function gameRoutes(app: FastifyInstance) {
  /* ---------------- list ---------------- */

  app.get("/games", async (req) => {
    const query = ListGamesQuery.parse(req.query ?? {});
    const conditions = [];

    const wantsOwn = query.mine || query.authorId;
    if (wantsOwn) {
      const user = requireUser(req);
      const authorId = query.authorId ?? user.id;
      if (authorId !== user.id && user.role === "user") throw forbidden();
      conditions.push(eq(games.authorId, authorId));
      if (query.status) conditions.push(eq(games.status, query.status));
    } else if (query.status && query.status !== "approved") {
      // Only moderators can browse non-approved games in bulk.
      const user = requireUser(req);
      if (user.role === "user") throw forbidden("Only moderators can filter by that status");
      conditions.push(eq(games.status, query.status));
    } else {
      conditions.push(eq(games.status, "approved"));
    }

    if (query.q) {
      const term = `%${query.q.toLowerCase()}%`;
      conditions.push(
        or(
          like(sql`lower(${games.title})`, term),
          like(sql`lower(${games.summary})`, term),
          like(sql`lower(${games.tags})`, term),
        )!,
      );
    }
    if (query.tag) {
      conditions.push(like(sql`lower(${games.tags})`, `%"${query.tag.toLowerCase()}"%`));
    }
    if (query.aiTool) {
      conditions.push(like(sql`lower(${games.aiTools})`, `%"${query.aiTool.toLowerCase()}"%`));
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const orderBy = {
      newest: [desc(sql`coalesce(${games.publishedAt}, ${games.createdAt})`)],
      updated: [desc(games.updatedAt)],
      popular: [desc(games.playCount), desc(games.ratingCount)],
      top_rated: [
        desc(sql`case when ${games.ratingCount} > 0 then ${games.ratingSum} * 1.0 / ${games.ratingCount} else 0 end`),
        desc(games.ratingCount),
      ],
    }[query.sort];

    const totalRow = await db
      .select({ n: sql<number>`count(*)` })
      .from(games)
      .where(where)
      .get();
    const total = totalRow?.n ?? 0;

    const rows = await db
      .select()
      .from(games)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      items: await serializeGameRows(rows),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  });

  /* ---------------- tags ---------------- */

  app.get("/tags", async () => {
    const rows = await db
      .select({ tags: games.tags })
      .from(games)
      .where(eq(games.status, "approved"));
    const counts = new Map<string, number>();
    for (const r of rows) {
      try {
        for (const t of JSON.parse(r.tags) as string[]) {
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
      } catch {
        /* ignore */
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  });

  /* ---------------- single game ---------------- */

  app.get("/games/:slugOrId", async (req) => {
    const { slugOrId } = req.params as { slugOrId: string };
    const bundle = await findGame(slugOrId);
    if (!bundle) throw notFound("Game not found");

    const isOwner = req.user?.id === bundle.game.authorId;
    const isMod = req.user?.role === "moderator" || req.user?.role === "admin";
    if (bundle.game.status !== "approved" && !isOwner && !isMod) {
      throw notFound("Game not found");
    }
    return serializeBundle(bundle);
  });

  app.get("/games/:slugOrId/versions", async (req) => {
    const { slugOrId } = req.params as { slugOrId: string };
    const { game } = await requireGame(slugOrId);
    const isOwner = req.user?.id === game.authorId;
    const isMod = req.user?.role === "moderator" || req.user?.role === "admin";
    if (!isOwner && !isMod) throw forbidden();
    const rows = await db
      .select()
      .from(gameVersions)
      .where(eq(gameVersions.gameId, game.id))
      .orderBy(desc(gameVersions.version));
    return rows.map(toGameVersion);
  });

  /* ---------------- rate ---------------- */

  app.post(
    "/games/:slugOrId/rate",
    { preHandler: rateLimit("rate-game", 120, 60 * 60_000) },
    async (req) => {
    const user = requireUser(req);
    const { slugOrId } = req.params as { slugOrId: string };
    const { value } = RateGameInput.parse(req.body);
    const { game } = await requireGame(slugOrId);
    if (game.status !== "approved") throw badRequest("You can only rate published games");
    if (game.authorId === user.id) throw forbidden("You cannot rate your own game");

    const existing = await db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, user.id), eq(ratings.gameId, game.id)))
      .get();

    if (existing) {
      await db
        .update(ratings)
        .set({ value, updatedAt: Date.now() })
        .where(and(eq(ratings.userId, user.id), eq(ratings.gameId, game.id)));
      await db
        .update(games)
        .set({ ratingSum: sql`${games.ratingSum} - ${existing.value} + ${value}` })
        .where(eq(games.id, game.id));
    } else {
      await db.insert(ratings).values({ userId: user.id, gameId: game.id, value });
      await db
        .update(games)
        .set({
          ratingSum: sql`${games.ratingSum} + ${value}`,
          ratingCount: sql`${games.ratingCount} + 1`,
        })
        .where(eq(games.id, game.id));
    }

    const updated = await db.select().from(games).where(eq(games.id, game.id)).get();
    const count = updated?.ratingCount ?? 0;
    const sum = updated?.ratingSum ?? 0;
    return {
      ratingAvg: count > 0 ? Math.round((sum / count) * 100) / 100 : 0,
      ratingCount: count,
    };
    },
  );
}

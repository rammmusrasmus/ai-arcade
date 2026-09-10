import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ModerationDecisionInput } from "@ai-arcade/shared";
import { requireRole } from "../auth/index.js";
import { db } from "../db/index.js";
import { games, gameVersions, reviewEvents, users } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { id } from "../lib/ids.js";
import { requireGame, serializeBundle } from "../lib/gameLoader.js";
import { toGameVersion, toReviewEvent } from "../serializers.js";

async function latestPendingVersion(gameId: string) {
  return db
    .select()
    .from(gameVersions)
    .where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.status, "pending")))
    .orderBy(desc(gameVersions.version))
    .get();
}

export async function moderationRoutes(app: FastifyInstance) {
  app.get("/moderation/queue", async (req) => {
    requireRole(req, "moderator");

    const pendingGameIds = (
      await db
        .select({ gameId: gameVersions.gameId })
        .from(gameVersions)
        .where(eq(gameVersions.status, "pending"))
    ).map((r) => r.gameId);

    const rows = await db
      .select()
      .from(games)
      .where(
        or(
          eq(games.status, "pending"),
          pendingGameIds.length ? inArray(games.id, pendingGameIds) : sql`0`,
        ),
      )
      .orderBy(desc(games.updatedAt));

    const out = [];
    for (const g of rows) {
      const bundle = await requireGame(g.id);
      const pending = await latestPendingVersion(g.id);
      out.push({
        ...serializeBundle(bundle),
        pendingVersion: pending ? toGameVersion(pending) : null,
      });
    }
    return out;
  });

  app.get("/moderation/games/:slugOrId/history", async (req) => {
    requireRole(req, "moderator");
    const { slugOrId } = req.params as { slugOrId: string };
    const { game } = await requireGame(slugOrId);
    const rows = await db
      .select({ event: reviewEvents, moderator: users })
      .from(reviewEvents)
      .innerJoin(users, eq(users.id, reviewEvents.moderatorId))
      .where(eq(reviewEvents.gameId, game.id))
      .orderBy(desc(reviewEvents.createdAt));
    return rows.map((r) => toReviewEvent(r.event, r.moderator));
  });

  app.post("/moderation/games/:slugOrId/decide", async (req) => {
    const mod = requireRole(req, "moderator");
    const { slugOrId } = req.params as { slugOrId: string };
    const { action, note } = ModerationDecisionInput.parse(req.body);
    const { game } = await requireGame(slugOrId);
    const now = Date.now();

    const pending = await latestPendingVersion(game.id);

    if (action === "approve") {
      let versionId = game.currentVersionId;

      if (game.playType === "html") {
        if (!pending) throw badRequest("There is no pending version to approve");
        await db
          .update(gameVersions)
          .set({ status: "approved", reviewedAt: now, reviewedBy: mod.id })
          .where(eq(gameVersions.id, pending.id));
        versionId = pending.id;
      } else {
        // external game: reuse pending version row or synthesize one
        if (pending) {
          await db
            .update(gameVersions)
            .set({
              status: "approved",
              reviewedAt: now,
              reviewedBy: mod.id,
              externalUrl: game.externalUrl,
            })
            .where(eq(gameVersions.id, pending.id));
          versionId = pending.id;
        } else {
          const newId = id("ver");
          const versionNumber =
            ((
              await db
                .select({ v: sql<number>`coalesce(max(${gameVersions.version}), 0)` })
                .from(gameVersions)
                .where(eq(gameVersions.gameId, game.id))
                .get()
            )?.v ?? 0) + 1;
          await db.insert(gameVersions).values({
            id: newId,
            gameId: game.id,
            version: versionNumber,
            status: "approved",
            changelog: "",
            playType: "external",
            entryPath: null,
            externalUrl: game.externalUrl,
            bundleKey: null,
            createdAt: now,
            reviewedAt: now,
            reviewedBy: mod.id,
          });
          versionId = newId;
        }
      }

      await db
        .update(games)
        .set({
          status: "approved",
          currentVersionId: versionId,
          publishedAt: game.publishedAt ?? now,
          updatedAt: now,
        })
        .where(eq(games.id, game.id));
    } else if (action === "reject" || action === "request_changes") {
      if (pending) {
        await db
          .update(gameVersions)
          .set({ status: "rejected", reviewedAt: now, reviewedBy: mod.id })
          .where(eq(gameVersions.id, pending.id));
      }
      if (game.status === "pending") {
        await db
          .update(games)
          .set({ status: "rejected", updatedAt: now })
          .where(eq(games.id, game.id));
      }
    } else if (action === "unpublish") {
      await db
        .update(games)
        .set({ status: "unpublished", updatedAt: now })
        .where(eq(games.id, game.id));
    } else if (action === "comment") {
      // no state change
    }

    await db.insert(reviewEvents).values({
      id: id("rev"),
      gameId: game.id,
      versionId: pending?.id ?? game.currentVersionId ?? null,
      moderatorId: mod.id,
      action,
      note,
      createdAt: now,
    });

    return serializeBundle(await requireGame(game.id));
  });
}

export { ne };

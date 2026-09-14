import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/index.js";
import { db } from "../db/index.js";
import { games, gameVersions } from "../db/schema.js";
import { and, eq, sql } from "drizzle-orm";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { requireGame } from "../lib/gameLoader.js";
import { storage } from "../storage/index.js";

export async function downloadRoutes(app: FastifyInstance) {
  /**
   * Used by the desktop client to "install" a game: streams the approved
   * bundle zip with metadata headers.
   */
  app.get("/games/:slugOrId/download", async (req, reply) => {
    const { slugOrId } = req.params as { slugOrId: string };
    const { game, currentVersion } = await requireGame(slugOrId);

    if (game.status !== "approved" || !currentVersion) {
      throw notFound("No published build available");
    }
    if (game.playType === "external") {
      throw badRequest("This game is hosted externally; open its URL instead");
    }
    if (!currentVersion.bundleKey || !existsSync(storage.bundlePath(currentVersion.bundleKey))) {
      throw notFound("Bundle file is missing on the server");
    }

    const buffer = await storage.readBundle(currentVersion.bundleKey);

    await db
      .update(games)
      .set({ playCount: sql`${games.playCount} + 1` })
      .where(eq(games.id, game.id));

    reply
      .header("content-type", "application/zip")
      .header(
        "content-disposition",
        `attachment; filename="${game.slug}-v${currentVersion.version}.zip"`,
      )
      .header("x-game-id", game.id)
      .header("x-game-slug", game.slug)
      .header("x-game-version", String(currentVersion.version))
      .header("x-entry-path", currentVersion.entryPath ?? "index.html")
      .header("x-bundle-sha256", currentVersion.sha256 ?? "")
      .header("cache-control", "no-store");
    return reply.send(buffer);
  });

  /**
   * A specific version's bundle, including unapproved ones — so moderators can play
   * a submission in the desktop app before deciding, and authors can test theirs.
   */
  app.get("/games/:slugOrId/versions/:versionId/download", async (req, reply) => {
    const user = requireUser(req);
    const { slugOrId, versionId } = req.params as { slugOrId: string; versionId: string };
    const { game } = await requireGame(slugOrId);
    if (user.role === "user" && game.authorId !== user.id) {
      throw forbidden("Only moderators or the author can download unreleased builds");
    }

    const version = await db
      .select()
      .from(gameVersions)
      .where(and(eq(gameVersions.id, versionId), eq(gameVersions.gameId, game.id)))
      .get();
    if (!version) throw notFound("No such version");
    if (version.playType === "external") {
      throw badRequest("This version is hosted externally; there's no bundle to download");
    }
    if (!version.bundleKey || !existsSync(storage.bundlePath(version.bundleKey))) {
      throw notFound("Bundle file is missing on the server");
    }

    const buffer = await storage.readBundle(version.bundleKey);
    reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="${game.slug}-v${version.version}.zip"`)
      .header("x-game-id", game.id)
      .header("x-game-slug", game.slug)
      .header("x-game-version", String(version.version))
      .header("x-entry-path", version.entryPath ?? "index.html")
      .header("x-bundle-sha256", version.sha256 ?? "")
      .header("cache-control", "no-store");
    return reply.send(buffer);
  });
}

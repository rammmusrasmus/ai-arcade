import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CreateGameInput,
  CreateVersionMeta,
  SubmitForReviewInput,
  UpdateGameInput,
} from "@ai-arcade/shared";
import { requireUser } from "../auth/index.js";
import { db } from "../db/index.js";
import { games, gameVersions } from "../db/schema.js";
import { env } from "../env.js";
import { badRequest, conflict, forbidden, notFound, payloadTooLarge } from "../lib/errors.js";
import { id } from "../lib/ids.js";
import { rateLimit } from "../lib/rateLimit.js";
import { inspectBundle, extractBundle } from "../lib/bundle.js";
import {
  findGame,
  nextVersionNumber,
  requireGame,
  serializeBundle,
  slugExists,
} from "../lib/gameLoader.js";
import { slugify, uniqueSlug } from "../lib/slug.js";
import { storage } from "../storage/index.js";
import { toGameVersion } from "../serializers.js";

async function ownedGame(req: FastifyRequest, slugOrId: string) {
  const user = requireUser(req);
  const bundle = await requireGame(slugOrId);
  const isMod = user.role === "moderator" || user.role === "admin";
  if (bundle.game.authorId !== user.id && !isMod) throw forbidden("You do not own this game");
  return { user, ...bundle };
}

async function readBundlePart(req: FastifyRequest): Promise<{ buffer: Buffer; meta: CreateVersionMeta }> {
  let buffer: Buffer | null = null;
  let metaRaw = "{}";
  const parts = req.parts();
  for await (const part of parts) {
    if (part.type === "file") {
      if (part.fieldname !== "bundle") {
        part.file.resume();
        continue;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of part.file) {
        size += chunk.length;
        if (size > env.MAX_BUNDLE_BYTES) {
          throw payloadTooLarge(
            `Bundle exceeds ${Math.round(env.MAX_BUNDLE_BYTES / 1024 / 1024)} MB`,
          );
        }
        chunks.push(chunk);
      }
      if (part.file.truncated) {
        throw payloadTooLarge("Bundle exceeds the upload size limit");
      }
      buffer = Buffer.concat(chunks);
    } else if (part.fieldname === "meta") {
      metaRaw = String(part.value ?? "{}");
    }
  }
  if (!buffer) throw badRequest('Missing "bundle" file part (a .zip)');
  let metaJson: unknown;
  try {
    metaJson = JSON.parse(metaRaw);
  } catch {
    throw badRequest('The "meta" part must be valid JSON');
  }
  return { buffer, meta: CreateVersionMeta.parse(metaJson) };
}

export async function authoringRoutes(app: FastifyInstance) {
  /* ---------------- my games ---------------- */

  app.get("/me/games", async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select()
      .from(games)
      .where(eq(games.authorId, user.id))
      .orderBy(desc(games.updatedAt));
    const out = [];
    for (const g of rows) {
      const bundle = await findGame(g.id);
      if (bundle) out.push(serializeBundle(bundle));
    }
    return out;
  });

  /* ---------------- create ---------------- */

  app.post("/games", { preHandler: rateLimit("create-game", 30, 60 * 60_000) }, async (req) => {
    const user = requireUser(req);
    const input = CreateGameInput.parse(req.body);
    if (input.playType === "external" && !input.externalUrl) {
      throw badRequest("externalUrl is required for external games");
    }

    let slug: string;
    if (input.slug) {
      if (await slugExists(input.slug)) throw conflict(`Slug "${input.slug}" is taken`);
      slug = input.slug;
    } else {
      slug = await uniqueSlug(input.title, slugExists);
    }

    const gameId = id("game");
    const now = Date.now();
    await db.insert(games).values({
      id: gameId,
      slug,
      title: input.title,
      summary: input.summary,
      description: input.description,
      tags: JSON.stringify(dedupeTags(input.tags)),
      aiTools: JSON.stringify(input.aiTools),
      status: "draft",
      playType: input.playType,
      externalUrl: input.externalUrl ?? null,
      authorId: user.id,
      createdAt: now,
      updatedAt: now,
    });

    return serializeBundle(await requireGame(gameId));
  });

  /* ---------------- update metadata ---------------- */

  app.patch("/games/:slugOrId", async (req) => {
    const { slugOrId } = req.params as { slugOrId: string };
    const { game } = await ownedGame(req, slugOrId);
    const input = UpdateGameInput.parse(req.body);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.description !== undefined) patch.description = input.description;
    if (input.tags !== undefined) patch.tags = JSON.stringify(dedupeTags(input.tags));
    if (input.aiTools !== undefined) patch.aiTools = JSON.stringify(input.aiTools);
    if (input.externalUrl !== undefined) {
      if (game.playType !== "external") throw badRequest("Only external games have an externalUrl");
      patch.externalUrl = input.externalUrl;
    }

    await db.update(games).set(patch).where(eq(games.id, game.id));
    return serializeBundle(await requireGame(game.id));
  });

  /* ---------------- media ---------------- */

  app.put("/games/:slugOrId/media", async (req) => {
    const { slugOrId } = req.params as { slugOrId: string };
    const { game } = await ownedGame(req, slugOrId);
    const body = (req.body ?? {}) as { coverImageUrl?: string | null; screenshots?: string[] };
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if ("coverImageUrl" in body) patch.coverImageUrl = body.coverImageUrl ?? null;
    if (Array.isArray(body.screenshots)) {
      patch.screenshots = JSON.stringify(body.screenshots.slice(0, 8).filter((s) => typeof s === "string"));
    }
    await db.update(games).set(patch).where(eq(games.id, game.id));
    return serializeBundle(await requireGame(game.id));
  });

  /* ---------------- upload a bundle version ---------------- */

  app.post(
    "/games/:slugOrId/versions",
    { preHandler: rateLimit("upload-version", 40, 60 * 60_000) },
    async (req) => {
    const { slugOrId } = req.params as { slugOrId: string };
    const { game } = await ownedGame(req, slugOrId);
    if (game.playType !== "html") {
      throw badRequest("Bundle uploads are only for HTML games");
    }

    const { buffer, meta } = await readBundlePart(req);
    const info = inspectBundle(buffer, {
      maxFiles: env.MAX_BUNDLE_FILES,
      maxUnzippedBytes: env.MAX_UNZIPPED_BYTES,
    }, meta.entryPath);

    const versionId = id("ver");
    const versionNumber = await nextVersionNumber(game.id);
    const bundleKey = await storage.putBundle(versionId, buffer);
    extractBundle(buffer, storage.extractedDir(game.id, versionId));

    const row = {
      id: versionId,
      gameId: game.id,
      version: versionNumber,
      status: "pending" as const,
      changelog: meta.changelog,
      playType: "html" as const,
      entryPath: info.entryPath,
      externalUrl: null,
      bundleKey,
      bundleBytes: buffer.length,
      unzippedBytes: info.unzippedBytes,
      fileCount: info.fileCount,
      sha256: info.sha256,
      externalRefs: JSON.stringify(info.externalRefs),
      createdAt: Date.now(),
      reviewedAt: null,
      reviewedBy: null,
    };
    await db.insert(gameVersions).values(row);
    await db.update(games).set({ updatedAt: Date.now() }).where(eq(games.id, game.id));

    return toGameVersion(row);
    },
  );

  /* ---------------- submit for review ---------------- */

  app.post("/games/:slugOrId/submit", async (req) => {
    const { slugOrId } = req.params as { slugOrId: string };
    const { game } = await ownedGame(req, slugOrId);
    SubmitForReviewInput.parse(req.body ?? {});

    if (game.status === "pending") throw conflict("This game is already awaiting review");
    if (game.summary.trim().length < 10) throw badRequest("Add a summary before submitting");

    if (game.playType === "external") {
      if (!game.externalUrl) throw badRequest("Set the game URL before submitting");
    } else {
      const hasVersion = await db
        .select({ id: gameVersions.id })
        .from(gameVersions)
        .where(eq(gameVersions.gameId, game.id))
        .get();
      if (!hasVersion) throw badRequest("Upload a game bundle before submitting");
    }

    await db
      .update(games)
      .set({ status: "pending", updatedAt: Date.now() })
      .where(eq(games.id, game.id));
    return serializeBundle(await requireGame(game.id));
  });

  /* ---------------- unpublish own game ---------------- */

  app.post("/games/:slugOrId/unpublish", async (req) => {
    const { slugOrId } = req.params as { slugOrId: string };
    const { game } = await ownedGame(req, slugOrId);
    if (game.status !== "approved" && game.status !== "pending") {
      throw badRequest("Only a live or pending game can be taken down");
    }
    await db
      .update(games)
      .set({ status: "unpublished", updatedAt: Date.now() })
      .where(eq(games.id, game.id));
    return serializeBundle(await requireGame(game.id));
  });

  /* ---------------- delete a draft ---------------- */

  app.delete("/games/:slugOrId", async (req, reply) => {
    const { slugOrId } = req.params as { slugOrId: string };
    const { game } = await ownedGame(req, slugOrId);
    if (game.status !== "draft" && game.status !== "rejected") {
      throw badRequest("Only draft or rejected games can be deleted");
    }
    const versions = await db
      .select()
      .from(gameVersions)
      .where(eq(gameVersions.gameId, game.id));
    for (const v of versions) await storage.removeExtracted(game.id, v.id);
    await db.delete(games).where(eq(games.id, game.id));
    reply.status(204).send();
  });
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const norm = slugify(t).replace(/-/g, " ").trim() || t.toLowerCase().trim();
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out.slice(0, 12);
}

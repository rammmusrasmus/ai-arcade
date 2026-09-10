import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { gameVersions, games, users, type GameRow, type GameVersionRow, type UserRow } from "../db/schema.js";
import { toGame } from "../serializers.js";
import type { Game } from "@ai-arcade/shared";
import { notFound } from "./errors.js";

export interface GameBundle {
  game: GameRow;
  author: UserRow;
  currentVersion: GameVersionRow | null;
}

export async function findGame(slugOrId: string): Promise<GameBundle | null> {
  const game = await db
    .select()
    .from(games)
    .where(or(eq(games.id, slugOrId), eq(games.slug, slugOrId)))
    .get();
  if (!game) return null;
  const author = await db.select().from(users).where(eq(users.id, game.authorId)).get();
  if (!author) return null;
  let currentVersion: GameVersionRow | null = null;
  if (game.currentVersionId) {
    currentVersion =
      (await db.select().from(gameVersions).where(eq(gameVersions.id, game.currentVersionId)).get()) ??
      null;
  }
  return { game, author, currentVersion };
}

export async function requireGame(slugOrId: string): Promise<GameBundle> {
  const found = await findGame(slugOrId);
  if (!found) throw notFound("Game not found");
  return found;
}

export function serializeBundle(b: GameBundle): Game {
  return toGame(b.game, b.author, b.currentVersion);
}

/** Batch-serialize a list of game rows, resolving authors and current versions. */
export async function serializeGameRows(rows: GameRow[]): Promise<Game[]> {
  if (rows.length === 0) return [];
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const versionIds = rows.map((r) => r.currentVersionId).filter((v): v is string => Boolean(v));

  const authors = await db.select().from(users).where(inArray(users.id, authorIds));
  const authorById = new Map(authors.map((a) => [a.id, a]));

  const versions =
    versionIds.length > 0
      ? await db.select().from(gameVersions).where(inArray(gameVersions.id, versionIds))
      : [];
  const versionById = new Map(versions.map((v) => [v.id, v]));

  const out: Game[] = [];
  for (const row of rows) {
    const author = authorById.get(row.authorId);
    if (!author) continue;
    const version = row.currentVersionId ? versionById.get(row.currentVersionId) ?? null : null;
    out.push(toGame(row, author, version));
  }
  return out;
}

export async function slugExists(slug: string): Promise<boolean> {
  const row = await db.select({ id: games.id }).from(games).where(eq(games.slug, slug)).get();
  return Boolean(row);
}

export async function nextVersionNumber(gameId: string): Promise<number> {
  const rows = await db
    .select({ version: gameVersions.version })
    .from(gameVersions)
    .where(eq(gameVersions.gameId, gameId));
  return rows.reduce((max, r) => Math.max(max, r.version), 0) + 1;
}

export { and, eq };

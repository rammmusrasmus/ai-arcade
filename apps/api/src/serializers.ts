import type {
  AuthorRef,
  Game,
  GameStats,
  GameVersion,
  ReviewEvent,
  User,
} from "@ai-arcade/shared";
import type {
  GameRow,
  GameVersionRow,
  ReviewEventRow,
  UserRow,
} from "./db/schema.js";

const iso = (ms: number | null): string | null => (ms == null ? null : new Date(ms).toISOString());
const isoReq = (ms: number): string => new Date(ms).toISOString();

function parseStringArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function toAuthorRef(u: UserRow): AuthorRef {
  return { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl ?? null };
}

export function toUser(u: UserRow): User {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? null,
    bio: u.bio ?? null,
    role: u.role,
    hasPassword: Boolean(u.passwordHash),
    createdAt: isoReq(u.createdAt),
  };
}

export function toGameVersion(v: GameVersionRow): GameVersion {
  return {
    id: v.id,
    gameId: v.gameId,
    version: v.version,
    status: v.status,
    changelog: v.changelog,
    playType: v.playType,
    entryPath: v.entryPath ?? null,
    externalUrl: v.externalUrl ?? null,
    bundleBytes: v.bundleBytes ?? null,
    unzippedBytes: v.unzippedBytes ?? null,
    fileCount: v.fileCount ?? null,
    sha256: v.sha256 ?? null,
    externalRefs: parseStringArray(v.externalRefs),
    createdAt: isoReq(v.createdAt),
    reviewedAt: iso(v.reviewedAt),
  };
}

export function toGameStats(g: GameRow): GameStats {
  return {
    playCount: g.playCount,
    ratingAvg: g.ratingCount > 0 ? Math.round((g.ratingSum / g.ratingCount) * 100) / 100 : 0,
    ratingCount: g.ratingCount,
  };
}

export function toGame(
  g: GameRow,
  author: UserRow,
  currentVersion: GameVersionRow | null,
): Game {
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    summary: g.summary,
    description: g.description,
    tags: parseStringArray(g.tags),
    status: g.status,
    playType: g.playType,
    externalUrl: g.externalUrl ?? null,
    author: toAuthorRef(author),
    coverImageUrl: g.coverImageUrl ?? null,
    screenshots: parseStringArray(g.screenshots),
    aiTools: parseStringArray(g.aiTools),
    stats: toGameStats(g),
    currentVersion: currentVersion ? toGameVersion(currentVersion) : null,
    createdAt: isoReq(g.createdAt),
    updatedAt: isoReq(g.updatedAt),
    publishedAt: iso(g.publishedAt),
  };
}

export function toReviewEvent(r: ReviewEventRow, moderator: UserRow): ReviewEvent {
  return {
    id: r.id,
    gameId: r.gameId,
    versionId: r.versionId ?? null,
    action: r.action,
    note: r.note,
    moderator: toAuthorRef(moderator),
    createdAt: isoReq(r.createdAt),
  };
}
